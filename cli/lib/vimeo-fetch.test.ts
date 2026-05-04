/**
 * Tests for `cli/lib/vimeo-fetch.ts` (Phase 2 commit A).
 *
 * The helper splits the resolution into two HTTP hops — a metadata
 * GET against the proxy and a body GET against the resulting MP4
 * URL. Tests stub `fetchImpl` and assert on:
 *
 *   - URL shape (default proxy base; override; trailing-slash trim)
 *   - JSON parsing of the proxy manifest
 *   - Quality selection picking the largest MP4 by size, then width
 *   - Non-MP4 files (HLS playlists, audio) skipped
 *   - Error envelopes for each failure stage (`metadata`, `selection`, `bytes`)
 *   - openStream() requires Content-Length (TUS contract)
 *
 * The test file is a peer of the implementation under `cli/lib/`,
 * matching the pattern set by `client.test.ts` and
 * `snapshot-import.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VIDEO_PROXY_BASE,
  pickHighestQualityMp4,
  resolveVimeo,
  VimeoFetchError,
} from './vimeo-fetch'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  })
}

function bytesResponse(body: string | Uint8Array, init: ResponseInit = {}): Response {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body
  // Round-trip through a fresh ArrayBuffer so the DOM `BodyInit`
  // type-check accepts it — same pattern used by `client.ts`'s
  // `uploadBytes`.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return new Response(ab, {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(buf.byteLength),
      ...(init.headers as Record<string, string>),
    },
  })
}

const MP4_4K = {
  quality: 'hd',
  width: 3840,
  height: 2160,
  size: 1_500_000_000,
  type: 'video/mp4',
  link: 'https://cdn.example.org/v/123/4k.mp4',
}
const MP4_HD = {
  quality: 'hd',
  width: 1920,
  height: 1080,
  size: 600_000_000,
  type: 'video/mp4',
  link: 'https://cdn.example.org/v/123/hd.mp4',
}
const MP4_SD = {
  quality: 'sd',
  width: 960,
  height: 540,
  size: 100_000_000,
  type: 'video/mp4',
  link: 'https://cdn.example.org/v/123/sd.mp4',
}

describe('pickHighestQualityMp4', () => {
  it('returns the largest-by-size MP4 file', () => {
    expect(pickHighestQualityMp4([MP4_SD, MP4_4K, MP4_HD])).toBe(MP4_4K)
  })

  it('breaks ties on size with width', () => {
    const a = { ...MP4_HD, size: 500, width: 1920 }
    const b = { ...MP4_HD, size: 500, width: 1280, link: 'https://x/y.mp4' }
    expect(pickHighestQualityMp4([b, a])).toBe(a)
  })

  it('skips non-mp4 entries', () => {
    const hls = { quality: 'hls', type: 'application/x-mpegURL', link: 'https://x/y.m3u8', size: 999_999 }
    const audio = { quality: 'audio', type: 'audio/mp4', link: 'https://x/y.m4a', size: 999_999 }
    expect(pickHighestQualityMp4([hls, audio, MP4_SD])).toBe(MP4_SD)
  })

  it('skips files without a link', () => {
    const orphan = { quality: 'hd', type: 'video/mp4', size: 1_000_000_000 }
    expect(pickHighestQualityMp4([orphan, MP4_SD])).toBe(MP4_SD)
  })

  it('returns null when no MP4 qualifies', () => {
    const hls = { quality: 'hls', type: 'application/x-mpegURL', link: 'https://x/y.m3u8' }
    expect(pickHighestQualityMp4([hls])).toBeNull()
    expect(pickHighestQualityMp4([])).toBeNull()
  })

  it('treats missing type as a skip (not a guess)', () => {
    const noType = { quality: 'hd', link: 'https://x/y.mp4', size: 999_999 }
    expect(pickHighestQualityMp4([noType, MP4_SD])).toBe(MP4_SD)
  })
})

describe('resolveVimeo', () => {
  it('hits the default proxy base for the metadata fetch', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${DEFAULT_VIDEO_PROXY_BASE}/123`)
      return jsonResponse({ id: '123', duration: 42, files: [MP4_HD] })
    })
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(handle.metadata.vimeoId).toBe('123')
    expect(handle.metadata.durationSeconds).toBe(42)
    expect(handle.metadata.mp4Link).toBe(MP4_HD.link)
    expect(handle.metadata.advertisedBytes).toBe(MP4_HD.size)
  })

  it('honours a custom proxyBase override and trims trailing slashes', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://video-proxy.test/video/456')
      return jsonResponse({ id: '456', files: [MP4_SD] })
    })
    await resolveVimeo('456', {
      proxyBase: 'https://video-proxy.test/video/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects non-numeric vimeo ids before any network call', async () => {
    const fetchImpl = vi.fn()
    await expect(
      resolveVimeo('abc', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      name: 'VimeoFetchError',
      stage: 'metadata',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws VimeoFetchError(metadata) on a non-OK proxy response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }))
    await expect(
      resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      name: 'VimeoFetchError',
      stage: 'metadata',
      status: 502,
    })
  })

  it('throws VimeoFetchError(metadata) when the proxy network call rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connection refused')
    })
    await expect(
      resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      name: 'VimeoFetchError',
      stage: 'metadata',
      status: null,
    })
  })

  it('throws VimeoFetchError(selection) when no MP4 is in files[]', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: '123',
        files: [{ quality: 'hls', type: 'application/x-mpegURL', link: 'https://x/y.m3u8' }],
      }),
    )
    await expect(
      resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ stage: 'selection' })
  })

  it('picks the highest-quality MP4 when multiple files are present', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: '123', files: [MP4_SD, MP4_4K, MP4_HD] }),
    )
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(handle.metadata.mp4Link).toBe(MP4_4K.link)
    expect(handle.metadata.advertisedBytes).toBe(MP4_4K.size)
  })

  it('reports duration as null when the proxy omits it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: '123', files: [MP4_HD] }))
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(handle.metadata.durationSeconds).toBeNull()
  })

  it('does not fetch the body until openStream() is called', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      if (url === `${DEFAULT_VIDEO_PROXY_BASE}/123`) {
        return jsonResponse({ id: '123', files: [MP4_HD] })
      }
      return bytesResponse('mp4-bytes-placeholder')
    })
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(calls).toEqual([`${DEFAULT_VIDEO_PROXY_BASE}/123`])
    const body = await handle.openStream()
    expect(calls).toEqual([`${DEFAULT_VIDEO_PROXY_BASE}/123`, MP4_HD.link])
    expect(body.contentLength).toBe(new TextEncoder().encode('mp4-bytes-placeholder').byteLength)
    expect(body.contentType).toBe('video/mp4')
    expect(body.stream).toBeInstanceOf(ReadableStream)
  })

  it('throws VimeoFetchError(bytes) when the MP4 fetch returns 4xx/5xx', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/123')) return jsonResponse({ id: '123', files: [MP4_HD] })
      return new Response('forbidden', { status: 403 })
    })
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(handle.openStream()).rejects.toMatchObject({
      stage: 'bytes',
      status: 403,
    })
  })

  it('throws VimeoFetchError(bytes) when the MP4 fetch omits Content-Length', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/123')) return jsonResponse({ id: '123', files: [MP4_HD] })
      // Build a response with no Content-Length — `Response` will
      // synthesise one for a String body, so use a stream instead.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      })
    })
    const handle = await resolveVimeo('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(handle.openStream()).rejects.toMatchObject({ stage: 'bytes' })
  })

  it('VimeoFetchError surfaces vimeoId for telemetry attribution', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 504 }))
    try {
      await resolveVimeo('999', { fetchImpl: fetchImpl as unknown as typeof fetch })
    } catch (e) {
      expect(e).toBeInstanceOf(VimeoFetchError)
      expect((e as VimeoFetchError).vimeoId).toBe('999')
      expect((e as VimeoFetchError).stage).toBe('metadata')
      expect((e as VimeoFetchError).status).toBe(504)
    }
  })
})
