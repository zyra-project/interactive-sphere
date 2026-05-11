/**
 * Tests for `cli/lib/migration-telemetry.ts` (Phase 2 commit E's
 * operator-side emitter).
 *
 * Coverage:
 *   - Single-event POST to `<serverUrl>/api/ingest`
 *   - Body shape — `{ session_id, events: [{ event_type:
 *     'migration_video', ... }] }`
 *   - Session id reuse across emits within one emitter
 *   - Emit failures (transport error / non-2xx) call onWarn but
 *     do not throw
 *   - serverUrl trailing-slash trim
 */

import { describe, expect, it, vi } from 'vitest'
import { makeMigrationTelemetryEmitter } from './migration-telemetry'
import type { MigrationResult } from '../migrate-videos'

const SAMPLE: MigrationResult = {
  datasetId: 'DS00001AAAAAAAAAAAAAAAAAAAAA',
  legacyId: 'INTERNAL_SOS_768',
  vimeoId: '1107911993',
  streamUid: 'stream-abc',
  bytesUploaded: 1024,
  durationMs: 4200,
  outcome: 'ok',
  errorMessage: '',
}

describe('makeMigrationTelemetryEmitter', () => {
  it('POSTs a single migration_video event to /api/ingest', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response('{}', { status: 200 })
    })
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://terraviz.test',
      sessionId: 'fixed-session',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    expect(captured).not.toBeNull()
    expect(captured!.url).toBe('https://terraviz.test/api/ingest')
    expect(captured!.init.method).toBe('POST')
    expect((captured!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
    const body = JSON.parse(captured!.init.body as string)
    expect(body).toEqual({
      session_id: 'fixed-session',
      events: [
        {
          event_type: 'migration_video',
          dataset_id: SAMPLE.datasetId,
          legacy_id: SAMPLE.legacyId,
          vimeo_id: SAMPLE.vimeoId,
          stream_uid: SAMPLE.streamUid,
          bytes_uploaded: SAMPLE.bytesUploaded,
          duration_ms: SAMPLE.durationMs,
          outcome: SAMPLE.outcome,
        },
      ],
    })
  })

  it('reuses the session id across emits', async () => {
    const sessions: string[] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { session_id: string }
      sessions.push(body.session_id)
      return new Response('{}', { status: 200 })
    })
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    await emitter.emit({ ...SAMPLE, datasetId: 'DS2' })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toBe(sessions[1])
    expect(sessions[0]).toBe(emitter.sessionId)
  })

  it('trims trailing slashes from the serverUrl', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://x.test/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://x.test/api/ingest')
  })

  it('stamps an Origin header matching the serverUrl (2/M)', async () => {
    // The ingest endpoint's isAllowedOrigin check rejects empty
    // origins outright. Without this header the CLI's POST 403s.
    // Live --dry-run on 2024-05-11 surfaced this; the regression
    // test pins the header so a future refactor can't silently
    // drop it.
    let captured: RequestInit | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init
      return new Response('{}', { status: 200 })
    })
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://terraviz.zyra-project.org',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    const headers = (captured!.headers as Record<string, string>) ?? {}
    expect(headers.Origin).toBe('https://terraviz.zyra-project.org')
  })

  it('derives the Origin from a serverUrl that has a port + trailing slash', async () => {
    let captured: RequestInit | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init
      return new Response('{}', { status: 200 })
    })
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'http://localhost:8788/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    const headers = (captured!.headers as Record<string, string>) ?? {}
    // URL.origin strips trailing slash and preserves port.
    expect(headers.Origin).toBe('http://localhost:8788')
  })

  it('omits the Origin header when the serverUrl is malformed', async () => {
    let captured: RequestInit | null = null
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init
      return new Response('{}', { status: 200 })
    })
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'not-a-url',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await emitter.emit(SAMPLE)
    const headers = (captured!.headers as Record<string, string>) ?? {}
    expect(headers.Origin).toBeUndefined()
  })

  it('warns but does not throw when the transport rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED')
    })
    const warnings: string[] = []
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onWarn: msg => warnings.push(msg),
    })
    await expect(emitter.emit(SAMPLE)).resolves.toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(SAMPLE.datasetId)
    expect(warnings[0]).toContain('unreachable')
  })

  it('warns but does not throw when the server returns non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }))
    const warnings: string[] = []
    const emitter = makeMigrationTelemetryEmitter({
      serverUrl: 'https://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onWarn: msg => warnings.push(msg),
    })
    await emitter.emit(SAMPLE)
    expect(warnings[0]).toContain('429')
    expect(warnings[0]).toContain(SAMPLE.datasetId)
  })

  it('generates a fresh session id when none is provided', () => {
    const a = makeMigrationTelemetryEmitter({ serverUrl: 'https://x' })
    const b = makeMigrationTelemetryEmitter({ serverUrl: 'https://x' })
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.sessionId.length).toBeGreaterThan(10)
  })
})
