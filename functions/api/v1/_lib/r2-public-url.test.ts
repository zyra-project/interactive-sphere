/**
 * Tests for the R2 public-URL resolver.
 *
 * Coverage:
 *   - `R2_PUBLIC_BASE` wins when set; trailing slash is stripped.
 *   - `MOCK_R2=true` falls through to the local stub host
 *     (bucket-prefixed path so the test suite can assert URLs).
 *   - `R2_S3_ENDPOINT` is the last-resort fallback; trailing slash
 *     stripped.
 *   - All three return null when none are configured.
 *   - Key segments encode special characters; `/` separators are
 *     preserved.
 *   - `resolveAssetRef` strips `r2:` and dispatches to
 *     `resolveR2PublicUrl`; bare URLs pass through; null/undefined
 *     return null.
 */

import { describe, expect, it } from 'vitest'
import {
  encodeR2Key,
  resolveAssetRef,
  resolveR2HlsPublicUrl,
  resolveR2PublicUrl,
} from './r2-public-url'
import type { CatalogEnv } from './env'

describe('resolveR2PublicUrl', () => {
  const KEY = 'datasets/DS001/by-digest/sha256/aaa/asset.png'

  it('uses R2_PUBLIC_BASE when set', () => {
    const env: CatalogEnv = {
      R2_PUBLIC_BASE: 'https://assets.example.com',
      CATALOG_R2_BUCKET: 'terraviz-assets',
    }
    expect(resolveR2PublicUrl(env, KEY)).toBe(`https://assets.example.com/${KEY}`)
  })

  it('strips a trailing slash from R2_PUBLIC_BASE', () => {
    const env: CatalogEnv = { R2_PUBLIC_BASE: 'https://assets.example.com/' }
    expect(resolveR2PublicUrl(env, KEY)).toBe(`https://assets.example.com/${KEY}`)
  })

  it('falls through to MOCK_R2 host when R2_PUBLIC_BASE is unset', () => {
    const env: CatalogEnv = { MOCK_R2: 'true', CATALOG_R2_BUCKET: 'tv' }
    expect(resolveR2PublicUrl(env, KEY)).toBe(`https://mock-r2.localhost/tv/${KEY}`)
  })

  it('defaults bucket to `terraviz-assets` when CATALOG_R2_BUCKET is unset', () => {
    const env: CatalogEnv = { MOCK_R2: 'true' }
    expect(resolveR2PublicUrl(env, KEY)).toBe(`https://mock-r2.localhost/terraviz-assets/${KEY}`)
  })

  it('falls through to R2_S3_ENDPOINT when neither public base nor MOCK_R2 is set', () => {
    const env: CatalogEnv = {
      R2_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
      CATALOG_R2_BUCKET: 'terraviz-assets',
    }
    expect(resolveR2PublicUrl(env, KEY)).toBe(
      `https://acct.r2.cloudflarestorage.com/terraviz-assets/${KEY}`,
    )
  })

  it('returns null when nothing is configured', () => {
    expect(resolveR2PublicUrl({}, KEY)).toBeNull()
  })

  it('encodes special chars in path segments but preserves slashes', () => {
    const env: CatalogEnv = { MOCK_R2: 'true', CATALOG_R2_BUCKET: 'tv' }
    // `encodeURIComponent` leaves `()` alone (unreserved per RFC 3986),
    // which is fine for an R2 read URL — the bucket accepts them
    // verbatim. The important behaviour is encoding spaces and
    // preserving slashes as path separators.
    const url = resolveR2PublicUrl(env, 'datasets/has space/file (1).png')!
    expect(url).toContain('/has%20space/')
    expect(url).toContain('/file%20(1).png')
    expect(url.split('/').length).toBeGreaterThan(3)
  })
})

describe('resolveAssetRef', () => {
  const env: CatalogEnv = { MOCK_R2: 'true', CATALOG_R2_BUCKET: 'tv' }

  it('strips r2: scheme and dispatches to resolveR2PublicUrl', () => {
    expect(resolveAssetRef(env, 'r2:datasets/DS001/sphere-thumbnail.jpg')).toBe(
      'https://mock-r2.localhost/tv/datasets/DS001/sphere-thumbnail.jpg',
    )
  })

  it('passes bare URLs through', () => {
    expect(resolveAssetRef(env, 'https://example.com/img.png')).toBe(
      'https://example.com/img.png',
    )
  })

  it('returns null for null / undefined / empty', () => {
    expect(resolveAssetRef(env, null)).toBeNull()
    expect(resolveAssetRef(env, undefined)).toBeNull()
    expect(resolveAssetRef(env, '')).toBeNull()
  })
})

describe('resolveR2HlsPublicUrl', () => {
  // The HLS branch of the manifest endpoint uses this stricter
  // resolver instead of `resolveR2PublicUrl` so that a typical
  // production setup (R2_S3_ENDPOINT set for signing PUTs, but
  // bucket NOT publicly readable through that endpoint) surfaces
  // as `r2_unconfigured` rather than handing the client a URL
  // that 403s at HLS play time.
  const KEY = 'videos/DS001/master.m3u8'

  it('uses R2_PUBLIC_BASE when set', () => {
    const env: CatalogEnv = {
      R2_PUBLIC_BASE: 'https://video.example.com',
      CATALOG_R2_BUCKET: 'terraviz-assets',
    }
    expect(resolveR2HlsPublicUrl(env, KEY)).toBe(`https://video.example.com/${KEY}`)
  })

  it('falls through to MOCK_R2 host when R2_PUBLIC_BASE is unset', () => {
    const env: CatalogEnv = { MOCK_R2: 'true', CATALOG_R2_BUCKET: 'tv' }
    expect(resolveR2HlsPublicUrl(env, KEY)).toBe(`https://mock-r2.localhost/tv/${KEY}`)
  })

  it('returns null when only R2_S3_ENDPOINT is configured', () => {
    // The whole point of the stricter resolver: the S3-endpoint
    // fallback that `resolveR2PublicUrl` performs is intentionally
    // skipped here because that URL pattern doesn't produce a
    // publicly-readable origin for HLS in a typical production
    // deployment.
    const env: CatalogEnv = {
      R2_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      CATALOG_R2_BUCKET: 'terraviz-assets',
    }
    expect(resolveR2HlsPublicUrl(env, KEY)).toBeNull()
  })

  it('returns null when nothing is configured', () => {
    expect(resolveR2HlsPublicUrl({}, KEY)).toBeNull()
  })

  it('strips trailing slash from R2_PUBLIC_BASE', () => {
    const env: CatalogEnv = { R2_PUBLIC_BASE: 'https://video.example.com/' }
    expect(resolveR2HlsPublicUrl(env, KEY)).toBe(`https://video.example.com/${KEY}`)
  })
})

describe('encodeR2Key', () => {
  it('encodes special chars but preserves slashes', () => {
    expect(encodeR2Key('a/b c/d?e')).toBe('a/b%20c/d%3Fe')
  })
})
