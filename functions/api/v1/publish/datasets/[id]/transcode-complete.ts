/**
 * POST /api/v1/publish/datasets/{id}/transcode-complete
 *
 * Called by the GitHub Actions transcode workflow once it has
 * written the HLS bundle to R2. Flips `data_ref` to the
 * `master.m3u8` path and clears `transcoding`. Restricted to
 * service-token publishers (and admins) because the
 * `transcoding` column is server-managed — community publishers
 * shouldn't be able to fake "transcode complete" through the
 * regular PUT path.
 *
 * Body:
 *   {
 *     "data_ref": "r2:videos/{id}/master.m3u8",
 *     "source_digest": "sha256:..."     // optional; if supplied,
 *                                       // must match the stored
 *                                       // source_digest set at
 *                                       // /asset/{upload_id}/complete
 *                                       // time. Belt-and-suspenders
 *                                       // against the workflow
 *                                       // PATCHing the wrong row.
 *   }
 *
 * Authorization: caller must be `role='service'` or `role='staff'`
 * with `is_admin=1`. The Phase 3pa publisher-store provisions
 * Cloudflare Access service tokens as `role='service'`, so the
 * workflow's `CF_Access_Client_Id` / `CF_Access_Client_Secret`
 * carry exactly the right identity by default.
 *
 * Failure envelopes match the rest of the publisher API:
 *   - 400 invalid_json / invalid_body / invalid_data_ref
 *   - 403 transcode_complete_forbidden — non-service caller
 *   - 404 not_found — dataset doesn't exist
 *   - 409 not_transcoding — the row isn't currently `transcoding=1`
 *   - 409 source_digest_mismatch — supplied digest doesn't match
 */

import type { CatalogEnv } from '../../../_lib/env'
import type { PublisherData } from '../../_middleware'
import type { DatasetRow } from '../../../_lib/catalog-store'
import { writeDatasetAudit } from '../../../_lib/audit-store'
import { clearTranscoding } from '../../../_lib/asset-uploads'
import { invalidateSnapshot } from '../../../_lib/snapshot'

const CONTENT_TYPE = 'application/json; charset=utf-8'

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': CONTENT_TYPE },
  })
}

interface TranscodeCompleteBody {
  data_ref: string
  source_digest?: string
}

function validateBody(raw: unknown): TranscodeCompleteBody | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'Request body must be an object.' }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.data_ref !== 'string' || obj.data_ref.length === 0) {
    return { error: 'data_ref must be a non-empty string.' }
  }
  // Workflow always writes the bundle to `r2:videos/{id}/master.m3u8`.
  // Refusing any other prefix here keeps a misconfigured workflow
  // (or a forged call from an unintended caller) from pointing the
  // row at arbitrary URLs.
  if (!obj.data_ref.startsWith('r2:videos/')) {
    return { error: 'data_ref must start with "r2:videos/" for transcode completions.' }
  }
  if (!obj.data_ref.endsWith('/master.m3u8')) {
    return { error: 'data_ref must end with "/master.m3u8" for transcode completions.' }
  }
  if (obj.source_digest !== undefined && typeof obj.source_digest !== 'string') {
    return { error: 'source_digest must be a string when supplied.' }
  }
  return { data_ref: obj.data_ref, source_digest: obj.source_digest as string | undefined }
}

export const onRequestPost: PagesFunction<CatalogEnv, 'id'> = async context => {
  const publisher = (context.data as unknown as PublisherData).publisher
  const idParam = context.params.id
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  if (!id) return jsonError(400, 'invalid_request', 'Missing dataset id.')

  // Restrict to service tokens + admin staff. Community publishers
  // (and even non-admin staff) shouldn't be flipping `transcoding`
  // through this endpoint — they go through the normal upload +
  // /complete flow, which manages the column server-side.
  const isAllowed =
    publisher.role === 'service' || (publisher.role === 'staff' && publisher.is_admin === 1)
  if (!isAllowed) {
    return jsonError(
      403,
      'transcode_complete_forbidden',
      'This endpoint is restricted to service tokens and admin staff.',
    )
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Request body is not valid JSON.')
  }
  const validated = validateBody(body)
  if ('error' in validated) {
    return jsonError(400, 'invalid_body', validated.error)
  }

  const db = context.env.CATALOG_DB!
  const existing = await db
    .prepare(`SELECT * FROM datasets WHERE id = ?`)
    .bind(id)
    .first<DatasetRow>()
  if (!existing) return jsonError(404, 'not_found', `Dataset ${id} not found.`)

  if (!existing.transcoding) {
    return jsonError(
      409,
      'not_transcoding',
      `Dataset ${id} is not currently transcoding (transcoding column is NULL/0). ` +
        'Did the workflow fire twice or against the wrong id?',
    )
  }

  if (
    validated.source_digest !== undefined &&
    existing.source_digest !== validated.source_digest
  ) {
    return jsonError(
      409,
      'source_digest_mismatch',
      `Supplied source_digest does not match the value stored at upload time. ` +
        'Refusing to apply — the workflow may be PATCHing the wrong dataset.',
    )
  }

  const now = new Date().toISOString()
  await clearTranscoding(db, id, validated.data_ref, now)

  // Refresh the row so the response carries the latest state.
  const updated = await db
    .prepare(`SELECT * FROM datasets WHERE id = ?`)
    .bind(id)
    .first<DatasetRow>()

  // If the dataset is currently published, mutating its data_ref
  // changes what public consumers see — invalidate the snapshot so
  // the next /api/v1/catalog read sees the change. Drafts (the
  // common case for transcode-complete) don't appear in the
  // snapshot, so the invalidate is a no-op for them.
  if (updated?.published_at && !updated.retracted_at) {
    await invalidateSnapshot(context.env)
  }

  await writeDatasetAudit(db, publisher, 'dataset.update', id, {
    fields: ['data_ref', 'transcoding'],
    reason: 'transcode_complete',
  })

  return new Response(
    JSON.stringify({ dataset: updated }),
    {
      status: 200,
      headers: { 'Content-Type': CONTENT_TYPE, 'Cache-Control': 'private, no-store' },
    },
  )
}
