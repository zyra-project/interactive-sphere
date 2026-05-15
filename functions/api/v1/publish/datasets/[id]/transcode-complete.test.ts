/**
 * Tests for `POST /api/v1/publish/datasets/{id}/transcode-complete`.
 *
 * The endpoint is the workflow side of the 3pd transcode pipeline:
 * GHA writes the HLS bundle to R2, then PATCHes back through this
 * route to flip `data_ref` and clear `transcoding`. Restricted to
 * service-token / admin callers — community publishers shouldn't
 * be able to manipulate the `transcoding` column directly.
 */

import { describe, expect, it } from 'vitest'
import { onRequestPost as transcodeComplete } from './transcode-complete'
import { asD1, makeKV, seedFixtures } from '../../../_lib/test-helpers'
import type { PublisherRow } from '../../../_lib/publisher-store'

const STAFF_ADMIN: PublisherRow = {
  id: 'PUB-STAFF',
  email: 'staff@example.com',
  display_name: 'Staff',
  affiliation: null,
  org_id: null,
  role: 'staff',
  is_admin: 1,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
}

const SERVICE: PublisherRow = {
  ...STAFF_ADMIN,
  id: 'PUB-SERVICE',
  email: 'transcode@service',
  display_name: 'Transcode service',
  role: 'service',
  is_admin: 0,
}

const COMMUNITY: PublisherRow = {
  ...STAFF_ADMIN,
  id: 'PUB-COMMUNITY',
  email: 'community@example.com',
  display_name: 'Community',
  role: 'community',
  is_admin: 0,
}

function setupEnv(opts: { transcoding?: boolean; sourceDigest?: string } = {}) {
  const sqlite = seedFixtures({ count: 1 })
  for (const p of [STAFF_ADMIN, SERVICE, COMMUNITY]) {
    sqlite
      .prepare(
        `INSERT INTO publishers (id, email, display_name, role, is_admin, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, p.email, p.display_name, p.role, p.is_admin, p.status, p.created_at)
  }
  const datasetId = 'DS000' + 'A'.repeat(21)
  // Seed the row as transcoding=1 by default — this is the state
  // the workflow PATCHes against. Tests for "not transcoding"
  // override to NULL.
  if (opts.transcoding ?? true) {
    sqlite
      .prepare(
        `UPDATE datasets SET transcoding = 1, data_ref = '', source_digest = ? WHERE id = ?`,
      )
      .run(opts.sourceDigest ?? 'sha256:' + 'a'.repeat(64), datasetId)
  }
  return { sqlite, datasetId, env: { CATALOG_DB: asD1(sqlite), CATALOG_KV: makeKV() } }
}

function ctx(opts: {
  env: Record<string, unknown>
  datasetId: string
  publisher?: PublisherRow
  body?: unknown
}) {
  const url = `https://localhost/api/v1/publish/datasets/${opts.datasetId}/transcode-complete`
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    env: opts.env,
    params: { id: opts.datasetId },
    data: { publisher: opts.publisher ?? SERVICE },
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response(null),
    functionPath: new URL(url).pathname,
  } as unknown as Parameters<typeof transcodeComplete>[0]
}

async function readJson<T>(res: Response): Promise<T> {
  return JSON.parse(await res.text()) as T
}

describe('POST .../transcode-complete — happy path', () => {
  it('clears transcoding, sets data_ref, returns the updated row', async () => {
    const { sqlite, datasetId, env } = setupEnv()
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await readJson<{ dataset: { data_ref: string; transcoding: number | null } }>(
      res,
    )
    expect(body.dataset.data_ref).toBe(`r2:videos/${datasetId}/master.m3u8`)
    expect(body.dataset.transcoding).toBeNull()

    const row = sqlite
      .prepare(`SELECT data_ref, transcoding FROM datasets WHERE id = ?`)
      .get(datasetId) as { data_ref: string; transcoding: number | null }
    expect(row.data_ref).toBe(`r2:videos/${datasetId}/master.m3u8`)
    expect(row.transcoding).toBeNull()
  })

  it('writes an audit_events row tagged transcode_complete', async () => {
    const { sqlite, datasetId, env } = setupEnv()
    await transcodeComplete(
      ctx({
        env,
        datasetId,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    const audit = sqlite
      .prepare(
        `SELECT action, metadata_json FROM audit_events WHERE subject_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(datasetId) as { action: string; metadata_json: string }
    expect(audit.action).toBe('dataset.update')
    const meta = JSON.parse(audit.metadata_json) as { fields: string[]; reason: string }
    expect(meta.reason).toBe('transcode_complete')
    expect(meta.fields).toEqual(['data_ref', 'transcoding'])
  })

  it('accepts a matching source_digest belt-and-suspenders check', async () => {
    const sourceDigest = 'sha256:' + 'b'.repeat(64)
    const { datasetId, env } = setupEnv({ sourceDigest })
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        body: {
          data_ref: `r2:videos/${datasetId}/master.m3u8`,
          source_digest: sourceDigest,
        },
      }),
    )
    expect(res.status).toBe(200)
  })
})

describe('POST .../transcode-complete — auth', () => {
  it('allows staff admins through', async () => {
    const { datasetId, env } = setupEnv()
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        publisher: STAFF_ADMIN,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('rejects community publishers with 403', async () => {
    const { datasetId, env } = setupEnv()
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        publisher: COMMUNITY,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    expect(res.status).toBe(403)
    expect((await readJson<{ error: string }>(res)).error).toBe('transcode_complete_forbidden')
  })

  it('rejects non-admin staff with 403', async () => {
    const nonAdmin: PublisherRow = { ...STAFF_ADMIN, is_admin: 0 }
    const { datasetId, env } = setupEnv()
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        publisher: nonAdmin,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe('POST .../transcode-complete — refusals', () => {
  it('returns 404 for an unknown dataset id', async () => {
    const { env } = setupEnv()
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId: 'NOPE',
        body: { data_ref: 'r2:videos/NOPE/master.m3u8' },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 not_transcoding when the row isn’t currently transcoding', async () => {
    const { datasetId, env } = setupEnv({ transcoding: false })
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        body: { data_ref: `r2:videos/${datasetId}/master.m3u8` },
      }),
    )
    expect(res.status).toBe(409)
    expect((await readJson<{ error: string }>(res)).error).toBe('not_transcoding')
  })

  it('returns 409 source_digest_mismatch on a digest mismatch', async () => {
    const { datasetId, env } = setupEnv({ sourceDigest: 'sha256:' + 'a'.repeat(64) })
    const res = await transcodeComplete(
      ctx({
        env,
        datasetId,
        body: {
          data_ref: `r2:videos/${datasetId}/master.m3u8`,
          source_digest: 'sha256:' + 'f'.repeat(64),
        },
      }),
    )
    expect(res.status).toBe(409)
    expect((await readJson<{ error: string }>(res)).error).toBe('source_digest_mismatch')
  })

  it('returns 400 invalid_body on a missing data_ref', async () => {
    const { datasetId, env } = setupEnv()
    const res = await transcodeComplete(ctx({ env, datasetId, body: {} }))
    expect(res.status).toBe(400)
  })

  it('returns 400 invalid_body on a data_ref that doesn’t look like an HLS bundle', async () => {
    const { datasetId, env } = setupEnv()
    for (const badRef of [
      'r2:datasets/abc/by-digest/sha256/x/asset.png',
      'r2:videos/abc/segments.ts',
      'https://example.com/foo',
    ]) {
      const res = await transcodeComplete(
        ctx({ env, datasetId, body: { data_ref: badRef } }),
      )
      expect(res.status).toBe(400)
    }
  })

  it('returns 400 invalid_json on a non-JSON body', async () => {
    const { datasetId, env } = setupEnv()
    const url = `https://localhost/api/v1/publish/datasets/${datasetId}/transcode-complete`
    const baseCtx = ctx({ env, datasetId, body: {} })
    const goodCtx = {
      ...baseCtx,
      request: new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    } as typeof baseCtx
    const res = await transcodeComplete(goodCtx)
    expect(res.status).toBe(400)
    expect((await readJson<{ error: string }>(res)).error).toBe('invalid_json')
  })
})
