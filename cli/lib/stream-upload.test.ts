/**
 * Tests for `cli/lib/stream-upload.ts` (Phase 2 commit B).
 *
 * The helper is exercised against a stubbed `fetchImpl` that
 * answers two requests:
 *   1. POST `…/stream?direct_user=true` — TUS create → 201 with
 *      `Location` and `stream-media-id` headers.
 *   2. PATCH `<location>` — TUS upload → 204 with
 *      `Upload-Offset` matching `Upload-Length`.
 *
 * Coverage:
 *   - URL shape (default API base; override; trailing-slash trim)
 *   - Auth header on the create call
 *   - Tus-Resumable: 1.0.0 + Upload-Length on create
 *   - Upload-Metadata encoded as base64 key/value pairs when
 *     `options.meta` is provided
 *   - Returns the streamUid from `stream-media-id`
 *   - Returns bytesUploaded from `Upload-Offset`
 *   - Mismatched Upload-Offset / Upload-Length surfaces as an error
 *   - Streaming body: the PATCH receives `body` as a
 *     `ReadableStream`, not a buffered Uint8Array
 *   - Error stages: config, create, upload
 */

import { describe, expect, it, vi } from 'vitest'
import { StreamUploadError, uploadToStream } from './stream-upload'

const ACCOUNT = 'acc-12345'
const TOKEN = 'tok-secret'

function makeBody(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

interface CapturedCall {
  url: string
  init: RequestInit & { duplex?: string }
}

interface StubOptions {
  /** Override the create response. */
  createStatus?: number
  createHeaders?: Record<string, string>
  /** Omit Location / stream-media-id selectively. */
  omitLocation?: boolean
  omitStreamUid?: boolean
  /** Override the PATCH response. */
  patchStatus?: number
  patchOffset?: string | null
  /** Throw on the create or patch fetch (network simulation). */
  throwOn?: 'create' | 'patch'
}

function makeFetchStub(opts: StubOptions = {}): {
  fetchImpl: typeof fetch
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const stub = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init: init as RequestInit & { duplex?: string } })
    if (init.method === 'POST') {
      if (opts.throwOn === 'create') throw new TypeError('connect ECONNREFUSED')
      const headers: Record<string, string> = {
        'Tus-Resumable': '1.0.0',
      }
      if (!opts.omitLocation) headers['Location'] = 'https://upload.cloudflarestream.com/abc123'
      if (!opts.omitStreamUid) headers['stream-media-id'] = 'abc123'
      Object.assign(headers, opts.createHeaders)
      return new Response(null, { status: opts.createStatus ?? 201, headers })
    }
    if (init.method === 'PATCH') {
      if (opts.throwOn === 'patch') throw new TypeError('PATCH: connection reset')
      const headers: Record<string, string> = { 'Tus-Resumable': '1.0.0' }
      // Default Upload-Offset echoes Content-Length so bodies of
      // any size in tests register as a clean upload. Tests that
      // care about a mismatch override `patchOffset` explicitly.
      const requestLen = (init.headers as Record<string, string>)['Content-Length'] ?? '0'
      const offset = opts.patchOffset === undefined ? requestLen : opts.patchOffset
      if (offset !== null) headers['Upload-Offset'] = offset
      return new Response(null, { status: opts.patchStatus ?? 204, headers })
    }
    throw new Error(`unexpected method: ${init.method}`)
  })
  return { fetchImpl: stub as unknown as typeof fetch, calls }
}

describe('uploadToStream — happy path', () => {
  it('issues TUS create against the default API base then PATCHes the Location URL', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    const result = await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      makeBody('hello-stream-'),
      13,
      { fetchImpl },
    )
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream?direct_user=true`,
    )
    expect(calls[0].init.method).toBe('POST')
    const createHeaders = calls[0].init.headers as Record<string, string>
    expect(createHeaders.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(createHeaders['Tus-Resumable']).toBe('1.0.0')
    expect(createHeaders['Upload-Length']).toBe('13')
    expect(calls[1].url).toBe('https://upload.cloudflarestream.com/abc123')
    expect(calls[1].init.method).toBe('PATCH')
    const patchHeaders = calls[1].init.headers as Record<string, string>
    expect(patchHeaders['Upload-Offset']).toBe('0')
    expect(patchHeaders['Content-Type']).toBe('application/offset+octet-stream')
    // Streaming body — Node fetch requires duplex: 'half' when body
    // is a ReadableStream. Verify both directly.
    expect(calls[1].init.duplex).toBe('half')
    expect(calls[1].init.body).toBeInstanceOf(ReadableStream)
    expect(result.streamUid).toBe('abc123')
    expect(result.bytesUploaded).toBe(13)
    expect(result.uploadUrl).toBe('https://upload.cloudflarestream.com/abc123')
  })

  it('accepts a Uint8Array body without setting duplex (2/O)', async () => {
    // The buffered path is the CLI's default post-2/O — undici can
    // replay it on Cloudflare's regional redirects, which a
    // streaming body can't survive. Pin the headers + the *absence*
    // of `duplex: 'half'` so a future refactor can't silently
    // regress to streaming.
    const { fetchImpl, calls } = makeFetchStub()
    const bytes = new TextEncoder().encode('hello-buffered')
    const result = await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      bytes,
      bytes.byteLength,
      { fetchImpl },
    )
    expect(calls).toHaveLength(2)
    expect(calls[1].init.method).toBe('PATCH')
    // No duplex on the buffered path.
    expect(calls[1].init.duplex).toBeUndefined()
    expect(calls[1].init.body).toBe(bytes)
    expect(result.streamUid).toBe('abc123')
    expect(result.bytesUploaded).toBe(bytes.byteLength)
  })

  it('honours apiBase override and trims trailing slashes', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      makeBody('xx'),
      2,
      { fetchImpl, apiBase: 'https://stream-api.test/v4/' },
    )
    expect(calls[0].url).toBe(`https://stream-api.test/v4/accounts/${ACCOUNT}/stream?direct_user=true`)
  })

  it('encodes Upload-Metadata when meta.name / meta.filename are provided', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      makeBody('xx'),
      2,
      { fetchImpl, meta: { name: 'Hurricane Season - 2024', filename: 'hs2024.mp4' } },
    )
    const headers = calls[0].init.headers as Record<string, string>
    const meta = headers['Upload-Metadata']
    expect(meta).toBeDefined()
    // base64('Hurricane Season - 2024') and base64('hs2024.mp4')
    const expectedName = btoa(unescape(encodeURIComponent('Hurricane Season - 2024')))
    const expectedFile = btoa(unescape(encodeURIComponent('hs2024.mp4')))
    expect(meta).toBe(`name ${expectedName},filename ${expectedFile}`)
  })

  it('omits Upload-Metadata when meta is empty / absent', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      makeBody('xx'),
      2,
      { fetchImpl },
    )
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Upload-Metadata']).toBeUndefined()
  })
})

describe('uploadToStream — error envelopes', () => {
  it('throws StreamUploadError(config) when accountId is empty', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    await expect(
      uploadToStream(
        { accountId: '', apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ name: 'StreamUploadError', stage: 'config' })
    expect(calls).toHaveLength(0)
  })

  it('throws StreamUploadError(config) when apiToken is empty', async () => {
    const { fetchImpl, calls } = makeFetchStub()
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: '' },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'config' })
    expect(calls).toHaveLength(0)
  })

  it('throws StreamUploadError(config) on non-positive contentLength', async () => {
    const { fetchImpl } = makeFetchStub()
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        0,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'config' })
  })

  it('throws StreamUploadError(create) when the create POST returns non-201', async () => {
    const { fetchImpl } = makeFetchStub({ createStatus: 401 })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'create', status: 401 })
  })

  it('throws StreamUploadError(create) when the create POST throws', async () => {
    const { fetchImpl } = makeFetchStub({ throwOn: 'create' })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'create', status: null })
  })

  it('throws StreamUploadError(create) when Location header is missing', async () => {
    const { fetchImpl } = makeFetchStub({ omitLocation: true })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'create' })
  })

  it('throws StreamUploadError(create) when stream-media-id header is missing', async () => {
    const { fetchImpl } = makeFetchStub({ omitStreamUid: true })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'create' })
  })

  it('throws StreamUploadError(upload) when the PATCH returns non-204', async () => {
    const { fetchImpl } = makeFetchStub({ patchStatus: 500 })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('hello'),
        5,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'upload', status: 500 })
  })

  it('throws StreamUploadError(upload) when the PATCH throws', async () => {
    const { fetchImpl } = makeFetchStub({ throwOn: 'patch' })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('hello'),
        5,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'upload', status: null })
  })

  it('throws StreamUploadError(upload) when Upload-Offset disagrees with Upload-Length', async () => {
    const { fetchImpl } = makeFetchStub({ patchOffset: '7' })
    const err = await uploadToStream(
      { accountId: ACCOUNT, apiToken: TOKEN },
      makeBody('hello'),
      5,
      { fetchImpl },
    ).catch(e => e)
    expect(err).toBeInstanceOf(StreamUploadError)
    expect(err.stage).toBe('upload')
    expect(err.message).toMatch(/Upload-Offset \(7\)/)
    expect(err.message).toMatch(/Upload-Length \(5\)/)
  })

  it('throws StreamUploadError(upload) when Upload-Offset is missing', async () => {
    const { fetchImpl } = makeFetchStub({ patchOffset: null })
    await expect(
      uploadToStream(
        { accountId: ACCOUNT, apiToken: TOKEN },
        makeBody('x'),
        1,
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ stage: 'upload' })
  })
})
