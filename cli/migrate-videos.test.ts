/**
 * Tests for `terraviz migrate-videos` (Phase 2 commit C).
 *
 * The subcommand is exercised against:
 *   - a hand-rolled fake `TerravizClient` whose `list`, `get`, and
 *     `updateDataset` methods record calls and serve fixed
 *     responses;
 *   - DI hooks for `resolveVimeo`, `uploadToStream`, and
 *     `emitTelemetry` so a unit test exercises the migration loop
 *     without ever hitting the network or stubbing global fetch
 *     for the helper internals;
 *   - `streamConfig` injected directly so the env-var path doesn't
 *     leak into test runs;
 *   - `skipPace: true` so the inter-row pacing wait is a no-op.
 *
 * Coverage:
 *   - --dry-run prints the plan and never mutates;
 *   - the live migration calls resolveVimeo + uploadToStream +
 *     updateDataset for each candidate;
 *   - rows whose data_ref already starts with `stream:` are filtered
 *     out at plan time;
 *   - non-video formats are filtered out at plan time;
 *   - --limit=N caps the work after the plan summary;
 *   - --id=X targets a single row via GET;
 *   - --id=X for a non-vimeo row prints a skip message and exits 0;
 *   - vimeo_fetch_failed surfaces the right outcome + telemetry;
 *   - stream_upload_failed surfaces the right outcome + telemetry;
 *   - data_ref_patch_failed leaves the orphan UID in the telemetry
 *     event for manual cleanup;
 *   - missing STREAM_* env vars produce exit 2 before any work;
 *   - telemetry emit failures don't abort the migration.
 */

import { describe, expect, it, vi } from 'vitest'
import { runMigrateVideos, type MigrationResult } from './migrate-videos'
import type { CommandContext } from './commands'
import type { TerravizClient } from './lib/client'
import { parseArgs } from './lib/args'

interface BufStream {
  write(chunk: string): boolean
  text(): string
}

function makeStream(): BufStream {
  let buf = ''
  return {
    write(chunk: string) {
      buf += chunk
      return true
    },
    text() {
      return buf
    },
  }
}

interface PublisherRow {
  id: string
  legacy_id: string | null
  title: string
  format: string
  data_ref: string
  published_at: string | null
}

const ROW_VIDEO_VIMEO_1: PublisherRow = {
  id: 'DS00001AAAAAAAAAAAAAAAAAAAAA',
  legacy_id: 'INTERNAL_SOS_768',
  title: 'Hurricane Season - 2024',
  format: 'video/mp4',
  data_ref: 'vimeo:1107911993',
  published_at: '2026-04-30T00:00:00.000Z',
}
const ROW_VIDEO_VIMEO_2: PublisherRow = {
  id: 'DS00002AAAAAAAAAAAAAAAAAAAAA',
  legacy_id: 'INTERNAL_SOS_770',
  title: 'Argo Buoys',
  format: 'video/mp4',
  data_ref: 'vimeo:222',
  published_at: '2026-04-30T00:00:00.000Z',
}
const ROW_VIDEO_STREAM: PublisherRow = {
  id: 'DS00003AAAAAAAAAAAAAAAAAAAAA',
  legacy_id: 'INTERNAL_SOS_771',
  title: 'Already Migrated',
  format: 'video/mp4',
  data_ref: 'stream:abc',
  published_at: '2026-04-30T00:00:00.000Z',
}
const ROW_IMAGE: PublisherRow = {
  id: 'DS00004AAAAAAAAAAAAAAAAAAAAA',
  legacy_id: 'INTERNAL_SOS_780',
  title: 'Image Layer',
  format: 'image/png',
  data_ref: 'url:https://example.org/x.png',
  published_at: '2026-04-30T00:00:00.000Z',
}

interface FakeClientHandles {
  list: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  updateDataset: ReturnType<typeof vi.fn>
}

interface FakeClientOptions {
  rows?: PublisherRow[]
  /** If set, GET <id> returns this row. */
  singleRow?: PublisherRow
  /** Make updateDataset fail for these dataset ids. */
  patchFailFor?: Set<string>
  /** Make get(id) fail. */
  getFails?: boolean
}

function fakeClient(opts: FakeClientOptions = {}): {
  client: TerravizClient
  handles: FakeClientHandles
} {
  const rows = opts.rows ?? []
  const list = vi.fn(async (query: { status?: string } = {}) => {
    const filtered = rows.filter(r => {
      if (query.status === 'published') return r.published_at != null
      return true
    })
    return {
      ok: true as const,
      status: 200,
      body: { datasets: filtered, next_cursor: null },
    }
  })
  const get = vi.fn(async (id: string) => {
    if (opts.getFails) {
      return { ok: false as const, status: 404, error: 'not_found' }
    }
    if (opts.singleRow && opts.singleRow.id === id) {
      return { ok: true as const, status: 200, body: { dataset: opts.singleRow } }
    }
    return { ok: false as const, status: 404, error: 'not_found' }
  })
  const updateDataset = vi.fn(async (id: string, body: Record<string, unknown>) => {
    if (opts.patchFailFor?.has(id)) {
      return {
        ok: false as const,
        status: 503,
        error: 'upstream_unavailable',
        message: 'D1 timeout',
      }
    }
    return {
      ok: true as const,
      status: 200,
      body: { dataset: { id, slug: `slug-${id}`, ...body } },
    }
  })
  const stub = { serverUrl: 'http://localhost:8788', list, get, updateDataset }
  return {
    client: stub as unknown as TerravizClient,
    handles: { list, get, updateDataset },
  }
}

function makeCtx(
  client: TerravizClient,
  flags: Record<string, string | boolean> = {},
): { ctx: CommandContext; out: BufStream; err: BufStream } {
  const out = makeStream()
  const err = makeStream()
  const argv: string[] = []
  for (const [k, v] of Object.entries(flags)) {
    if (v === true) argv.push(`--${k}`)
    else argv.push(`--${k}=${String(v)}`)
  }
  const args = parseArgs(argv)
  return { ctx: { client, args, stdout: out, stderr: err }, out, err }
}

interface FakeResolveVimeoOptions {
  durationSeconds?: number | null
  contentLength?: number
  failResolve?: boolean
  failOpenStream?: boolean
}
function fakeResolveVimeoFn(opts: FakeResolveVimeoOptions = {}) {
  return vi.fn(async (vimeoId: string) => {
    if (opts.failResolve) throw new Error(`vimeo fetch failed for ${vimeoId}`)
    return {
      metadata: {
        vimeoId,
        title: `Vimeo ${vimeoId}`,
        durationSeconds: opts.durationSeconds ?? 60,
        mp4Link: `https://cdn.example.org/v/${vimeoId}/source.mp4`,
        advertisedBytes: opts.contentLength ?? 1024,
      },
      async openStream() {
        if (opts.failOpenStream) throw new Error(`MP4 fetch failed for ${vimeoId}`)
        return {
          stream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode('mp4'))
              c.close()
            },
          }),
          contentLength: opts.contentLength ?? 1024,
          contentType: 'video/mp4',
        }
      },
    }
  })
}

interface FakeUploadToStreamOptions {
  fail?: boolean
  uidFor?: (vimeoId: string) => string
}
function fakeUploadToStreamFn(opts: FakeUploadToStreamOptions = {}) {
  let counter = 0
  return vi.fn(async (
    _config: unknown,
    _body: ReadableStream<Uint8Array>,
    contentLength: number,
    options?: { meta?: { name?: string; filename?: string } },
  ) => {
    if (opts.fail) throw new Error('TUS PATCH 502')
    counter++
    const uid = opts.uidFor
      ? opts.uidFor(String(options?.meta?.filename ?? counter))
      : `stream-uid-${counter}`
    return { streamUid: uid, bytesUploaded: contentLength, uploadUrl: `https://upload.test/${uid}` }
  })
}

const STREAM_CONFIG = { accountId: 'acc-1', apiToken: 'tok-1' }
const FROZEN_NOW = (() => {
  let n = 1_000_000
  return () => {
    n += 100
    return n
  }
})()

describe('runMigrateVideos — plan + dry-run', () => {
  it('--dry-run prints the plan and exits 0 without mutating', async () => {
    const { client, handles } = fakeClient({
      rows: [ROW_VIDEO_VIMEO_1, ROW_VIDEO_VIMEO_2, ROW_VIDEO_STREAM, ROW_IMAGE],
    })
    const { ctx, out, err } = makeCtx(client, { 'dry-run': true })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(0)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(out.text()).toContain('vimeo: rows on video/mp4: 2')
    expect(out.text()).toContain('will migrate this run:    2')
    expect(out.text()).toContain('Dry run')
    expect(err.text()).toBe('')
  })

  it('filters out rows already on stream: at plan time', async () => {
    const { client } = fakeClient({ rows: [ROW_VIDEO_STREAM, ROW_VIDEO_VIMEO_1] })
    const { ctx, out } = makeCtx(client, { 'dry-run': true })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(0)
    expect(out.text()).toContain('vimeo: rows on video/mp4: 1')
  })

  it('filters out non-video formats at plan time', async () => {
    const { client } = fakeClient({ rows: [ROW_IMAGE] })
    const { ctx, out } = makeCtx(client, { 'dry-run': true })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(0)
    expect(out.text()).toContain('vimeo: rows on video/mp4: 0')
  })

  it('honours --limit and shows the cap in the summary', async () => {
    const { client } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1, ROW_VIDEO_VIMEO_2] })
    const { ctx, out } = makeCtx(client, { 'dry-run': true, limit: '1' })
    await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(out.text()).toContain('will migrate this run:    1 (capped by --limit)')
  })

  it('--id targets a single row via GET, skipping the list paging', async () => {
    const { client, handles } = fakeClient({ singleRow: ROW_VIDEO_VIMEO_1 })
    const { ctx, out } = makeCtx(client, { id: ROW_VIDEO_VIMEO_1.id, 'dry-run': true })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(0)
    expect(handles.list).not.toHaveBeenCalled()
    expect(handles.get).toHaveBeenCalledWith(ROW_VIDEO_VIMEO_1.id)
    expect(out.text()).toContain('vimeo: rows on video/mp4: 1')
  })

  it('--id pointing at a non-vimeo row prints a skip and exits 0', async () => {
    const { client, handles } = fakeClient({ singleRow: ROW_IMAGE })
    const { ctx, err } = makeCtx(client, { id: ROW_IMAGE.id })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(0)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Skipping')
  })

  it('exits 2 when --limit is non-positive', async () => {
    const { client } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
    const { ctx, err } = makeCtx(client, { limit: '0' })
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('--limit must be a positive integer')
  })

  it('exits 2 when STREAM credentials are missing', async () => {
    const prevA = process.env.STREAM_ACCOUNT_ID
    const prevT = process.env.STREAM_API_TOKEN
    delete process.env.STREAM_ACCOUNT_ID
    delete process.env.STREAM_API_TOKEN
    try {
      const { client, handles } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
      const { ctx, err } = makeCtx(client)
      const code = await runMigrateVideos(ctx, { skipPace: true })
      expect(code).toBe(2)
      expect(handles.updateDataset).not.toHaveBeenCalled()
      expect(err.text()).toContain('STREAM_ACCOUNT_ID and STREAM_API_TOKEN')
    } finally {
      if (prevA !== undefined) process.env.STREAM_ACCOUNT_ID = prevA
      if (prevT !== undefined) process.env.STREAM_API_TOKEN = prevT
    }
  })

  it('exits 1 when the list endpoint refuses', async () => {
    const list = vi.fn(async () => ({
      ok: false as const,
      status: 401,
      error: 'unauthorized',
      message: 'no Access token',
    }))
    const stub = { serverUrl: 'x', list, get: vi.fn(), updateDataset: vi.fn() }
    const { ctx, err } = makeCtx(stub as unknown as TerravizClient)
    const code = await runMigrateVideos(ctx, { skipPace: true, streamConfig: STREAM_CONFIG })
    expect(code).toBe(1)
    expect(err.text()).toContain('Could not list datasets (401)')
  })
})

describe('runMigrateVideos — live migration', () => {
  it('migrates each candidate and PATCHes data_ref to stream:<uid>', async () => {
    const { client, handles } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1, ROW_VIDEO_VIMEO_2] })
    const events: MigrationResult[] = []
    const resolveVimeo = fakeResolveVimeoFn()
    const uploadToStream = fakeUploadToStreamFn()
    const { ctx, out, err } = makeCtx(client)
    const code = await runMigrateVideos(ctx, {
      streamConfig: STREAM_CONFIG,
      resolveVimeo,
      uploadToStream,
      emitTelemetry: e => {
        events.push(e)
      },
      skipPace: true,
      now: FROZEN_NOW,
    })
    expect(code).toBe(0)
    expect(resolveVimeo).toHaveBeenCalledTimes(2)
    expect(uploadToStream).toHaveBeenCalledTimes(2)
    expect(handles.updateDataset).toHaveBeenCalledTimes(2)

    // First call carries the new data_ref pointing at the freshly
    // minted Stream uid, not the legacy vimeo: ref.
    const [firstId, firstBody] = handles.updateDataset.mock.calls[0]
    expect(firstId).toBe(ROW_VIDEO_VIMEO_1.id)
    expect(firstBody).toEqual({ data_ref: 'stream:stream-uid-1' })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      datasetId: ROW_VIDEO_VIMEO_1.id,
      legacyId: ROW_VIDEO_VIMEO_1.legacy_id,
      vimeoId: '1107911993',
      streamUid: 'stream-uid-1',
      outcome: 'ok',
    })
    expect(out.text()).toContain('ok:                       2')
    expect(err.text()).toBe('')
  })

  it('passes the dataset title as Upload-Metadata.name', async () => {
    const { client } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
    const uploadToStream = fakeUploadToStreamFn()
    const { ctx } = makeCtx(client)
    await runMigrateVideos(ctx, {
      streamConfig: STREAM_CONFIG,
      resolveVimeo: fakeResolveVimeoFn(),
      uploadToStream,
      skipPace: true,
    })
    const meta = (uploadToStream.mock.calls[0][3] as { meta?: { name?: string } } | undefined)?.meta
    expect(meta?.name).toBe(ROW_VIDEO_VIMEO_1.title)
  })

  it('vimeo_fetch_failed: skips upload + patch, emits telemetry, exits 1', async () => {
    const { client, handles } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
    const events: MigrationResult[] = []
    const code = await runMigrateVideos(
      makeCtx(client).ctx,
      {
        streamConfig: STREAM_CONFIG,
        resolveVimeo: fakeResolveVimeoFn({ failResolve: true }),
        uploadToStream: fakeUploadToStreamFn(),
        emitTelemetry: e => {
          events.push(e)
        },
        skipPace: true,
        now: FROZEN_NOW,
      },
    )
    expect(code).toBe(1)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(events[0].outcome).toBe('vimeo_fetch_failed')
    expect(events[0].streamUid).toBe('')
    expect(events[0].bytesUploaded).toBe(0)
  })

  it('stream_upload_failed: skips data_ref patch, emits telemetry, exits 1', async () => {
    const { client, handles } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
    const events: MigrationResult[] = []
    const code = await runMigrateVideos(
      makeCtx(client).ctx,
      {
        streamConfig: STREAM_CONFIG,
        resolveVimeo: fakeResolveVimeoFn(),
        uploadToStream: fakeUploadToStreamFn({ fail: true }),
        emitTelemetry: e => {
          events.push(e)
        },
        skipPace: true,
        now: FROZEN_NOW,
      },
    )
    expect(code).toBe(1)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(events[0].outcome).toBe('stream_upload_failed')
    expect(events[0].streamUid).toBe('')
  })

  it('data_ref_patch_failed: orphan stream_uid is captured in telemetry', async () => {
    const { client, handles } = fakeClient({
      rows: [ROW_VIDEO_VIMEO_1],
      patchFailFor: new Set([ROW_VIDEO_VIMEO_1.id]),
    })
    const events: MigrationResult[] = []
    const code = await runMigrateVideos(
      makeCtx(client).ctx,
      {
        streamConfig: STREAM_CONFIG,
        resolveVimeo: fakeResolveVimeoFn(),
        uploadToStream: fakeUploadToStreamFn(),
        emitTelemetry: e => {
          events.push(e)
        },
        skipPace: true,
        now: FROZEN_NOW,
      },
    )
    expect(code).toBe(1)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(events[0]).toMatchObject({
      outcome: 'data_ref_patch_failed',
      streamUid: 'stream-uid-1',
    })
    expect(events[0].errorMessage).toContain('503')
  })

  it('telemetry emit failure does not abort the migration', async () => {
    const { client, handles } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1, ROW_VIDEO_VIMEO_2] })
    const code = await runMigrateVideos(
      makeCtx(client).ctx,
      {
        streamConfig: STREAM_CONFIG,
        resolveVimeo: fakeResolveVimeoFn(),
        uploadToStream: fakeUploadToStreamFn(),
        emitTelemetry: () => {
          throw new Error('telemetry endpoint down')
        },
        skipPace: true,
        now: FROZEN_NOW,
      },
    )
    expect(code).toBe(0)
    // Both rows still PATCHed despite the per-row telemetry throw.
    expect(handles.updateDataset).toHaveBeenCalledTimes(2)
  })

  it('--limit caps the number of rows actually migrated', async () => {
    const { client, handles } = fakeClient({
      rows: [ROW_VIDEO_VIMEO_1, ROW_VIDEO_VIMEO_2],
    })
    const { ctx } = makeCtx(client, { limit: '1' })
    const code = await runMigrateVideos(ctx, {
      streamConfig: STREAM_CONFIG,
      resolveVimeo: fakeResolveVimeoFn(),
      uploadToStream: fakeUploadToStreamFn(),
      skipPace: true,
    })
    expect(code).toBe(0)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(handles.updateDataset.mock.calls[0][0]).toBe(ROW_VIDEO_VIMEO_1.id)
  })

  it('records durationMs on every result', async () => {
    const { client } = fakeClient({ rows: [ROW_VIDEO_VIMEO_1] })
    const events: MigrationResult[] = []
    await runMigrateVideos(
      makeCtx(client).ctx,
      {
        streamConfig: STREAM_CONFIG,
        resolveVimeo: fakeResolveVimeoFn(),
        uploadToStream: fakeUploadToStreamFn(),
        emitTelemetry: e => {
          events.push(e)
        },
        skipPace: true,
        now: FROZEN_NOW,
      },
    )
    expect(events[0].durationMs).toBeGreaterThan(0)
  })
})
