/**
 * POST /api/v1/publish/datasets/{id}/reindex
 *
 * Re-enqueues the embed job for an already-published dataset
 * without re-running the row's content through the publish
 * lifecycle. Phase 1d/D ships this so an operator who wires up
 * Vectorize after publishing some rows can backfill the vector
 * index, and so a future model-version bump can be rolled out as
 * a one-off cron that walks every row and POSTs reindex.
 *
 * Error envelope: mirrors publish/retract — pre-checks visibility
 * in the route so 404s use `jsonError({error, message})`,
 * `embed_unconfigured` (503, missing binding) does the same since
 * it's a structural / configuration error, and only the structured
 * `not_published` 409 conflict comes back as `{errors: [...]}`.
 * Pre-1d/O the route returned `{errors}` for every non-OK path,
 * which made the CLI surface `error: "http_error"` instead of the
 * more useful `not_found` / `embed_unconfigured` codes.
 */

import type { CatalogEnv } from '../../../_lib/env'
import type { PublisherData } from '../../_middleware'
import {
  getDatasetForPublisher,
  reindexDataset,
} from '../../../_lib/dataset-mutations'
import { type JobQueue, WaitUntilJobQueue } from '../../../_lib/job-queue'

interface ReindexContextData extends PublisherData {
  jobQueue?: JobQueue
}

const CONTENT_TYPE = 'application/json; charset=utf-8'

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': CONTENT_TYPE },
  })
}

export const onRequestPost: PagesFunction<CatalogEnv, 'id'> = async context => {
  const publisher = (context.data as unknown as PublisherData).publisher
  const idParam = context.params.id
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  if (!id) return jsonError(400, 'invalid_request', 'Missing dataset id.')

  // Pre-check visibility in the route (mirrors publish.ts) so the
  // 404 lands as `{error: 'not_found'}` rather than the structured
  // `{errors}` envelope we use for validation / conflict failures.
  const existing = await getDatasetForPublisher(context.env.CATALOG_DB!, publisher, id)
  if (!existing) return jsonError(404, 'not_found', `Dataset ${id} not found.`)

  const jobQueue =
    (context.data as unknown as ReindexContextData).jobQueue ??
    new WaitUntilJobQueue(context.env, context.waitUntil.bind(context))
  const result = await reindexDataset(context.env, publisher, id, { jobQueue })
  if (!result.ok) {
    // 503 embed_unconfigured is a configuration error, not a
    // validation failure — surface it in the same shape publish.ts
    // / retract.ts use for missing-binding cases.
    if (result.status === 503) {
      const e = result.errors[0]
      return jsonError(503, e.code, e.message)
    }
    // Anything else (currently only 409 not_published) is a
    // structured conflict; keep the {errors} shape so the CLI's
    // per-error printing surfaces field/code/message tuples.
    return new Response(JSON.stringify({ errors: result.errors }), {
      status: result.status,
      headers: { 'Content-Type': CONTENT_TYPE },
    })
  }
  return new Response(JSON.stringify({ dataset: result.dataset }), {
    status: 200,
    headers: { 'Content-Type': CONTENT_TYPE, 'Cache-Control': 'private, no-store' },
  })
}
