/**
 * Wire types for portal-bound publisher API responses.
 *
 * Mirrors a subset of the server-side `DatasetRow` and related
 * shapes the portal actually reads — kept here rather than imported
 * from `functions/api/v1/_lib/catalog-store.ts` so the portal
 * doesn't pull server-side types (and their transitive
 * dependencies) into the lazy chunk. The subset is intentionally
 * narrow; we expand it as later sub-phases consume more fields.
 *
 * Fields are documented to match the server-side definitions. A
 * structural drift between portal and server is caught at runtime
 * (the portal renders missing fields as empty / undefined gracefully)
 * rather than at build time, which matches how the rest of the
 * SPA's wire types work.
 */

/** Lifecycle status derived from published_at / retracted_at. */
export type DatasetLifecycle = 'draft' | 'published' | 'retracted'

/**
 * Subset of `DatasetRow` the portal list / detail surfaces
 * consume. The server returns the full row; we cast through this
 * interface to make portal call sites declare which fields they
 * read.
 */
export interface PublisherDataset {
  id: string
  slug: string
  title: string
  abstract: string | null
  organization: string | null
  format: string
  visibility: string
  created_at: string
  updated_at: string
  published_at: string | null
  retracted_at: string | null
  publisher_id: string | null
  legacy_id: string | null
}

export interface ListDatasetsResponse {
  datasets: PublisherDataset[]
  next_cursor: string | null
}

/**
 * Compute the lifecycle status from the timestamp pair the server
 * returns. The server applies the same logic when interpreting
 * `?status=` filters; this client-side derivation lets the portal
 * tag a row with its current lifecycle without an extra API call.
 */
export function lifecycleOf(d: PublisherDataset): DatasetLifecycle {
  if (d.retracted_at) return 'retracted'
  if (d.published_at) return 'published'
  return 'draft'
}
