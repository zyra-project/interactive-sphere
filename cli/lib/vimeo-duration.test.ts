/**
 * Tests for `cli/lib/vimeo-duration.ts` (Phase 2 commit D's
 * cost-estimation source).
 *
 * Covers:
 *   - probeVimeoDuration parses the oembed JSON's `duration` field
 *   - non-numeric / non-finite / negative durations → null
 *   - HTTP errors / fetch throws → null (best-effort)
 *   - readDurationCache returns {} on missing / corrupt file
 *   - writeDurationCache creates parent dirs + persists JSON
 *   - lookupVimeoDurations: cache hits skip the probe, misses
 *     write back, partial misses from oembed (null) are absent
 *     from the result Map
 *   - The cache file is written once at the end, not per probe
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_VIMEO_OEMBED_BASE,
  lookupVimeoDurations,
  probeVimeoDuration,
  readDurationCache,
  writeDurationCache,
} from './vimeo-duration'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('probeVimeoDuration', () => {
  it('hits the default oembed endpoint and returns the duration', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${DEFAULT_VIMEO_OEMBED_BASE}?url=${encodeURIComponent('https://vimeo.com/123')}`)
      return jsonResponse({ duration: 270, title: 'x' })
    })
    const seconds = await probeVimeoDuration('123', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(seconds).toBe(270)
  })

  it('honours an oembedBase override', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`https://vimeo.test/oembed?url=${encodeURIComponent('https://vimeo.com/456')}`)
      return jsonResponse({ duration: 5 })
    })
    await probeVimeoDuration('456', {
      oembedBase: 'https://vimeo.test/oembed',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  })

  it('returns null on a non-numeric vimeo id without making a request', async () => {
    const fetchImpl = vi.fn()
    expect(await probeVimeoDuration('abc', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns null on HTTP non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    expect(
      await probeVimeoDuration('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connection reset')
    })
    expect(
      await probeVimeoDuration('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toBeNull()
  })

  it('returns null when duration is missing or non-numeric', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ title: 'x' }))
    expect(
      await probeVimeoDuration('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toBeNull()
  })

  it('returns null when duration is negative', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ duration: -5 }))
    expect(
      await probeVimeoDuration('123', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toBeNull()
  })
})

describe('readDurationCache / writeDurationCache', () => {
  it('returns {} for a missing cache file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    try {
      expect(readDurationCache(join(tmp, 'absent.json'))).toEqual({})
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns {} for a corrupt cache file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'corrupt.json')
    writeFileSync(path, '{not json', 'utf-8')
    try {
      expect(readDurationCache(path)).toEqual({})
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('drops non-numeric values from the cache shape', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'mixed.json')
    writeFileSync(path, JSON.stringify({ '1': 100, '2': 'not-a-number', '3': 50 }), 'utf-8')
    try {
      expect(readDurationCache(path)).toEqual({ '1': 100, '3': 50 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('writes JSON and creates parent directories on demand', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'nested', 'sub', 'cache.json')
    try {
      writeDurationCache(path, { '99': 42 })
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      expect(parsed).toEqual({ '99': 42 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('write errors surface via onError without throwing', () => {
    const errors: string[] = []
    // Path with a NUL byte fails reliably on POSIX file APIs.
    const path = 'tmp\0/cache.json'
    writeDurationCache(path, { '1': 1 }, msg => errors.push(msg))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('could not persist cache')
  })
})

describe('lookupVimeoDurations', () => {
  it('uses cached values without probing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'durations.json')
    writeFileSync(path, JSON.stringify({ '1': 60, '2': 120 }), 'utf-8')
    const fetchImpl = vi.fn()
    try {
      const out = await lookupVimeoDurations(['1', '2'], {
        cachePath: path,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(Object.fromEntries(out)).toEqual({ '1': 60, '2': 120 })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('probes for cache misses and persists the result', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'durations.json')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('111')) return jsonResponse({ duration: 30 })
      if (url.includes('222')) return jsonResponse({ duration: 90 })
      return jsonResponse({})
    })
    try {
      const out = await lookupVimeoDurations(['111', '222'], {
        cachePath: path,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(Object.fromEntries(out)).toEqual({ '111': 30, '222': 90 })
      const persisted = JSON.parse(readFileSync(path, 'utf-8'))
      expect(persisted).toEqual({ '111': 30, '222': 90 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('omits failed probes from the result map but keeps cache hits', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'durations.json')
    writeFileSync(path, JSON.stringify({ '1': 60 }), 'utf-8')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('999')) return new Response('', { status: 404 })
      return jsonResponse({})
    })
    try {
      const out = await lookupVimeoDurations(['1', '999'], {
        cachePath: path,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(out.has('1')).toBe(true)
      expect(out.has('999')).toBe(false)
      // Cache file is unchanged on the persistence side because no
      // new entries were resolved.
      const persisted = JSON.parse(readFileSync(path, 'utf-8'))
      expect(persisted).toEqual({ '1': 60 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('skipCache=true bypasses both reads and writes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'durations.json')
    writeFileSync(path, JSON.stringify({ '1': 60 }), 'utf-8')
    const fetchImpl = vi.fn(async () => jsonResponse({ duration: 5 }))
    try {
      const out = await lookupVimeoDurations(['1'], {
        cachePath: path,
        skipCache: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      // Probed despite the cache hit because skipCache=true.
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(Object.fromEntries(out)).toEqual({ '1': 5 })
      // Cache file is unchanged.
      const persisted = JSON.parse(readFileSync(path, 'utf-8'))
      expect(persisted).toEqual({ '1': 60 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not write the cache file when no new entries are added', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vc-'))
    const path = join(tmp, 'durations.json')
    // Use a marker the test can verify wasn't overwritten.
    writeFileSync(path, '{"1":60,"_marker":42}', 'utf-8')
    const fetchImpl = vi.fn()
    try {
      await lookupVimeoDurations(['1'], {
        cachePath: path,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      const raw = readFileSync(path, 'utf-8')
      // Original byte-for-byte preserved when no probe ran.
      expect(raw).toBe('{"1":60,"_marker":42}')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
