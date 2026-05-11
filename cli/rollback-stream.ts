/**
 * `terraviz rollback-stream` — undo a single migrated dataset.
 *
 * Phase 2 commit R, added after a live migration revealed the
 * standard Stream plan caps rendition output at 1080p. To
 * re-migrate at a higher rendition tier (or to recover from any
 * other reason a migration needs to be reversed), this subcommand:
 *
 *   1. GETs the dataset and verifies its `data_ref` currently
 *      starts with `stream:`. Refuses if it's already on `vimeo:`
 *      or anything else — caller error.
 *   2. PATCHes `data_ref` back to `vimeo:<id>` (the operator
 *      provides the original vimeo id explicitly via
 *      `--to-vimeo=<n>`). This is the rollback's commit point —
 *      after this PATCH, the SPA's manifest endpoint resolves
 *      the row through the Vimeo proxy again, exactly as before
 *      the migration.
 *   3. Deletes the Stream asset (cleanup). Non-fatal — if this
 *      fails, the row is already correctly back on `vimeo:` and
 *      the operator just has an orphan Stream UID to clean up
 *      manually.
 *
 * The two-stage order matters: PATCH before DELETE means a delete
 * failure leaves the catalog in a correct state (row on `vimeo:`,
 * orphan Stream asset). PATCH after DELETE would risk a window
 * where the row points at a deleted Stream UID and playback 404s.
 *
 * Why explicit `--to-vimeo=<n>`? The Vimeo id is recoverable from
 * the SOS snapshot file or the legacy_id, but the rollback tool
 * stays deploy-agnostic: any operator who knows the original
 * `vimeo:<id>` can roll back, regardless of whether their catalog
 * traces back to SOS or some other source.
 */

import { deleteStreamAsset as deleteStreamAssetLib, type StreamUploadConfig } from './lib/stream-upload'
import type { CommandContext } from './commands'
import { getString, getBool } from './lib/args'

interface DatasetGetEnvelope {
  dataset: { id: string; data_ref: string; title?: string }
}

interface DatasetUpdateEnvelope {
  dataset: { id: string; slug: string }
}

export interface RollbackStreamDeps {
  /** DI for the stream-delete helper. Defaults to the production import. */
  deleteStreamAsset?: typeof deleteStreamAssetLib
  /** Stream credentials. Defaults to reading STREAM_ACCOUNT_ID /
   * STREAM_API_TOKEN from process.env. */
  streamConfig?: StreamUploadConfig
}

function loadStreamConfigFromEnv(): StreamUploadConfig {
  return {
    accountId: process.env.STREAM_ACCOUNT_ID ?? '',
    apiToken: process.env.STREAM_API_TOKEN ?? '',
  }
}

export async function runRollbackStream(
  ctx: CommandContext,
  deps: RollbackStreamDeps = {},
): Promise<number> {
  const datasetId = ctx.args.positional[0]
  if (!datasetId) {
    ctx.stderr.write(
      'Usage: terraviz rollback-stream <dataset_id> --to-vimeo=<vimeo_id> [--dry-run]\n',
    )
    return 2
  }
  const toVimeo = getString(ctx.args.options, 'to-vimeo')
  if (!toVimeo) {
    ctx.stderr.write('--to-vimeo=<vimeo_id> is required.\n')
    return 2
  }
  if (!/^\d+$/.test(toVimeo)) {
    ctx.stderr.write(`--to-vimeo must be a numeric Vimeo id (got "${toVimeo}").\n`)
    return 2
  }
  const dryRun = getBool(ctx.args.options, 'dry-run')

  // Stage 0 — fetch current state.
  const got = await ctx.client.get<DatasetGetEnvelope>(datasetId)
  if (!got.ok) {
    ctx.stderr.write(
      `Could not GET ${datasetId} (${got.status}): ${got.error}` +
        (got.message ? ` — ${got.message}` : '') +
        '\n',
    )
    return 1
  }
  const currentRef = got.body.dataset.data_ref
  if (!currentRef.startsWith('stream:')) {
    ctx.stderr.write(
      `Dataset ${datasetId} data_ref is "${currentRef}", not stream:. Nothing to roll back.\n`,
    )
    return 2
  }
  const streamUid = currentRef.slice('stream:'.length).trim()
  if (!streamUid) {
    ctx.stderr.write(`Dataset ${datasetId} has a malformed stream: data_ref ("${currentRef}").\n`)
    return 1
  }

  ctx.stdout.write(
    `Rollback plan:\n` +
      `  dataset:                ${datasetId}` +
      (got.body.dataset.title ? `  (${got.body.dataset.title})` : '') +
      '\n' +
      `  current data_ref:       ${currentRef}\n` +
      `  target data_ref:        vimeo:${toVimeo}\n` +
      `  stream uid to delete:   ${streamUid}\n`,
  )

  if (dryRun) {
    ctx.stdout.write('\nDry run — no changes will be made.\n')
    return 0
  }

  // Stage 1 — flip data_ref first. This is the commit point.
  const patched = await ctx.client.updateDataset<DatasetUpdateEnvelope>(datasetId, {
    data_ref: `vimeo:${toVimeo}`,
  })
  if (!patched.ok) {
    ctx.stderr.write(
      `data_ref PATCH failed (${patched.status}): ${patched.error}` +
        (patched.message ? ` — ${patched.message}` : '') +
        '\n',
    )
    return 1
  }
  ctx.stdout.write(`✓ data_ref flipped to vimeo:${toVimeo}\n`)

  // Stage 2 — delete the Stream asset (cleanup; non-fatal).
  const streamConfig = deps.streamConfig ?? loadStreamConfigFromEnv()
  if (!streamConfig.accountId || !streamConfig.apiToken) {
    ctx.stderr.write(
      `! STREAM credentials unset — leaving orphan stream:${streamUid} in Cloudflare Stream.\n` +
        `  data_ref is correctly on vimeo:; delete the orphan manually if needed.\n`,
    )
    return 0
  }
  const deleteImpl = deps.deleteStreamAsset ?? deleteStreamAssetLib
  try {
    await deleteImpl(streamConfig, streamUid)
    ctx.stdout.write(`✓ stream:${streamUid} deleted\n`)
  } catch (e) {
    ctx.stderr.write(
      `! Could not delete stream:${streamUid}: ${e instanceof Error ? e.message : String(e)}\n` +
        `  data_ref is already on vimeo:; delete the orphan manually via the Stream dashboard or API.\n`,
    )
    return 0
  }

  ctx.stdout.write(`\nRollback complete.\n`)
  return 0
}
