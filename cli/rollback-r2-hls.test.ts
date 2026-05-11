/**
 * Tests for `terraviz rollback-r2-hls` (Phase 3 commit F).
 *
 * Coverage:
 *   - Argument validation (missing dataset_id; missing /
 *     non-numeric --to-vimeo)
 *   - GET failure exits 1, no mutations
 *   - Refuses non-r2: data_refs (already on vimeo:, on url:, etc.)
 *   - --dry-run prints plan, no mutations
 *   - Happy path: PATCH then DELETE both succeed
 *   - PATCH failure: exit 1, DELETE never attempted
 *   - DELETE failure: soft-fail, exit 0, data_ref still flipped
 *   - Missing R2 credentials: exit 0 with orphan warning
 *   - Commit-point ordering pinned (PATCH always before DELETE)
 */

import { describe, expect, it, vi } from 'vitest'
import { runRollbackR2Hls } from './rollback-r2-hls'
import type { CommandContext } from './commands'
import type { TerravizClient } from './lib/client'
import { parseArgs } from './lib/args'
import type { R2UploadConfig } from './lib/r2-upload'

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

const R2_CONFIG: R2UploadConfig = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  bucket: 'terraviz-assets',
}

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
const VIMEO_ID = '808489116'
const MIGRATED_ROW: RowState = {
  id: DS_ID,
  data_ref: `r2:videos/${DS_ID}/master.m3u8`,
  title: 'Tsunami: Asteroid Impact',
}

describe('runRollbackR2Hls — argument validation', () => {
  it('exits 2 when no dataset id is given', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('Usage:')
  })

  it('exits 2 when --to-vimeo is missing', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [DS_ID])
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('--to-vimeo')
  })

  it('exits 2 when --to-vimeo is non-numeric', async () => {
    const { client } = fakeClient()
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': 'not-a-number' })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(err.text()).toContain('must be a numeric Vimeo id')
  })
})

describe('runRollbackR2Hls — plan validation', () => {
  it('exits 1 when the GET fails', async () => {
    const { client, handles } = fakeClient({ getFails: true })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(1)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Could not GET')
  })

  it('refuses when data_ref is already on vimeo:', async () => {
    const { client, handles } = fakeClient({
      row: { id: DS_ID, data_ref: 'vimeo:123456' },
    })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Nothing to roll back')
  })

  it('refuses when data_ref is on a non-r2-videos scheme (url:, stream:)', async () => {
    const { client, handles } = fakeClient({
      row: { id: DS_ID, data_ref: 'stream:abc123' },
    })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Nothing to roll back')
  })

  it('refuses r2: refs that do not target the videos/ prefix', async () => {
    // Image r2: refs use `r2:datasets/...` — not migration territory.
    const { client, handles } = fakeClient({
      row: { id: DS_ID, data_ref: 'r2:datasets/x/asset.png' },
    })
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, { r2Config: R2_CONFIG })
    expect(code).toBe(2)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(err.text()).toContain('Nothing to roll back')
  })
})

describe('runRollbackR2Hls — dry-run', () => {
  it('prints the plan and exits 0 without mutating', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW })
    const deleteR2Prefix = vi.fn()
    const { ctx, out } = makeCtx(client, [DS_ID], {
      'to-vimeo': VIMEO_ID,
      'dry-run': true,
    })
    const code = await runRollbackR2Hls(ctx, {
      r2Config: R2_CONFIG,
      deleteR2Prefix,
    })
    expect(code).toBe(0)
    expect(handles.updateDataset).not.toHaveBeenCalled()
    expect(deleteR2Prefix).not.toHaveBeenCalled()
    expect(out.text()).toContain('Rollback plan:')
    expect(out.text()).toContain(`vimeo:${VIMEO_ID}`)
    expect(out.text()).toContain(`videos/${DS_ID}/`)
    expect(out.text()).toContain('Dry run')
  })
})

describe('runRollbackR2Hls — live rollback', () => {
  it('PATCHes data_ref then deletes the R2 prefix (happy path, commit ordering)', async () => {
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
    const deleteR2Prefix = vi.fn(async () => {
      callOrder.push('delete')
      return { deleted: 12, durationMs: 1500 }
    })
    const { ctx, out, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, {
      r2Config: R2_CONFIG,
      deleteR2Prefix: deleteR2Prefix as unknown as typeof import('./lib/r2-upload').deleteR2Prefix,
    })
    expect(code).toBe(0)
    // Commit-point ordering invariant: PATCH always before DELETE.
    expect(callOrder).toEqual(['patch', 'delete'])
    expect(handles.updateDataset).toHaveBeenCalledWith(DS_ID, {
      data_ref: `vimeo:${VIMEO_ID}`,
    })
    // The prefix passed to deleteR2Prefix strips the master.m3u8
    // filename, leaving just the bundle's directory.
    expect(deleteR2Prefix).toHaveBeenCalledWith(R2_CONFIG, `videos/${DS_ID}`)
    expect(out.text()).toContain('✓ data_ref flipped')
    expect(out.text()).toContain('deleted 12 R2 object(s)')
    expect(out.text()).toContain('Rollback complete')
    expect(err.text()).toBe('')
  })

  it('exits 1 when the PATCH fails — never attempts DELETE', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW, patchFails: true })
    const deleteR2Prefix = vi.fn()
    const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, {
      r2Config: R2_CONFIG,
      deleteR2Prefix,
    })
    expect(code).toBe(1)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(deleteR2Prefix).not.toHaveBeenCalled()
    expect(err.text()).toContain('data_ref PATCH failed (503)')
  })

  it('soft-fails on DELETE failure — exit 0, data_ref still flipped', async () => {
    const { client, handles } = fakeClient({ row: MIGRATED_ROW })
    const deleteR2Prefix = vi.fn(async () => {
      throw new Error('R2 LIST timed out')
    })
    const { ctx, err, out } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
    const code = await runRollbackR2Hls(ctx, {
      r2Config: R2_CONFIG,
      deleteR2Prefix: deleteR2Prefix as unknown as typeof import('./lib/r2-upload').deleteR2Prefix,
    })
    expect(code).toBe(0)
    expect(handles.updateDataset).toHaveBeenCalledTimes(1)
    expect(out.text()).toContain('✓ data_ref flipped')
    expect(err.text()).toContain('Could not delete R2 prefix')
    expect(err.text()).toContain('delete the orphan')
  })

  it('warns about orphan and skips DELETE when R2 creds are absent', async () => {
    const prev = {
      end: process.env.R2_S3_ENDPOINT,
      ak: process.env.R2_ACCESS_KEY_ID,
      sk: process.env.R2_SECRET_ACCESS_KEY,
    }
    delete process.env.R2_S3_ENDPOINT
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    try {
      const { client, handles } = fakeClient({ row: MIGRATED_ROW })
      const deleteR2Prefix = vi.fn()
      const { ctx, err } = makeCtx(client, [DS_ID], { 'to-vimeo': VIMEO_ID })
      const code = await runRollbackR2Hls(ctx, { deleteR2Prefix })
      expect(code).toBe(0)
      expect(handles.updateDataset).toHaveBeenCalledTimes(1)
      expect(deleteR2Prefix).not.toHaveBeenCalled()
      expect(err.text()).toContain('R2 credentials unset')
      expect(err.text()).toContain('orphan')
    } finally {
      if (prev.end !== undefined) process.env.R2_S3_ENDPOINT = prev.end
      if (prev.ak !== undefined) process.env.R2_ACCESS_KEY_ID = prev.ak
      if (prev.sk !== undefined) process.env.R2_SECRET_ACCESS_KEY = prev.sk
    }
  })
})
