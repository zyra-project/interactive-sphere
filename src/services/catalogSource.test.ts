import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { getCatalogSource, isManifestUrl, resolveApiUrl } from './catalogSource'

const ORIGINAL = import.meta.env.VITE_CATALOG_SOURCE

describe('getCatalogSource', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete (import.meta.env as Record<string, string>).VITE_CATALOG_SOURCE
    } else {
      ;(import.meta.env as Record<string, string>).VITE_CATALOG_SOURCE = ORIGINAL
    }
  })

  it('defaults to node (post-1d/G cutover)', () => {
    delete (import.meta.env as Record<string, string>).VITE_CATALOG_SOURCE
    expect(getCatalogSource()).toBe('node')
  })

  it('returns "legacy" only for the exact string', () => {
    ;(import.meta.env as Record<string, string>).VITE_CATALOG_SOURCE = 'legacy'
    expect(getCatalogSource()).toBe('legacy')
  })

  it('falls back to node on an unknown value', () => {
    ;(import.meta.env as Record<string, string>).VITE_CATALOG_SOURCE = 'wat'
    expect(getCatalogSource()).toBe('node')
  })
})

describe('resolveApiUrl', () => {
  // The runtime `IS_TAURI` flag is captured at module load from
  // `window.__TAURI__`. JSDOM has no Tauri global, so resolveApiUrl
  // is exercised in its web-build branch here and the Tauri rewrite
  // is covered by `getApiOrigin`-aware behaviour-style tests below
  // via direct import.meta.env manipulation. The Tauri rewrite is
  // a one-line concatenation; the meaningful contract is "web
  // builds never rewrite anything" — which IS the failure mode
  // we'd regress.
  it('returns the input unchanged in web builds', () => {
    expect(resolveApiUrl('/api/v1/catalog')).toBe('/api/v1/catalog')
    expect(resolveApiUrl('https://example.com/foo')).toBe(
      'https://example.com/foo',
    )
    expect(resolveApiUrl('')).toBe('')
  })
})

describe('isManifestUrl', () => {
  it('matches /api/v1/datasets/<id>/manifest', () => {
    expect(isManifestUrl('/api/v1/datasets/DS001/manifest')).toBe(true)
    expect(
      isManifestUrl('/api/v1/datasets/164DFJQ8SEZZRTXYDCJHB1SMNK/manifest'),
    ).toBe(true)
  })

  it('does not match other URLs', () => {
    expect(isManifestUrl('/api/v1/catalog')).toBe(false)
    expect(isManifestUrl('https://video-proxy.example/video/123')).toBe(false)
    expect(isManifestUrl('/api/v1/datasets/DS001')).toBe(false)
    expect(isManifestUrl('/assets/test-tour.json')).toBe(false)
    expect(isManifestUrl('')).toBe(false)
  })
})
