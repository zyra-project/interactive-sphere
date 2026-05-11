/**
 * `terraviz migrate-videos` — migrate legacy `vimeo:<id>` data_refs
 * to `stream:<uid>` by re-uploading the source MP4 into Cloudflare
 * Stream.
 *
 * Phase 2 commit C. Drives the helpers from `lib/vimeo-fetch.ts`
 * (commit A) and `lib/stream-upload.ts` (commit B) plus the
 * existing publisher-API client.
 *
 * Per-row pipeline:
 *   1. Resolve the `vimeo:<id>` to a streaming MP4 + duration via
 *      the video-proxy.
 *   2. Pump the bytes into Cloudflare Stream via TUS.
 *   3. PATCH the dataset's `data_ref` to `stream:<new-uid>` —
 *      *this* is the migration's commit point. Failures before
 *      this step leave the row untouched on `vimeo:` and the
 *      manifest endpoint keeps proxying through Vimeo as before.
 *      Failures *at* this step leave an orphan Stream UID logged
 *      for manual cleanup; the row is still on `vimeo:` so the
 *      next run will re-resolve from scratch.
 *   4. Emit a `migration_video` telemetry event so the Grafana
 *      progress panel (commit G) updates without a D1 query.
 *
 * Idempotency: re-running `terraviz migrate-videos` is a no-op on
 * any row whose `data_ref` already starts with `stream:`. The walker
 * skips those rows before doing any per-row work. This means the
 * operator can interrupt the run (`^C`) at any point and resume
 * by re-invoking — already-uploaded rows skip naturally.
 *
 * Pacing (Decision 3 in the brief): sequential, 5 s default between
 * rows, overridable via `--pace-ms`. Sequential keeps failure
 * attribution sharp and avoids tripping Vimeo's per-IP throttle.
 *
 * Flags:
 *   --dry-run        Print the plan and exit 0 without uploading.
 *   --limit=N        Cap the number of rows migrated this run.
 *   --id=<dataset>   Target a single dataset id; skips list paging.
 *   --pace-ms=N      Override the inter-row pace (default 5000).
 *
 * `--max-minutes=N` (the cost guard rail) is added by commit D.
 *
 * Telemetry: the emit hook is dependency-injected here so tests can
 * record calls without a network round-trip. Commit E swaps in the
 * real ingest-endpoint client.
 *
 * Stream credentials: `STREAM_ACCOUNT_ID` and `STREAM_API_TOKEN`
 * are read from `process.env` — same names the publisher API
 * binding uses. The migration is operator-driven, so the
 * credentials are already present in the operator's shell when
 * they run the command.
 */

import { resolveVimeo as resolveVimeoLib } from './lib/vimeo-fetch'
import { uploadToStream as uploadToStreamLib, type StreamUploadConfig } from './lib/stream-upload'
import { lookupVimeoDurations as lookupVimeoDurationsLib } from './lib/vimeo-duration'
import { makeMigrationTelemetryEmitter } from './lib/migration-telemetry'
import type { CommandContext } from './commands'
import { getString, getNumber, getBool } from './lib/args'

/** A single row of the publisher list response, narrowed to the
 * fields the migration cares about. */
interface PublisherDatasetRow {
  id: string
  legacy_id: string | null
  title: string
  format: string
  data_ref: string
  published_at: string | null
}

interface DatasetListEnvelope {
  datasets: PublisherDatasetRow[]
  next_cursor: string | null
}

interface DatasetGetEnvelope {
  dataset: PublisherDatasetRow
}

interface DatasetUpdateEnvelope {
  dataset: { id: string; slug: string }
}

const LIST_PAGE_LIMIT = 200
const DEFAULT_PACE_MS = 5_000

/**
 * Default cost guard rail in minutes. Decision 2 in the Phase 2
 * brief: 138 rows × ~1 min average ≈ 140 min ≈ $0.14/mo storage on
 * Cloudflare Stream's $1/1000-min rate. 300 keeps ~2× headroom over
 * the realistic ceiling — tight enough that exceeding it means
 * something genuinely surprising is in the catalog (a mis-imported
 * full-length film, a row pointing at the wrong Vimeo ID), loose
 * enough not to trip on the long tail of legitimate ~6-min narrated
 * videos.
 *
 * The flag is a hard fail by default. Operators can pass a higher
 * `--max-minutes=N` explicitly if a budgeted run needs more head-
 * room; the value is captured in shell history alongside the run.
 */
const DEFAULT_MAX_MINUTES = 300

/**
 * Per-row memory ceiling for the buffered upload path.
 *
 * 2 GiB. Phase 1b's `runUpload` cap (cli/commands.ts:124) is
 * 256 MB because that path uploads via a Cloudflare Pages Function,
 * and Workers have a hard ~128 MB per-request memory ceiling — the
 * CLI side has to stay well under it. Phase 2's migration bypasses
 * the Pages Function entirely (CLI talks directly to Cloudflare
 * Stream's TUS endpoint), so the Worker limit doesn't apply.
 *
 * 2 GiB covers any plausible SOS video at realistic bitrates —
 * the legacy catalog has ~10-15 rows above 256 MB but none in the
 * multi-GB range. Memory cost is bounded: the migration is
 * sequential, so only one row's bytes are resident at a time.
 *
 * If a future row exceeds this cap, the operator hits a clear
 * pre-flight error (`source advertises N bytes which exceeds the
 * per-row buffer cap`) and can either investigate the row or
 * we ship chunked TUS uploads as a follow-on.
 */
const BUFFER_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Drain a `ReadableStream<Uint8Array>` into a single `Uint8Array`,
 * enforcing the per-row memory ceiling and verifying the bytes
 * actually delivered match `expectedLength`.
 *
 * Three checks, each catching a distinct failure mode:
 *
 *   1. Pre-flight: `expectedLength > cap` → throw. A
 *      Content-Length advertising a row larger than the buffer
 *      cap fails fast without allocating memory.
 *   2. Mid-stream: accumulated bytes > cap → cancel + throw.
 *      Catches a source that lied about its Content-Length and
 *      tries to push more bytes than advertised.
 *   3. Post-read: actual total !== expectedLength → throw.
 *      Catches truncated upstreams (TUS PATCH would reject a
 *      mismatch anyway; better to fail explicitly with the
 *      byte counts).
 *
 * Exported for tests. The migration call site invokes it inline.
 * The `cap` parameter exists so tests can exercise the cap-exceeded
 * branches without allocating a 2 GiB Uint8Array; production
 * callers omit it and get the module-level `BUFFER_LIMIT_BYTES`.
 */
export async function drainStream(
  stream: ReadableStream<Uint8Array>,
  expectedLength: number,
  cap: number = BUFFER_LIMIT_BYTES,
): Promise<Uint8Array> {
  if (expectedLength > cap) {
    throw new Error(
      `source advertises ${expectedLength} bytes which exceeds the per-row buffer cap of ${cap} bytes`,
    )
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > cap) {
      reader.cancel().catch(() => {})
      throw new Error(
        `source exceeded the per-row buffer cap of ${cap} bytes mid-stream`,
      )
    }
    chunks.push(value)
  }
  if (total !== expectedLength) {
    throw new Error(
      `source delivered ${total} bytes but advertised ${expectedLength}; refusing to upload an incomplete asset`,
    )
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** Outcome enum. Mirrors the `migration_video` telemetry event's
 * `outcome` field (commit E) — keep these in sync. */
export type MigrationOutcome =
  | 'ok'
  | 'vimeo_fetch_failed'
  | 'stream_upload_failed'
  | 'data_ref_patch_failed'

export interface MigrationResult {
  datasetId: string
  legacyId: string
  vimeoId: string
  streamUid: string
  bytesUploaded: number
  durationMs: number
  outcome: MigrationOutcome
  /** Operator-facing error message; '' on `outcome === 'ok'`. */
  errorMessage: string
}

export interface MigrateVideoDeps {
  /** DI for the vimeo-fetch helper. Defaults to the production import. */
  resolveVimeo?: typeof resolveVimeoLib
  /** DI for the stream-upload helper. Defaults to the production import. */
  uploadToStream?: typeof uploadToStreamLib
  /** DI for the duration-lookup helper used by the cost guard rail. */
  lookupVimeoDurations?: typeof lookupVimeoDurationsLib
  /** Telemetry sink. Defaults to a no-op (commit E swaps in the
   * real implementation). */
  emitTelemetry?: (event: MigrationResult) => void | Promise<void>
  /** DI for the wall clock — tests pass a deterministic now(). */
  now?: () => number
  /** Stream credentials. Defaults to reading `STREAM_ACCOUNT_ID` /
   * `STREAM_API_TOKEN` from `process.env`. */
  streamConfig?: StreamUploadConfig
  /** Skip the inter-row pacing wait — set to `true` from tests so
   * a four-row walk doesn't burn 15 s on `setTimeout`. */
  skipPace?: boolean
  /** Override the duration-cache path. Tests use a tmpdir; the
   * production default is `.cache/vimeo-durations.json`. */
  durationCachePath?: string
}

function loadStreamConfigFromEnv(): StreamUploadConfig {
  return {
    accountId: process.env.STREAM_ACCOUNT_ID ?? '',
    apiToken: process.env.STREAM_API_TOKEN ?? '',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

interface MigrationCandidate {
  datasetId: string
  legacyId: string
  title: string
  vimeoId: string
}

function asCandidate(row: PublisherDatasetRow): MigrationCandidate | null {
  if (row.format !== 'video/mp4') return null
  if (!row.data_ref.startsWith('vimeo:')) return null
  const vimeoId = row.data_ref.slice('vimeo:'.length).trim()
  if (!/^\d+$/.test(vimeoId)) return null
  return {
    datasetId: row.id,
    legacyId: row.legacy_id ?? '',
    title: row.title,
    vimeoId,
  }
}

/**
 * Build the migration plan.
 *
 * Two paths, with intentionally different filtering:
 *
 *   - Paginated walk (no `--id`): GETs `/api/v1/publish/datasets`
 *     with `status=published` so drafts and retracted rows are
 *     out of scope. Then filters in-memory to
 *     `format = video/mp4` AND `data_ref` begins `vimeo:`.
 *     This is the bulk mode used for the full migration run.
 *
 *   - Single-row mode (`--id <id>`): GETs the row directly,
 *     bypasses the status filter. Operators using `--id` are
 *     making an explicit "I want this specific row" choice;
 *     migrating a draft pre-publish or surgically rewriting a
 *     stuck row are both legitimate uses. The format +
 *     data_ref-scheme filter still applies, so a non-video or
 *     already-stream-backed row prints "skipping" and exits 0.
 *
 * Walks pages until the cursor is exhausted. Returns the full
 * candidate list; `--limit` is applied by the caller after the
 * pre-flight summary so the dry-run output is honest about the
 * total work even when the operator opts to run a smaller batch.
 */
async function buildPlan(
  ctx: CommandContext,
  targetId: string | undefined,
): Promise<MigrationCandidate[] | null> {
  // Single-row mode — skip pagination entirely.
  if (targetId) {
    const result = await ctx.client.get<DatasetGetEnvelope>(targetId)
    if (!result.ok) {
      ctx.stderr.write(
        `Could not GET ${targetId} (${result.status}): ${result.error}` +
          (result.message ? ` — ${result.message}` : '') +
          '\n',
      )
      return null
    }
    const candidate = asCandidate(result.body.dataset)
    if (!candidate) {
      ctx.stderr.write(
        `Dataset ${targetId} is not a vimeo: video/mp4 row ` +
          `(format=${result.body.dataset.format}, data_ref=${result.body.dataset.data_ref}). ` +
          `Skipping.\n`,
      )
      return []
    }
    return [candidate]
  }

  const candidates: MigrationCandidate[] = []
  let cursor: string | undefined
  do {
    const result = await ctx.client.list<DatasetListEnvelope>({
      status: 'published',
      limit: LIST_PAGE_LIMIT,
      cursor,
    })
    if (!result.ok) {
      ctx.stderr.write(
        `Could not list datasets (${result.status}): ${result.error}` +
          (result.message ? ` — ${result.message}` : '') +
          '\n',
      )
      return null
    }
    for (const row of result.body.datasets) {
      const candidate = asCandidate(row)
      if (candidate) candidates.push(candidate)
    }
    cursor = result.body.next_cursor ?? undefined
  } while (cursor)
  return candidates
}

interface CostEstimate {
  /** Total minutes summed over rows with a known duration. */
  totalMinutes: number
  /** Number of rows whose duration could not be resolved. */
  missingDurations: number
  /** Total rows considered. */
  rowCount: number
}

/**
 * Walk the migration plan and sum the Vimeo metadata duration for
 * each row. Reads from the on-disk cache; misses go to the oembed
 * probe and the cache is rewritten at the end.
 *
 * Always called once per run — even on `--dry-run` — so the
 * operator sees the cost summary before deciding whether to
 * commit. The summary surfaces the count of unknown durations
 * separately so the operator can decide whether to proceed when a
 * subset of rows couldn't be probed (Vimeo geofencing, deleted
 * videos, oembed rate-limited, etc).
 */
async function estimateCost(
  plan: MigrationCandidate[],
  lookup: typeof lookupVimeoDurationsLib,
  cachePath: string | undefined,
): Promise<CostEstimate> {
  const ids = plan.map(c => c.vimeoId)
  const durations = await lookup(ids, { cachePath })
  let totalSeconds = 0
  let missing = 0
  for (const id of ids) {
    const seconds = durations.get(id)
    if (seconds === undefined) {
      missing++
      continue
    }
    totalSeconds += seconds
  }
  return {
    totalMinutes: totalSeconds / 60,
    missingDurations: missing,
    rowCount: ids.length,
  }
}

function printCostSummary(ctx: CommandContext, estimate: CostEstimate, maxMinutes: number): void {
  // Stream pricing: $1 / 1000 min stored. (Delivery is symmetric.)
  // The per-month estimate is what an operator actually sees on the
  // bill, so it's the more useful number to surface.
  const totalMinutes = Math.round(estimate.totalMinutes * 10) / 10
  const monthlyDollars = (estimate.totalMinutes / 1000).toFixed(2)
  ctx.stdout.write(
    `Cost estimate (Cloudflare Stream storage):\n` +
      `  total minutes:            ${totalMinutes}\n` +
      `  rows with known duration: ${estimate.rowCount - estimate.missingDurations} / ${estimate.rowCount}\n` +
      `  missing durations:        ${estimate.missingDurations}\n` +
      `  ≈ \$${monthlyDollars}/month storage at \$1 / 1000 min\n` +
      `  --max-minutes guard rail: ${maxMinutes}\n`,
  )
}

function printPlanSummary(ctx: CommandContext, plan: MigrationCandidate[], limit: number): void {
  const willRun = Math.min(plan.length, limit)
  ctx.stdout.write(
    `Migration plan:\n` +
      `  vimeo: rows on video/mp4: ${plan.length}\n` +
      `  will migrate this run:    ${willRun}` +
      (limit < plan.length ? ` (capped by --limit)\n` : '\n'),
  )
  if (plan.length === 0) return
  const sample = plan.slice(0, Math.min(willRun, 5))
  for (const c of sample) {
    ctx.stdout.write(`  • ${c.datasetId}  vimeo:${c.vimeoId}  ${c.title}\n`)
  }
  if (willRun > sample.length) {
    ctx.stdout.write(`  • … + ${willRun - sample.length} more\n`)
  }
}

/**
 * Migrate a single candidate. Returns the structured outcome — the
 * caller writes both the operator log line and the telemetry event
 * from this shape.
 */
async function migrateOne(
  candidate: MigrationCandidate,
  deps: Required<Pick<MigrateVideoDeps, 'resolveVimeo' | 'uploadToStream' | 'now'>> & {
    streamConfig: StreamUploadConfig
    client: CommandContext['client']
  },
): Promise<MigrationResult> {
  const start = deps.now()
  const out: MigrationResult = {
    datasetId: candidate.datasetId,
    legacyId: candidate.legacyId,
    vimeoId: candidate.vimeoId,
    streamUid: '',
    bytesUploaded: 0,
    durationMs: 0,
    outcome: 'ok',
    errorMessage: '',
  }

  // Stage 1 — resolve the source.
  let handle
  try {
    handle = await deps.resolveVimeo(candidate.vimeoId)
  } catch (e) {
    out.outcome = 'vimeo_fetch_failed'
    out.errorMessage = e instanceof Error ? e.message : String(e)
    out.durationMs = deps.now() - start
    return out
  }

  let body
  try {
    body = await handle.openStream()
  } catch (e) {
    out.outcome = 'vimeo_fetch_failed'
    out.errorMessage = e instanceof Error ? e.message : String(e)
    out.durationMs = deps.now() - start
    return out
  }

  // Stage 1.5 — drain the source into a Uint8Array.
  //
  // 2/O fix. A live single-row run hit "Response body object
  // should not be disturbed or locked" — Node's undici can't
  // replay a ReadableStream body on the 307/308 regional-routing
  // redirects Cloudflare Stream issues during TUS PATCH. Buffering
  // the bytes sidesteps the issue and matches Phase 1b's
  // runUpload precedent (also buffers, also 256 MB cap).
  //
  // Memory ceiling: legacy SOS rows average ~50 MB; the 256 MB cap
  // catches surprise oversize sources fast with a useful error.
  // The full migration is sequential, so only one row's bytes are
  // resident at a time — the operator's laptop sees ≤ 256 MB peak
  // regardless of catalog size.
  let buffered: Uint8Array
  try {
    buffered = await drainStream(body.stream, body.contentLength)
  } catch (e) {
    out.outcome = 'vimeo_fetch_failed'
    out.errorMessage = e instanceof Error ? e.message : String(e)
    out.durationMs = deps.now() - start
    return out
  }

  // Stage 2 — pump bytes into Stream.
  let upload
  try {
    upload = await deps.uploadToStream(deps.streamConfig, buffered, buffered.byteLength, {
      meta: { name: candidate.title || candidate.datasetId, filename: `${candidate.legacyId || candidate.datasetId}.mp4` },
    })
  } catch (e) {
    out.outcome = 'stream_upload_failed'
    out.errorMessage = e instanceof Error ? e.message : String(e)
    out.durationMs = deps.now() - start
    return out
  }
  out.streamUid = upload.streamUid
  out.bytesUploaded = upload.bytesUploaded

  // Stage 3 — flip the data_ref. This is the commit point.
  const patched = await deps.client.updateDataset<DatasetUpdateEnvelope>(candidate.datasetId, {
    data_ref: `stream:${upload.streamUid}`,
  })
  if (!patched.ok) {
    out.outcome = 'data_ref_patch_failed'
    out.errorMessage = `${patched.status}: ${patched.error}${patched.message ? ` — ${patched.message}` : ''}`
    out.durationMs = deps.now() - start
    return out
  }

  out.durationMs = deps.now() - start
  return out
}

export async function runMigrateVideos(
  ctx: CommandContext,
  deps: MigrateVideoDeps = {},
): Promise<number> {
  const targetId = getString(ctx.args.options, 'id')
  const limitFlag = getNumber(ctx.args.options, 'limit')
  const dryRun = getBool(ctx.args.options, 'dry-run')
  const paceMs = getNumber(ctx.args.options, 'pace-ms') ?? DEFAULT_PACE_MS
  const maxMinutes = getNumber(ctx.args.options, 'max-minutes') ?? DEFAULT_MAX_MINUTES

  if (limitFlag !== undefined && limitFlag < 1) {
    ctx.stderr.write(`--limit must be a positive integer (got ${limitFlag}).\n`)
    return 2
  }
  if (paceMs < 0) {
    ctx.stderr.write(`--pace-ms must be non-negative (got ${paceMs}).\n`)
    return 2
  }
  if (maxMinutes <= 0) {
    ctx.stderr.write(`--max-minutes must be a positive number (got ${maxMinutes}).\n`)
    return 2
  }

  const plan = await buildPlan(ctx, targetId)
  if (plan === null) return 1

  const limit = limitFlag ?? plan.length
  printPlanSummary(ctx, plan, limit)

  // Cost guard rail. Always runs (including on --dry-run) so the
  // operator sees the cost summary up front. Hard-fails when the
  // total exceeds --max-minutes; the operator can pass a higher
  // value explicitly, but there's no silent override.
  const lookup = deps.lookupVimeoDurations ?? lookupVimeoDurationsLib
  const work = plan.slice(0, limit)
  const estimate = await estimateCost(work, lookup, deps.durationCachePath)
  printCostSummary(ctx, estimate, maxMinutes)
  if (estimate.totalMinutes > maxMinutes) {
    ctx.stderr.write(
      `\nAborting: estimated ${estimate.totalMinutes.toFixed(1)} minutes exceeds ` +
        `--max-minutes=${maxMinutes}. Pass a higher --max-minutes if this is expected, ` +
        `or use --limit / --id to reduce the batch size.\n`,
    )
    return 2
  }

  if (dryRun) {
    ctx.stdout.write('\nDry run — no rows will be migrated. Re-run without --dry-run to apply.\n')
    return 0
  }

  if (plan.length === 0) {
    ctx.stdout.write('\nNothing to migrate.\n')
    return 0
  }

  const streamConfig = deps.streamConfig ?? loadStreamConfigFromEnv()
  if (!streamConfig.accountId || !streamConfig.apiToken) {
    ctx.stderr.write(
      'STREAM_ACCOUNT_ID and STREAM_API_TOKEN must both be set in the environment.\n',
    )
    return 2
  }

  const resolveVimeo = deps.resolveVimeo ?? resolveVimeoLib
  const uploadToStream = deps.uploadToStream ?? uploadToStreamLib
  const now = deps.now ?? Date.now
  // Default emitter POSTs a single-event batch per row to the
  // configured server's /api/ingest endpoint. Tests pass a recorder
  // via `deps.emitTelemetry` so they observe events without a
  // network round-trip.
  let emitTelemetry: NonNullable<MigrateVideoDeps['emitTelemetry']>
  if (deps.emitTelemetry) {
    emitTelemetry = deps.emitTelemetry
  } else {
    const emitter = makeMigrationTelemetryEmitter({ serverUrl: ctx.client.serverUrl })
    ctx.stdout.write(`Telemetry session id: ${emitter.sessionId}\n`)
    emitTelemetry = result => emitter.emit(result)
  }

  const counts: Record<MigrationOutcome, number> = {
    ok: 0,
    vimeo_fetch_failed: 0,
    stream_upload_failed: 0,
    data_ref_patch_failed: 0,
  }

  for (let i = 0; i < work.length; i++) {
    const candidate = work[i]
    const result = await migrateOne(candidate, {
      resolveVimeo,
      uploadToStream,
      now,
      streamConfig,
      client: ctx.client,
    })
    counts[result.outcome]++
    try {
      await emitTelemetry(result)
    } catch (e) {
      // Telemetry must never abort the migration itself. Log + carry on.
      ctx.stderr.write(
        `[${candidate.datasetId}] telemetry emit failed: ${e instanceof Error ? e.message : String(e)}\n`,
      )
    }

    if (result.outcome === 'ok') {
      ctx.stdout.write(
        `[${candidate.datasetId}] vimeo:${candidate.vimeoId} → stream:${result.streamUid} ` +
          `(${result.bytesUploaded} bytes, ${result.durationMs} ms)\n`,
      )
    } else {
      ctx.stderr.write(
        `[${candidate.datasetId}] ${result.outcome}: ${result.errorMessage}\n`,
      )
    }

    // Pace between rows; skip after the final row and during tests.
    if (!deps.skipPace && i < work.length - 1 && paceMs > 0) {
      await sleep(paceMs)
    }
  }

  ctx.stdout.write(
    `\nMigration complete:\n` +
      `  ok:                       ${counts.ok}\n` +
      `  vimeo_fetch_failed:       ${counts.vimeo_fetch_failed}\n` +
      `  stream_upload_failed:     ${counts.stream_upload_failed}\n` +
      `  data_ref_patch_failed:    ${counts.data_ref_patch_failed}\n`,
  )
  const failures = counts.vimeo_fetch_failed + counts.stream_upload_failed + counts.data_ref_patch_failed
  return failures > 0 ? 1 : 0
}
