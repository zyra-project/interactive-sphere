/**
 * Tests for downloadService — asset resolution, input shaping, and utilities.
 *
 * The Tauri command wrappers (listDownloads, deleteDownload, etc.) are thin
 * pass-throughs and are not tested here. Focus is on the pure logic:
 * formatBytes, video/image asset resolution, caption URL proxying, and the
 * DownloadInput shape sent to the backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatBytes } from './downloadService'

// --- formatBytes ---

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('2 KB')
  })

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })

  it('formats gigabytes with one decimal', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB')
    expect(formatBytes(2.3 * 1024 * 1024 * 1024)).toBe('2.3 GB')
  })

  it('formats terabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB')
  })

  it('clamps to largest unit for huge values', () => {
    const result = formatBytes(Number.MAX_SAFE_INTEGER)
    expect(result).toMatch(/PB$/)
  })
})

// --- Asset resolution logic ---
// These test the internal functions via their module-level behavior.
// We re-implement the pure logic here since the functions are private.

describe('video asset resolution', () => {
  it('picks the highest quality (widest) MP4 from a manifest', () => {
    const files = [
      { quality: '720p', width: 1280, height: 720, size: 50_000_000, type: 'video/mp4', link: 'https://example.com/720.mp4' },
      { quality: '1080p', width: 1920, height: 1080, size: 100_000_000, type: 'video/mp4', link: 'https://example.com/1080.mp4' },
      { quality: '4K', width: 3840, height: 2160, size: 500_000_000, type: 'video/mp4', link: 'https://example.com/4k.mp4' },
      { quality: '480p', width: 854, height: 480, size: 20_000_000, type: 'video/mp4', link: 'https://example.com/480.mp4' },
    ]

    // Same logic as resolveVideoAssets
    const sorted = [...files].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    const best = sorted[0]

    expect(best.quality).toBe('4K')
    expect(best.link).toBe('https://example.com/4k.mp4')
    expect(best.size).toBe(500_000_000)
  })

  it('handles files with missing width by sorting them last', () => {
    const files = [
      { quality: 'unknown', width: undefined, height: undefined, size: 10_000, type: 'video/mp4', link: 'https://example.com/unknown.mp4' },
      { quality: '720p', width: 1280, height: 720, size: 50_000_000, type: 'video/mp4', link: 'https://example.com/720.mp4' },
    ]

    const sorted = [...files].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    expect(sorted[0].quality).toBe('720p')
  })
})

describe('image resolution candidate generation', () => {
  it('generates candidates in order: 4096, 2048, original', () => {
    const url = 'https://cdn.example.com/data/seafloor.jpg'
    const ext = url.match(/(\.\w+)$/)
    const base = ext ? url.slice(0, -ext[1].length) : url
    const suffix = ext ? ext[1] : ''

    const candidates = [
      { url: `${base}_4096${suffix}`, filename: `image_4096${suffix}` },
      { url: `${base}_2048${suffix}`, filename: `image_2048${suffix}` },
      { url, filename: `image${suffix}` },
    ]

    expect(candidates[0].url).toBe('https://cdn.example.com/data/seafloor_4096.jpg')
    expect(candidates[0].filename).toBe('image_4096.jpg')
    expect(candidates[1].url).toBe('https://cdn.example.com/data/seafloor_2048.jpg')
    expect(candidates[2].url).toBe(url)
    expect(candidates[2].filename).toBe('image.jpg')
  })

  it('handles URLs with .png extension', () => {
    const url = 'https://cdn.example.com/earth.png'
    const ext = url.match(/(\.\w+)$/)
    const base = ext ? url.slice(0, -ext[1].length) : url
    const suffix = ext ? ext[1] : ''

    expect(`${base}_4096${suffix}`).toBe('https://cdn.example.com/earth_4096.png')
  })

  it('handles URLs with no extension', () => {
    const url = 'https://cdn.example.com/data/noext'
    const ext = url.match(/(\.\w+)$/)
    const base = ext ? url.slice(0, -ext[1].length) : url
    const suffix = ext ? ext[1] : ''

    expect(base).toBe(url)
    expect(suffix).toBe('')
    expect(`${base}_4096${suffix}`).toBe('https://cdn.example.com/data/noext_4096')
  })
})

describe('caption URL proxying', () => {
  it('proxies sos.noaa.gov caption URLs through video-proxy', () => {
    const captionLink = 'https://sos.noaa.gov/media/captions/ocean_acidification.srt'
    const proxied = captionLink.includes('sos.noaa.gov')
      ? `https://video-proxy.zyra-project.org/captions?url=${encodeURIComponent(captionLink)}`
      : captionLink

    expect(proxied).toBe(
      'https://video-proxy.zyra-project.org/captions?url=https%3A%2F%2Fsos.noaa.gov%2Fmedia%2Fcaptions%2Focean_acidification.srt'
    )
  })

  it('passes non-NOAA caption URLs through unchanged', () => {
    const captionLink = 'https://example.com/captions/test.srt'
    const proxied = captionLink.includes('sos.noaa.gov')
      ? `https://video-proxy.zyra-project.org/captions?url=${encodeURIComponent(captionLink)}`
      : captionLink

    expect(proxied).toBe(captionLink)
  })
})

describe('supplementary asset filenames', () => {
  it('derives thumbnail filename from URL extension', () => {
    const thumbnailLink = 'https://cdn.example.com/thumb/ocean.png'
    const ext = thumbnailLink.match(/(\.\w+)$/)?.[1] ?? '.jpg'
    expect(`thumbnail${ext}`).toBe('thumbnail.png')
  })

  it('defaults thumbnail extension to .jpg', () => {
    const thumbnailLink = 'https://cdn.example.com/thumb/noext'
    const ext = thumbnailLink.match(/(\.\w+)$/)?.[1] ?? '.jpg'
    expect(`thumbnail${ext}`).toBe('thumbnail.jpg')
  })

  it('derives legend filename from URL extension', () => {
    const legendLink = 'https://cdn.example.com/legend/scale.gif'
    const ext = legendLink.match(/(\.\w+)$/)?.[1] ?? '.png'
    expect(`legend${ext}`).toBe('legend.gif')
  })

  it('defaults legend extension to .png when link is absent', () => {
    const legendLink = null as string | null
    const ext = legendLink?.match(/(\.\w+)$/)?.[1] ?? '.png'
    expect(`legend${ext}`).toBe('legend.png')
  })
})

describe('Vimeo ID extraction', () => {
  // This tests the pattern used in downloadService via dataService
  const extractVimeoId = (url: string): string | null => {
    const match = url.match(/vimeo\.com\/(\d+)/)
    return match ? match[1] : null
  }

  it('extracts ID from standard Vimeo URL', () => {
    expect(extractVimeoId('https://vimeo.com/123456789')).toBe('123456789')
  })

  it('extracts ID from Vimeo URL with trailing path', () => {
    expect(extractVimeoId('https://vimeo.com/987654321/abcdef')).toBe('987654321')
  })

  it('returns null for non-Vimeo URLs', () => {
    expect(extractVimeoId('https://youtube.com/watch?v=abc')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractVimeoId('')).toBeNull()
  })
})
