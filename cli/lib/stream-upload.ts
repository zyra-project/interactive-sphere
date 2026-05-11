/**
 * Upload a video body to Cloudflare Stream via TUS-resumable.
 *
 * Phase 2 commit B. Mirrors the publisher API's
 * `mintDirectUploadUrl` (`functions/api/v1/_lib/stream-store.ts`)
 * on the *operator-side* — instead of minting a one-shot URL for a
 * future browser/CLI to POST to, this helper drives the upload
 * directly from a streaming `ReadableStream<Uint8Array>` source
 * (the byte half of `cli/lib/vimeo-fetch.ts`'s `openStream()`)
 * straight into Cloudflare Stream.
 *
 * Two reasons it lives in `cli/lib/` rather than reusing the
 * publisher-API path:
 *
 *   1. The `mintDirectUploadUrl` path is for external producers
 *      uploading bytes they own, with the publisher API stamping
 *      a row + computing a digest. The migration is a one-shot
 *      operator pump *between* upstream services — no publisher-API
 *      row to stamp; the row already exists and just needs its
 *      `data_ref` patched. Threading the migration through the
 *      `/asset` endpoints would force the operator to claim a
 *      digest of bytes they never actually buffered.
 *
 *   2. Real-time / ongoing ingestion (separate phase, server-side,
 *      see CATALOG_BACKEND_DEVELOPMENT.md) will eventually want a
 *      Pages Function that does the same vimeo→stream pump at the
 *      edge. By keeping the upload helper as a plain library
 *      function (no CLI-arg parsing tangled in), that future
 *      server-side endpoint imports `uploadToStream()` and reuses
 *      the same TUS plumbing.
 *
 * TUS protocol:
 *   - POST /accounts/{id}/stream?direct_user=true with
 *     `Tus-Resumable: 1.0.0` + `Upload-Length: <bytes>`. Cloudflare
 *     responds 201 with `Location: <upload_url>` and the asset's
 *     UID in the `stream-media-id` header.
 *   - PATCH <upload_url> with `Upload-Offset: 0` and
 *     `Content-Type: application/offset+octet-stream`. Body is the
 *     streaming source, sent in a single PATCH (Cloudflare's TUS
 *     endpoint accepts arbitrary-size single PATCH bodies — we
 *     don't need to chunk for resumability because our migration
 *     pace is sequential and the operator can re-run failed rows).
 *
 * The Node 18+ fetch implementation supports streaming request
 * bodies via `duplex: 'half'`. The `RequestInit` type emitted by
 * `lib.dom.d.ts` predates that field, so we extend it locally and
 * cast at the call site.
 *
 * Returns the `streamUid` (the `<uid>` half of `stream:<uid>`) plus
 * the byte count Cloudflare confirmed via the response's
 * `Upload-Offset` header. The caller (commit C's migrate-videos
 * subcommand) PATCHes `data_ref` to `stream:<streamUid>` only after
 * a successful upload.
 */

const CLOUDFLARE_STREAM_API_BASE = 'https://api.cloudflare.com/client/v4'
const TUS_VERSION = '1.0.0'

/** Stream credentials. Same names the publisher API's
 * `requireStreamConfig` reads from `env`. */
export interface StreamUploadConfig {
  accountId: string
  apiToken: string
}

export interface StreamUploadOptions {
  /** Test injection point. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /**
   * Optional asset metadata. Cloudflare TUS encodes these as base64
   * key-value pairs in the `Upload-Metadata` header. `name` becomes
   * the Stream asset's display name; `filename` is recorded for
   * audit but not surfaced.
   */
  meta?: { name?: string; filename?: string }
  /**
   * Override the API base. Default points at
   * `https://api.cloudflare.com/client/v4`. Tests use a stub URL
   * so the assertion can pin both the create POST and the PATCH.
   */
  apiBase?: string
}

export interface StreamUploadResult {
  /** Stream-assigned UID — the value half of `stream:<uid>`. */
  streamUid: string
  /** Bytes Cloudflare confirmed received via `Upload-Offset`. */
  bytesUploaded: number
  /** Location URL the PATCH was sent to (kept for log lines). */
  uploadUrl: string
}

export class StreamUploadError extends Error {
  readonly stage: 'config' | 'create' | 'upload'
  readonly status: number | null

  constructor(stage: 'config' | 'create' | 'upload', status: number | null, message: string) {
    super(message)
    this.name = 'StreamUploadError'
    this.stage = stage
    this.status = status
  }
}

/**
 * `RequestInit` extended with the `duplex` field Node's fetch
 * requires when the body is a streaming source. The DOM lib
 * doesn't declare it; declaring it here keeps the cast scoped
 * rather than spreading `as any` through the call sites.
 */
type RequestInitWithDuplex = RequestInit & { duplex?: 'half' }

function base64(value: string): string {
  // Browser-compat base64 — `btoa` exists in Node 16+ globals and
  // matches what Cloudflare's TUS implementation expects.
  return btoa(unescape(encodeURIComponent(value)))
}

function buildUploadMetadata(meta: { name?: string; filename?: string } | undefined): string | null {
  if (!meta) return null
  const parts: string[] = []
  if (meta.name) parts.push(`name ${base64(meta.name)}`)
  if (meta.filename) parts.push(`filename ${base64(meta.filename)}`)
  return parts.length ? parts.join(',') : null
}

/**
 * Upload a video body to Cloudflare Stream. Returns the stream
 * UID + the confirmed byte count on success; throws
 * `StreamUploadError` with a stage discriminator on failure.
 *
 * Body shape:
 *   - `Uint8Array` — the typical CLI path post-2/O. The migration
 *     drains the source stream into a buffer first and passes it
 *     here. Undici knows the exact length and can replay on the
 *     307/308 redirects Cloudflare Stream issues to route uploads
 *     to regional origins.
 *   - `ReadableStream<Uint8Array>` — kept for any future caller
 *     that wants the streaming path (e.g., a Cloudflare Worker
 *     server-side ingestion endpoint, whose fetch impl handles
 *     streaming + redirects without the body-replay limitation
 *     Node's undici has).
 *
 * The body is consumed exactly once. Callers must not reuse the
 * `ReadableStream`; if the upload fails partway through, re-running
 * the migration row will resolve the source from `vimeo:` again
 * (idempotency comes from the publisher-API `data_ref` patch step
 * — until that succeeds, the row is still on `vimeo:` and the
 * orphan Stream UID is logged as `migration_video.outcome =
 * data_ref_patch_failed`).
 */
export async function uploadToStream(
  config: StreamUploadConfig,
  body: Uint8Array | ReadableStream<Uint8Array>,
  contentLength: number,
  options: StreamUploadOptions = {},
): Promise<StreamUploadResult> {
  if (!config.accountId || !config.apiToken) {
    throw new StreamUploadError(
      'config',
      null,
      'STREAM_ACCOUNT_ID and STREAM_API_TOKEN must both be set to upload to Cloudflare Stream.',
    )
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new StreamUploadError(
      'config',
      null,
      `contentLength must be a positive integer (got ${String(contentLength)}).`,
    )
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = (options.apiBase ?? CLOUDFLARE_STREAM_API_BASE).replace(/\/$/, '')
  const createUrl = `${apiBase}/accounts/${encodeURIComponent(config.accountId)}/stream?direct_user=true`

  // --- Stage 1: TUS create -----------------------------------------
  const createHeaders: Record<string, string> = {
    Authorization: `Bearer ${config.apiToken}`,
    'Tus-Resumable': TUS_VERSION,
    'Upload-Length': String(contentLength),
  }
  const uploadMetadata = buildUploadMetadata(options.meta)
  if (uploadMetadata) createHeaders['Upload-Metadata'] = uploadMetadata

  let createRes: Response
  try {
    createRes = await fetchImpl(createUrl, { method: 'POST', headers: createHeaders })
  } catch (e) {
    throw new StreamUploadError(
      'create',
      null,
      `TUS create unreachable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (createRes.status !== 201) {
    const text = await createRes.text().catch(() => '')
    throw new StreamUploadError(
      'create',
      createRes.status,
      `TUS create failed (${createRes.status}): ${text.slice(0, 200) || '(no body)'}`,
    )
  }
  const uploadUrl = createRes.headers.get('Location')
  const streamUid = createRes.headers.get('stream-media-id')
  if (!uploadUrl || !streamUid) {
    throw new StreamUploadError(
      'create',
      createRes.status,
      'TUS create response is missing Location and/or stream-media-id headers.',
    )
  }

  // --- Stage 2: TUS PATCH (single shot) ---------------------------
  // Body shape:
  //   - Uint8Array → undici treats it as a Buffer, knows the exact
  //     length, can replay on redirect.
  //   - ReadableStream → undici streams it with `duplex: 'half'`.
  //     This is the simpler-on-paper path but a 2024-05-11 live run
  //     hit "Response body object should not be disturbed or locked"
  //     — undici can't replay a stream on the 307/308 redirects
  //     Cloudflare Stream sometimes issues to route uploads to
  //     regional origins. The CLI path now buffers (matching the
  //     Phase 1b runUpload precedent), but the streaming branch
  //     stays here for any future caller (e.g., a server-side
  //     Cloudflare Worker, whose fetch impl handles redirects with
  //     streamed bodies more gracefully than Node's undici).
  const patchHeaders: Record<string, string> = {
    'Tus-Resumable': TUS_VERSION,
    'Upload-Offset': '0',
    'Content-Type': 'application/offset+octet-stream',
    'Content-Length': String(contentLength),
  }
  const isBuffered = body instanceof Uint8Array
  const patchInit: RequestInitWithDuplex = {
    method: 'PATCH',
    headers: patchHeaders,
    body: isBuffered ? (body as BodyInit) : (body as unknown as BodyInit),
  }
  // duplex: 'half' is only required (and only valid) when body is a
  // streaming source. Setting it for a buffered Uint8Array would
  // confuse some Node fetch builds; omit it on the buffered branch.
  if (!isBuffered) patchInit.duplex = 'half'

  let patchRes: Response
  try {
    patchRes = await fetchImpl(uploadUrl, patchInit as RequestInit)
  } catch (e) {
    throw new StreamUploadError(
      'upload',
      null,
      `TUS PATCH unreachable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (patchRes.status !== 204) {
    const text = await patchRes.text().catch(() => '')
    throw new StreamUploadError(
      'upload',
      patchRes.status,
      `TUS PATCH failed (${patchRes.status}): ${text.slice(0, 200) || '(no body)'}`,
    )
  }
  const offsetHeader = patchRes.headers.get('Upload-Offset')
  const bytesUploaded = offsetHeader != null ? Number(offsetHeader) : NaN
  if (!Number.isFinite(bytesUploaded) || bytesUploaded !== contentLength) {
    throw new StreamUploadError(
      'upload',
      patchRes.status,
      `TUS PATCH succeeded but Upload-Offset (${offsetHeader ?? 'absent'}) does not match Upload-Length (${contentLength}).`,
    )
  }

  return { streamUid, bytesUploaded, uploadUrl }
}
