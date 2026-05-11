/**
 * Tests for `terraviz rollback-stream` (Phase 2 commit R).
 *
 * The subcommand is exercised against:
 *   - a hand-rolled fake `TerravizClient` whose `get` and
 *     `updateDataset` methods record calls and serve fixed
 *     responses;
 *   - a DI hook for `deleteStreamAsset` so a unit test exercises
 *     the rollback loop without ever hitting the Cloudflare API.
 *
 * Coverage:
 *   - --dry-run prints the plan and never mutates
 *   - happy path: PATCH then DELETE both succeed
 *   - data_ref already on vimeo:: refuses with exit 2
 *   - data_ref on url: (non-stream): refuses with exit 2
 *   - missing --to-vimeo flag: exit 2
 *   - non-numeric --to-vimeo: exit 2
 *   - GET failure: exit 1, no mutations
 *   - PATCH failure: exit 1, no DELETE attempted
 *   - DELETE failure: exit 0 with warning, data_ref still flipped
 *   - missing STREAM creds: exit 0 with orphan warning, data_ref
 *     still flipped
 *   - two-stage commit-point ordering: PATCH always before DELETE
 */

import { describe, expect, it, vi } from 'vitest'
import { runRollbackStream } from './rollback-stream'
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

const STREAM_CONFIG = { accountId: 'acc-1', apiToken: 'tok-1' }

interface RowState {
  id: string
  data_ref: string
  title?: string
}

interface FakeClientOptions {
  row?: RowState
  getFails?: boolean
  patchFails?: boolean
}

function fakeClient(opts: FakeClientOptions = {}) {
  const get = vi.fn(async (_id: string) => {
    if (opts.getFails) {
      return { ok: false as const, status: 404, error: 'not_found' }
    }
    if (!opts.row) {
      return { ok: false as const, status: 404, error: 'not_found' }
    }
    return { ok: true as const, status: 200, body: { dataset: opts.row } }
  })
  const updateDataset = vi.fn(async (id: string, body: Record<string, unknown>) => {
    if (opts.patchFails) {
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
  const stub = { serverUrl: 'http://localhost:8788', get, updateDataset }
  return { client: stub as unknown as TerravizClient, handles: { get, updateDataset } }
}

function makeCtx(
  client: TerravizClient,
  positional: string[],
  flags: Record<string, string | boolean> = {},
): { ctx: CommandContext; out: BufStream; err: BufStream } {
  const out = makeStream()
  const err = makeStream()
  const argv: string[] = [...positional]
  for (const [k, v] of Object.entries(flags)) {
    if (v === true) argv.push(`--${k}`)
    else argv.push(`--${k}=${String(v)}`)
  }
  const args = parseArgs(argv)
  return { ctx: { client, args, stdout: out, stderr: err }, out, err }
}

const DS_ID = 'DS00001AAAAAAAAAAAAAAAAAAAAA'
const STREAM_UID = '3bb39aa4006fa5c7310728967637473b'
const VIMEO_ID = '808489116'
const MIGRATED_ROW: RowState = {
  id: DS_ID,
  data_ref: `stream:${STREAM_UID}`,
  title: 'Tsunami: Asteroid Impact',
}

describe('runRollbackStream — argument validation', () => {
  it('exits 2 when no dataset id is given', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('Usage:')
  })

  it('exits 2 when --to-vimeo is missing', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [DS_ID])
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('--to-vimeo')
  })

  it('exits 2 when --to-vimeo is non-numeric', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': 'not-a-number' })
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('must be a numeric Vimeo id')
  })
})

describe('runRollbackStream — plan validation', () => {
  it('exits 1 when the GET fails', async () => {
    const { client, handles } = fakeClient({ getFails: true })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(1)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Could not GET')
  })

  it('refuses when data_ref is already on vimeo:', async () => {
    const { client, handles } = fakeClient({
      row: { id: DS_ID, data_ref: 'vimeo:123456' },
    })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Nothing to roll back')
  })

  it('refuses when data_ref is on a non-stream scheme (url:, r2:)', async () => {
    const { client, handles } = fakeClient({
      row: { id: DS_ID, data_ref: 'url:https://example.org/x.mp4' },
    })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, { streamConfig: STREAM_CONFIG })
    expect(code).toBe(2)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Nothing to roll back')
  })
})

describe('runRollbackStream — dry-run', () => {
  it('prints the plan and exits 0 without mutating', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW })
    const deleteStreamAsset = vi.fn()
    const { ctx, out } = makeCtx(client, [DS_ID], {
      'to-vimeo': VIMEO_ID,
      'dry-run': true,
    })
    const code = await runRollbackStream(ctx, {
      streamConfig: STREAM_CONFIG,
      deleteStreamAsset,
    })
    expect(code).toBe(0)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(deleteStreamAsset).not.toHaveBeenCalled()
    expect(out.text()).toContain('Rollback plan:')
    expect(out.text()).toContain(`vimeo:${VIMEO_ID}`)
    expect(out.text()).toContain(STREAM_UID)
    expect(out.text()).toContain('Dry run')
  })
})

describe('runRollbackStream — live rollback', () => {
  it('PATCHes data_ref then deletes the Stream asset (happy path)', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW })
    const callOrder: string[] = []
    handles.updateDataset.mockImplementationOnce(async (id, body) => {
      callOrder.push('patch')
      return {
        ok: true as const,
        status: 200,
        body: { dataset: { id, slug: 's', ...body } },
      }
    })
    const deleteStreamAsset = vi.fn(async () => {
      callOrder.push('delete')
    })
    const { ctx, out, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, {
      streamConfig: STREAM_CONFIG,
      deleteStreamAsset: deleteStreamAsset as unknown as typeof import('./lib/stream-upload').deleteStreamAsset,
    })
    expect(code).toBe(0)
    // Commit-point ordering: PATCH before DELETE always.
    expect(callOrder).toEqual(['patch', 'delete'])
    expect(handles.updateDataset).toHaveBeenCalledWith(DS_ID, {
      data_ref: `vimeo:${VIMEO_ID}`,
    })
    expect(deleteStreamAsset).toHaveBeenCalledWith(STREAM_CONFIG, STREAM_UID)
    expect(out.text()).toContain('✓ data_ref flipped')
    expect(out.text()).toContain('✓ stream:')
    expect(out.text()).toContain('Rollback complete')
    expect(err.text()).toBe('')
  })

  it('exits 1 when the PATCH fails — never attempts DELETE', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW, patchFails: true })
    const deleteStreamAsset = vi.fn()
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, {
      streamConfig: STREAM_CONFIG,
      deleteStreamAsset,
    })
    expect(code).toBe(1)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(deleteStreamAsset).not.toHaveBeenCalled()
    expect(err.text()).toContain('data_ref PATCH failed (503)')
  })

  it('soft-fails on DELETE failure — exit 0, data_ref still flipped, warning on stderr', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW })
    const deleteStreamAsset = vi.fn(async () => {
      throw new Error('upstream timed out')
    })
    const { ctx, err, out } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackStream(ctx, {
      streamConfig: STREAM_CONFIG,
      deleteStreamAsset: deleteStreamAsset as unknown as typeof import('./lib/stream-upload').deleteStreamAsset,
    })
    expect(code).toBe(0)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(out.text()).toContain('✓ data_ref flipped')
    expect(err.text()).toContain('Could not delete')
    expect(err.text()).toContain('delete the orphan manually')
  })

  it('warns about orphan and skips DELETE when STREAM creds are absent', async () => {
    const prevA = process.env.STREAM_ACCOUNT_ID
    const prevT = process.env.STREAM_API_TOKEN
    delete process.env.STREAM_ACCOUNT_ID
    delete process.env.STREAM_API_TOKEN
    try {
      const { client, handles } = fakeClient({ row: MIGRATED_ROW })
      const deleteStreamAsset = vi.fn()
      const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
      const code = await runRollbackStream(ctx, { deleteStreamAsset })
      expect(code).toBe(0)
      expect(handles.updateDataset).toHaveBeenCalledTimes(1)
      expect(deleteStreamAsset).not.toHaveBeenCalled()
      expect(err.text()).toContain('STREAM credentials unset')
      expect(err.text()).toContain('orphan stream:')
    } finally {
      if (prevA !== undefined) process.env.STREAM_ACCOUNT_ID = prevA
      if (prevT !== undefined) process.env.STREAM_API_TOKEN = prevT
    }
  })
})
