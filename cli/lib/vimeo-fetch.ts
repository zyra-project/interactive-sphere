/**
 * Resolve a `vimeo:<id>` reference to a streamable MP4 download.
 *
 * Phase 2 commit A. Used by `terraviz migrate-videos` (commit C) to
 * pump bytes from the legacy Vimeo proxy into Cloudflare Stream
 * (commit B). The migration walks every legacy `vimeo:` data_ref;
 * this helper is the *resolve* half — turn a Vimeo id into:
 *
 *   1. A `VimeoMetadata` object with `durationSeconds` so commit
 *      D's cost guard rail can sum minutes before any upload runs.
 *   2. An `openStream()` function that GETs the highest-quality
 *      MP4 and returns `{ stream, contentLength }` ready to feed
 *      directly into the TUS upload helper. No buffering — the
 *      caller pipes bytes through.
 *
 * The metadata fetch and the bytes fetch are deliberately split so
 * that:
 *   - `--dry-run` can compute the cost summary without ever
 *     hitting the upstream MP4.
 *   - A cost-guard-rail abort happens *before* a byte transfer
 *     starts, not partway through.
 *   - Per-row failure attribution stays sharp: a metadata fetch
 *     error is `vimeo_fetch_failed` at the metadata stage; a body
 *     fetch error is `vimeo_fetch_failed` at the bytes stage.
 *     Same `outcome` enum, same telemetry event, but the operator
 *     log line distinguishes them.
 *
 * Quality selection: the proxy returns `files: [{ quality, width,
 * height, size, type, link }]`. We pick the largest `size` whose
 * `type` is `video/mp4` (ties broken by `width`). Vimeo's "source"
 * upload is usually present and is what Stream wants — re-encoding
 * a re-encoded 720p mezzanine wastes quality. If no MP4 file is
 * advertised the helper throws `VimeoFetchError`.
 *
 * No Vimeo API token path. The brief mentioned it as a future
 * option ("or directly via Vimeo's API if a token is configured"),
 * but the proxy is ours, accepts unauthenticated requests, and
 * already canonicalises the file list — adding a parallel direct-
 * Vimeo path is build-time configuration the operator doesn't
 * benefit from. If the proxy's quality selection ever drifts we
 * change the proxy, not the CLI.
 *
 * No file I/O, no global state — pure helper around `fetch`. Tests
 * stub `fetchImpl` to assert on URL shape, header propagation, and
 * error envelopes.
 */

export const DEFAULT_VIDEO_PROXY_BASE = 'https://video-proxy.zyra-project.org/video'

/** Shape the upstream proxy returns for `${base}/${vimeoId}`. */
interface VideoProxyManifest {
  id: string
  title?: string
  duration?: number
  hls?: string
  files?: VideoProxyFile[]
}

interface VideoProxyFile {
  quality?: string
  width?: number
  height?: number
  size?: number
  type?: string
  link?: string
}

/**
 * Lightweight metadata about a Vimeo source. Returned ahead of the
 * byte stream so the cost guard rail can sum durations without
 * fetching a single MP4 byte.
 */
export interface VimeoMetadata {
  /** Vimeo numeric id (`123456789`) — the value half of `vimeo:<id>`. */
  vimeoId: string
  /**
   * Title from the proxy's manifest. Empty string if absent — Stream
   * sets its own title from the upload-creation request anyway, but
   * we surface this for log lines and the migration plan summary.
   */
  title: string
  /**
   * Duration in seconds, or `null` if the proxy didn't report one.
   * Cost guard rail (commit D) treats `null` as "unknown" and falls
   * back to its oembed probe path.
   */
  durationSeconds: number | null
  /**
   * Resolved download URL for the highest-quality MP4. Surfaced in
   * the metadata so `--dry-run` can print which variant would be
   * uploaded.
   */
  mp4Link: string
  /**
   * Advertised file size in bytes from the proxy manifest, or
   * `null` if absent. The actual byte stream uses
   * `Content-Length` from the HEAD/GET response — this is just for
   * pre-flight log lines.
   */
  advertisedBytes: number | null
}

/**
 * The resolved Vimeo handle. `metadata` is filled by the manifest
 * fetch; `openStream()` does the second hop to fetch the MP4 body
 * itself, returning a `ReadableStream<Uint8Array>` plus its
 * server-reported `Content-Length`.
 */
export interface VimeoHandle {
  metadata: VimeoMetadata
  openStream(): Promise<VimeoByteStream>
}

export interface VimeoByteStream {
  /** Streaming body — pipe straight into the TUS upload helper. */
  stream: ReadableStream<Uint8Array>
  /**
   * `Content-Length` reported by the proxy / Vimeo CDN. TUS
   * uploads MUST know the total length up-front; if the upstream
   * declines to advertise one we throw before returning a stream
   * the operator can't actually upload.
   */
  contentLength: number
  /** Server-reported MIME — should be `video/mp4` for our path. */
  contentType: string
}

export class VimeoFetchError extends Error {
  readonly vimeoId: string
  readonly stage: 'metadata' | 'bytes' | 'selection'
  readonly status: number | null

  constructor(
    vimeoId: string,
    stage: 'metadata' | 'bytes' | 'selection',
    status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'VimeoFetchError'
    this.vimeoId = vimeoId
    this.stage = stage
    this.status = status
  }
}

export interface VimeoFetchOptions {
  /** Base URL for the proxy. Defaults to the production zone. */
  proxyBase?: string
  /** Test injection point — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Resolve a Vimeo id to a `VimeoHandle`. Performs the metadata
 * fetch eagerly so an unreachable proxy fails fast — but does NOT
 * fetch the MP4 body until the caller invokes `openStream()`.
 */
export async function resolveVimeo(
  vimeoId: string,
  options: VimeoFetchOptions = {},
): Promise<VimeoHandle> {
  if (!/^\d+$/.test(vimeoId)) {
    throw new VimeoFetchError(
      vimeoId,
      'metadata',
      null,
      `vimeo id "${vimeoId}" is not numeric — refusing to construct an upstream URL.`,
    )
  }

  const proxyBase = (options.proxyBase ?? DEFAULT_VIDEO_PROXY_BASE).replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const manifestUrl = `${proxyBase}/${vimeoId}`

  let res: Response
  try {
    res = await fetchImpl(manifestUrl, { headers: { Accept: 'application/json' } })
  } catch (e) {
    throw new VimeoFetchError(
      vimeoId,
      'metadata',
      null,
      `proxy ${manifestUrl} unreachable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!res.ok) {
    throw new VimeoFetchError(
      vimeoId,
      'metadata',
      res.status,
      `proxy ${manifestUrl} returned HTTP ${res.status}.`,
    )
  }
  let manifest: VideoProxyManifest
  try {
    manifest = (await res.json()) as VideoProxyManifest
  } catch (e) {
    throw new VimeoFetchError(
      vimeoId,
      'metadata',
      res.status,
      `proxy ${manifestUrl} returned a non-JSON body: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const file = pickHighestQualityMp4(manifest.files ?? [])
  if (!file || !file.link) {
    throw new VimeoFetchError(
      vimeoId,
      'selection',
      null,
      `proxy manifest for vimeo:${vimeoId} contains no usable video/mp4 file.`,
    )
  }

  const metadata: VimeoMetadata = {
    vimeoId,
    title: manifest.title ?? '',
    durationSeconds:
      typeof manifest.duration === 'number' && Number.isFinite(manifest.duration) && manifest.duration >= 0
        ? manifest.duration
        : null,
    mp4Link: file.link,
    advertisedBytes:
      typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0 ? file.size : null,
  }

  return {
    metadata,
    async openStream(): Promise<VimeoByteStream> {
      let body: Response
      try {
        body = await fetchImpl(file.link!, { method: 'GET' })
      } catch (e) {
        throw new VimeoFetchError(
          vimeoId,
          'bytes',
          null,
          `MP4 fetch unreachable: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      if (!body.ok || !body.body) {
        throw new VimeoFetchError(
          vimeoId,
          'bytes',
          body.status,
          `MP4 fetch returned HTTP ${body.status}${body.body ? '' : ' with no body'}.`,
        )
      }
      const lengthHeader = body.headers.get('Content-Length')
      const contentLength = lengthHeader != null ? Number(lengthHeader) : NaN
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        throw new VimeoFetchError(
          vimeoId,
          'bytes',
          body.status,
          `MP4 fetch did not advertise a Content-Length; TUS upload requires a known total size.`,
        )
      }
      return {
        stream: body.body,
        contentLength,
        contentType: body.headers.get('Content-Type') ?? 'video/mp4',
      }
    },
  }
}

/**
 * Pick the highest-quality MP4 from the proxy's files array. We
 * prefer largest `size` (bytes) since that's the most reliable
 * signal of source quality across Vimeo's variant ladder; ties on
 * size break to largest `width`. Files without a `type` of
 * `video/mp4`, or without a `link`, are skipped — Stream wants an
 * MP4 body, not an HLS playlist.
 *
 * Returns `null` if no candidate qualifies.
 */
export function pickHighestQualityMp4(files: VideoProxyFile[]): VideoProxyFile | null {
  let best: VideoProxyFile | null = null
  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    if (!file.link) continue
    const type = (file.type ?? '').toLowerCase()
    if (type !== 'video/mp4') continue
    if (best === null) {
      best = file
      continue
    }
    const bestSize = best.size ?? 0
    const fileSize = file.size ?? 0
    if (fileSize > bestSize) {
      best = file
      continue
    }
    if (fileSize === bestSize && (file.width ?? 0) > (best.width ?? 0)) {
      best = file
    }
  }
  return best
}
