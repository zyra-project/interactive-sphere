/**
 * Probe Vimeo for the duration of a video, cached on disk.
 *
 * Phase 2 commit D, extended by 2/L. Used by the cost guard rail
 * in `cli/migrate-videos.ts` to sum the migration plan's total
 * minutes before any byte transfer starts.
 *
 * Two-source chain (added in 2/L after a live --dry-run revealed
 * oembed returns no usable duration for the SOS Vimeo channel —
 * 136 / 136 rows came back unknown):
 *
 *   1. Vimeo `oembed.json` — unauthenticated, tiny payload, the
 *      canonical metadata surface. Cheap to call. Works for public
 *      Vimeo videos; fails closed (404 / nothing) when the source
 *      is on a private channel, has referer restrictions, or is
 *      otherwise gated.
 *   2. Our own video-proxy (the upstream resolver Phase 1a's
 *      manifest endpoint uses). Returns `duration` in its JSON
 *      response alongside the file list. We control it and know
 *      it works for every id in the migration plan — it's
 *      literally serving these videos right now.
 *
 * The chain runs in order: try oembed first (cheap, decoupled
 * from the upload-time hot path), fall back to the proxy only on
 * miss. The single cache file backs both — whichever source
 * resolved a row is the value stashed, and subsequent dry-runs
 * skip both probes.
 *
 * Cache: `<repo-root>/.cache/vimeo-durations.json`. Plain JSON
 * keyed by Vimeo numeric id. The directory is already gitignored
 * (`.cache/` rule in `.gitignore`). Cache is best-effort —
 * read errors fall through silently to a fresh probe; write errors
 * print a soft warning but don't fail the run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_VIDEO_PROXY_BASE } from './vimeo-fetch'

export const DEFAULT_VIMEO_OEMBED_BASE = 'https://vimeo.com/api/oembed.json'
export const DEFAULT_DURATION_CACHE_PATH = '.cache/vimeo-durations.json'

export interface VimeoDurationOptions {
  /** Test injection — defaults to the production oembed endpoint. */
  oembedBase?: string
  /** Test injection — defaults to the production video-proxy base. */
  proxyBase?: string
  /** Test injection — defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface OembedResponse {
  duration?: number
  title?: string
}

/**
 * Probe Vimeo's oembed endpoint for a single video's duration in
 * seconds. Returns `null` (not throws) on any failure mode — the
 * cost guard rail treats `null` as "unknown duration" and surfaces
 * the count of unknowns in its summary so the operator can decide
 * whether to proceed.
 */
export async function probeVimeoDuration(
  vimeoId: string,
  options: VimeoDurationOptions = {},
): Promise<number | null> {
  if (!/^\d+$/.test(vimeoId)) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const base = options.oembedBase ?? DEFAULT_VIMEO_OEMBED_BASE
  const url = `${base}?url=${encodeURIComponent(`https://vimeo.com/${vimeoId}`)}`
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch {
    return null
  }
  if (!res.ok) return null
  let body: OembedResponse
  try {
    body = (await res.json()) as OembedResponse
  } catch {
    return null
  }
  if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration < 0) {
    return null
  }
  return body.duration
}

/** Subset of the video-proxy manifest we care about for cost
 * estimation. The proxy returns more fields (id, title, hls,
 * files); we only read `duration`. */
interface ProxyManifestForDuration {
  duration?: number
}

/**
 * Probe our own video-proxy for a single video's duration, in
 * seconds. Used as the fallback when Vimeo's oembed endpoint
 * declines to resolve (SOS's Vimeo channel is one such surface —
 * a live --dry-run revealed 100% of rows return null from oembed,
 * and the proxy is the only source we control that we know works
 * for every id in the migration plan).
 *
 * Same `null` semantics as `probeVimeoDuration` — failure modes
 * are best-effort, not throws.
 */
export async function probeVimeoDurationViaProxy(
  vimeoId: string,
  options: VimeoDurationOptions = {},
): Promise<number | null> {
  if (!/^\d+$/.test(vimeoId)) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const base = (options.proxyBase ?? DEFAULT_VIDEO_PROXY_BASE).replace(/\/$/, '')
  const url = `${base}/${vimeoId}`
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch {
    return null
  }
  if (!res.ok) return null
  let body: ProxyManifestForDuration
  try {
    body = (await res.json()) as ProxyManifestForDuration
  } catch {
    return null
  }
  if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration < 0) {
    return null
  }
  return body.duration
}

/**
 * Read the cached durations file from disk. Returns an empty
 * object on any read error — the cache is opportunistic.
 */
export function readDurationCache(path: string): Record<string, number> {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      }
      return out
    }
  } catch {
    // Corrupt cache — start fresh.
  }
  return {}
}

/**
 * Write the durations cache. Best-effort — directories are created
 * on demand; failures surface via the optional `onError` hook
 * (defaults to logging to stderr). The migration never fails on
 * cache write — at worst the next dry-run re-probes.
 */
export function writeDurationCache(
  path: string,
  cache: Record<string, number>,
  onError: (msg: string) => void = msg => process.stderr.write(`${msg}\n`),
): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(cache, null, 2) + '\n', 'utf-8')
  } catch (e) {
    onError(`vimeo-duration: could not persist cache to ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface DurationLookupOptions extends VimeoDurationOptions {
  /** Override the on-disk cache path. Defaults to `.cache/vimeo-durations.json`. */
  cachePath?: string
  /** Skip the on-disk cache entirely (used by tests). */
  skipCache?: boolean
}

/**
 * Resolve a list of Vimeo ids to their durations. Two-source chain
 * (added in 2/L after oembed proved unreliable for the SOS Vimeo
 * channel):
 *
 *   1. On-disk cache (`.cache/vimeo-durations.json`).
 *   2. Vimeo oembed.
 *   3. Our own video-proxy.
 *
 * The chain short-circuits on the first hit. Either probe source
 * counts as a successful resolution and the result is stashed in
 * the cache, so subsequent dry-runs skip both probes.
 *
 * Returns a Map keyed by Vimeo id; misses (both sources null) are
 * absent from the map (NOT mapped to `null`) so callers can count
 * missing durations explicitly.
 *
 * The cache file is rewritten exactly once at the end of the walk —
 * not per probe — so a cancelled mid-walk run still preserves the
 * pre-existing cache.
 */
export async function lookupVimeoDurations(
  vimeoIds: string[],
  options: DurationLookupOptions = {},
): Promise<Map<string, number>> {
  const cachePath = options.cachePath ?? DEFAULT_DURATION_CACHE_PATH
  const cache = options.skipCache ? {} : readDurationCache(cachePath)

  const result = new Map<string, number>()
  let cacheChanged = false
  for (const id of vimeoIds) {
    if (id in cache) {
      result.set(id, cache[id])
      continue
    }
    let probed = await probeVimeoDuration(id, options)
    if (probed === null) {
      probed = await probeVimeoDurationViaProxy(id, options)
    }
    if (probed === null) continue
    result.set(id, probed)
    cache[id] = probed
    cacheChanged = true
  }

  if (cacheChanged && !options.skipCache) {
    writeDurationCache(cachePath, cache)
  }
  return result
}
