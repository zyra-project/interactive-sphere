/**
 * Tests for `cli/lib/r2-upload.ts` (Phase 3 commit B).
 *
 * Coverage:
 *   - Helper exports: `contentTypeForFile`, `buildObjectUrl`,
 *     `walkBundleFiles`, `parseListKeys`, `validateR2Config`,
 *     `loadR2ConfigFromEnv`.
 *   - `uploadHlsBundle`: walks a tmp HLS bundle, asserts the
 *     SigV4-signed PUT shape (Authorization header present,
 *     Content-Type correct per file), that master.m3u8 is required,
 *     bounded concurrency, error propagation.
 *   - `deleteR2Prefix`: LIST + per-object DELETE flow against a
 *     stubbed S3 XML response.
 *
 * Real R2 round-trips are out of scope — the operator's
 * `--dry-run` against a real bucket exercises live S3 API.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildObjectUrl,
  contentTypeForFile,
  deleteR2Prefix,
  loadR2ConfigFromEnv,
  parseListKeys,
  R2UploadError,
  uploadHlsBundle,
  validateR2Config,
  walkBundleFiles,
  type R2UploadConfig,
} from './r2-upload'

const CONFIG: R2UploadConfig = {
  endpoint: 'https://acct123.r2.cloudflarestorage.com',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'secret-key',
  bucket: 'terraviz-assets',
}

function makeBundle(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'r2up-'))
  // Replicate the shape of an HLS bundle produced by ffmpeg-hls.
  writeFileSync(join(tmp, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:6\n')
  for (const i of [0, 1, 2]) {
    const dir = join(tmp, `stream_${i}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'playlist.m3u8'), '#EXTM3U\n')
    writeFileSync(join(dir, 'segment_000.ts'), Buffer.alloc(1024))
    writeFileSync(join(dir, 'segment_001.ts'), Buffer.alloc(1024))
  }
  return tmp
}

describe('contentTypeForFile', () => {
  it('maps .m3u8 to application/vnd.apple.mpegurl', () => {
    expect(contentTypeForFile('master.m3u8')).toBe('application/vnd.apple.mpegurl')
    expect(contentTypeForFile('stream_0/playlist.m3u8')).toBe('application/vnd.apple.mpegurl')
  })
  it('maps .ts to video/mp2t', () => {
    expect(contentTypeForFile('segment_000.ts')).toBe('video/mp2t')
    expect(contentTypeForFile('stream_2/segment_042.ts')).toBe('video/mp2t')
  })
  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(contentTypeForFile('readme')).toBe('application/octet-stream')
    expect(contentTypeForFile('thumb.weird')).toBe('application/octet-stream')
  })
  it('is case-insensitive on the extension', () => {
    expect(contentTypeForFile('PLAYLIST.M3U8')).toBe('application/vnd.apple.mpegurl')
  })
})

describe('buildObjectUrl', () => {
  it('uses path-style addressing against the account endpoint', () => {
    expect(buildObjectUrl(CONFIG, 'videos/abc/master.m3u8')).toBe(
      'https://acct123.r2.cloudflarestorage.com/terraviz-assets/videos/abc/master.m3u8',
    )
  })
  it('preserves slashes between path segments but URI-encodes within segments', () => {
    expect(buildObjectUrl(CONFIG, 'videos/some folder/x.ts')).toBe(
      'https://acct123.r2.cloudflarestorage.com/terraviz-assets/videos/some%20folder/x.ts',
    )
  })
})

describe('loadR2ConfigFromEnv / validateR2Config', () => {
  it('reads each variable from process.env', () => {
    const config = loadR2ConfigFromEnv({
      R2_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com/',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      CATALOG_R2_BUCKET: 'custom-bucket',
    })
    expect(config.endpoint).toBe('https://x.r2.cloudflarestorage.com') // trailing slash trimmed
    expect(config.accessKeyId).toBe('k')
    expect(config.secretAccessKey).toBe('s')
    expect(config.bucket).toBe('custom-bucket')
  })
  it('defaults the bucket to terraviz-assets when CATALOG_R2_BUCKET is unset', () => {
    expect(loadR2ConfigFromEnv({ R2_S3_ENDPOINT: 'x', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }).bucket).toBe(
      'terraviz-assets',
    )
  })
  it('validateR2Config throws when any credential is missing', () => {
    expect(() => validateR2Config({ ...CONFIG, accessKeyId: '' })).toThrow(/R2_ACCESS_KEY_ID/)
    expect(() => validateR2Config({ ...CONFIG, secretAccessKey: '' })).toThrow(/R2_SECRET_ACCESS_KEY/)
    expect(() => validateR2Config({ ...CONFIG, endpoint: '' })).toThrow(/R2_S3_ENDPOINT/)
  })
})

describe('walkBundleFiles', () => {
  it('returns relative paths + sizes for every file in the bundle', () => {
    const dir = makeBundle()
    try {
      const files = walkBundleFiles(dir)
      const relatives = files.map(f => f.relative.replace(/\\/g, '/')).sort()
      expect(relatives).toEqual([
        'master.m3u8',
        'stream_0/playlist.m3u8',
        'stream_0/segment_000.ts',
        'stream_0/segment_001.ts',
        'stream_1/playlist.m3u8',
        'stream_1/segment_000.ts',
        'stream_1/segment_001.ts',
        'stream_2/playlist.m3u8',
        'stream_2/segment_000.ts',
        'stream_2/segment_001.ts',
      ])
      for (const f of files) {
        expect(f.size).toBeGreaterThanOrEqual(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('uploadHlsBundle', () => {
  it('PUTs every file with the correct Content-Type + SigV4 Authorization header', async () => {
    const dir = makeBundle()
    const puts: Array<{ url: string; headers: Headers }> = []
    const fetchImpl = vi.fn(async (req: Request) => {
      puts.push({ url: req.url, headers: req.headers })
      return new Response(null, { status: 200 })
    })
    try {
      const result = await uploadHlsBundle(CONFIG, dir, 'videos/test-asset', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        concurrency: 4,
      })
      // 10 files total per makeBundle.
      expect(puts).toHaveLength(10)
      expect(result.masterKey).toBe('videos/test-asset/master.m3u8')
      expect(result.keys).toHaveLength(10)
      // Every PUT goes to <endpoint>/<bucket>/<prefix>/<file>.
      for (const p of puts) {
        expect(p.url.startsWith(`${CONFIG.endpoint}/${CONFIG.bucket}/videos/test-asset/`)).toBe(true)
        const auth = p.headers.get('Authorization') ?? ''
        // aws4fetch attaches an AWS4-HMAC-SHA256 signature on
        // signed requests.
        expect(auth).toMatch(/^AWS4-HMAC-SHA256 /)
      }
      // Content-Type is per-file.
      const masterPut = puts.find(p => p.url.endsWith('/master.m3u8'))
      expect(masterPut?.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl')
      const segmentPut = puts.find(p => p.url.endsWith('segment_000.ts') && p.url.includes('stream_0'))
      expect(segmentPut?.headers.get('Content-Type')).toBe('video/mp2t')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('respects the concurrency limit', async () => {
    const dir = makeBundle()
    let inFlight = 0
    let maxObserved = 0
    const fetchImpl = vi.fn(async () => {
      inFlight++
      maxObserved = Math.max(maxObserved, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return new Response(null, { status: 200 })
    })
    try {
      await uploadHlsBundle(CONFIG, dir, 'videos/x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        concurrency: 3,
      })
      expect(maxObserved).toBeLessThanOrEqual(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits onProgress callbacks with running totals', async () => {
    const dir = makeBundle()
    const progress: Array<{ done: number; total: number; key: string }> = []
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    try {
      await uploadHlsBundle(CONFIG, dir, 'videos/x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onProgress: info => progress.push({ done: info.done, total: info.total, key: info.key }),
      })
      expect(progress).toHaveLength(10)
      // Last callback reports the final running total.
      expect(progress[progress.length - 1].done).toBe(10)
      expect(progress[0].total).toBe(10)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws R2UploadError with the failing key on non-2xx', async () => {
    const dir = makeBundle()
    const fetchImpl = vi.fn(async (req: Request) => {
      if (req.url.includes('master.m3u8')) {
        return new Response('AccessDenied', { status: 403 })
      }
      return new Response(null, { status: 200 })
    })
    try {
      const err = await uploadHlsBundle(CONFIG, dir, 'videos/x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).catch(e => e)
      expect(err).toBeInstanceOf(R2UploadError)
      expect(err.status).toBe(403)
      expect(err.key).toContain('master.m3u8')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses when master.m3u8 is missing from the bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r2up-'))
    writeFileSync(join(dir, 'stream_0_playlist.m3u8'), '#EXTM3U\n') // no master
    const fetchImpl = vi.fn()
    try {
      await expect(
        uploadHlsBundle(CONFIG, dir, 'videos/x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).rejects.toThrow(/master\.m3u8 not found/)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses when the bundle directory is empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r2up-'))
    const fetchImpl = vi.fn()
    try {
      await expect(
        uploadHlsBundle(CONFIG, dir, 'videos/x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).rejects.toThrow(/is empty/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws at config-validation when credentials are missing', async () => {
    const dir = makeBundle()
    const fetchImpl = vi.fn()
    try {
      await expect(
        uploadHlsBundle(
          { ...CONFIG, accessKeyId: '' },
          dir,
          'videos/x',
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).rejects.toMatchObject({ name: 'R2UploadError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseListKeys', () => {
  it('extracts keys from an S3-style ListObjectsV2 XML body', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>terraviz-assets</Name>
  <Contents><Key>videos/a/master.m3u8</Key><Size>23</Size></Contents>
  <Contents><Key>videos/a/stream_0/segment_000.ts</Key><Size>1024</Size></Contents>
  <Contents><Key>videos/a/stream_0/segment_001.ts</Key><Size>1024</Size></Contents>
</ListBucketResult>`
    expect(parseListKeys(xml)).toEqual([
      'videos/a/master.m3u8',
      'videos/a/stream_0/segment_000.ts',
      'videos/a/stream_0/segment_001.ts',
    ])
  })
  it('decodes the standard XML entities in key names', () => {
    const xml = `<Contents><Key>videos/a&amp;b/master.m3u8</Key></Contents>`
    expect(parseListKeys(xml)).toEqual(['videos/a&b/master.m3u8'])
  })
  it('returns [] for an empty bucket', () => {
    expect(parseListKeys('<ListBucketResult></ListBucketResult>')).toEqual([])
  })
})

describe('deleteR2Prefix', () => {
  it('LISTs the prefix then DELETEs each object', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const fetchImpl = vi.fn(async (req: Request) => {
      calls.push({ method: req.method, url: req.url })
      if (req.method === 'GET') {
        return new Response(
          `<ListBucketResult>
            <Contents><Key>videos/x/master.m3u8</Key></Contents>
            <Contents><Key>videos/x/stream_0/segment_000.ts</Key></Contents>
          </ListBucketResult>`,
          { status: 200 },
        )
      }
      return new Response(null, { status: 204 })
    })
    const out = await deleteR2Prefix(CONFIG, 'videos/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.deleted).toBe(2)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url).toMatch(/list-type=2/)
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(2)
  })

  it('treats DELETE 404 as success (idempotent re-run)', async () => {
    const fetchImpl = vi.fn(async (req: Request) => {
      if (req.method === 'GET') {
        return new Response(`<ListBucketResult><Contents><Key>videos/x/master.m3u8</Key></Contents></ListBucketResult>`, {
          status: 200,
        })
      }
      return new Response(null, { status: 404 })
    })
    const out = await deleteR2Prefix(CONFIG, 'videos/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.deleted).toBe(1)
  })

  it('returns 0 when the prefix is empty', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<ListBucketResult></ListBucketResult>', { status: 200 }),
    )
    const out = await deleteR2Prefix(CONFIG, 'videos/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.deleted).toBe(0)
  })

  it('throws R2UploadError on a failed DELETE', async () => {
    const fetchImpl = vi.fn(async (req: Request) => {
      if (req.method === 'GET') {
        return new Response(`<ListBucketResult><Contents><Key>videos/x/master.m3u8</Key></Contents></ListBucketResult>`, {
          status: 200,
        })
      }
      return new Response('access denied', { status: 403 })
    })
    await expect(
      deleteR2Prefix(CONFIG, 'videos/x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ name: 'R2UploadError', status: 403 })
  })
})
