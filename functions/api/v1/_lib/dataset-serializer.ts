/**
 * Maps `DatasetRow` + `DecorationRows` to the wire `Dataset` shape
 * that frontend consumers expect.
 *
 * Wire shape is the existing `src/types/index.ts` `Dataset` plus
 * the additive set documented in CATALOG_BACKEND_PLAN.md "API
 * surface" — `originNode`, `originNodeUrl`, `originDisplayName`,
 * `visibility`, `schemaVersion`. The federation `signature` field
 * is *not* set here; it lives on the federation feed serializer
 * (Phase 4).
 *
 * `dataLink` resolves to the manifest endpoint, not the underlying
 * vimeo / url / stream / r2 reference. Commit C lands the manifest
 * resolver; until then the `dataLink` URL 404s but the catalog
 * response itself is still well-formed. Commit H swaps the
 * frontend's `dataService.ts` to read from this endpoint and
 * follow the manifest link.
 */

import type { DatasetRow, DecorationRows, NodeIdentityRow } from './catalog-store'

/**
 * The wire `Dataset` shape — additive superset of the existing
 * frontend `Dataset` interface in `src/types/index.ts`. Phase 1a
 * keeps optional fields optional so older clients that don't know
 * about them ignore them silently.
 */
export interface WireDataset {
  id: string
  slug: string
  title: string
  format: string
  dataLink: string
  organization?: string
  abstractTxt?: string
  thumbnailLink?: string
  legendLink?: string
  closedCaptionLink?: string
  /** Color-ramp image used by interactive probing — populated
   * verbatim from the catalog's `color_table_ref`. Distinct from
   * `legendLink` in ~2 of 14 overlap cases. Optional; omitted when
   * the row carries no value. */
  colorTableLink?: string
  websiteLink?: string
  startTime?: string
  endTime?: string
  period?: string
  weight?: number
  isHidden?: boolean
  runTourOnLoad?: string
  tags?: string[]
  enriched?: {
    description?: string
    categories?: Record<string, string[]>
    keywords?: string[]
    relatedDatasets?: Array<{ title: string; url: string }>
    datasetDeveloper?: { name: string; affiliationUrl?: string }
    visDeveloper?: { name: string; affiliationUrl?: string }
  }
  // Phase-1a additive fields (always present).
  originNode: string
  originNodeUrl: string
  originDisplayName: string
  visibility: 'public' | 'federated' | 'restricted' | 'private'
  schemaVersion: number
  // License & attribution (additive — only set when populated).
  licenseSpdx?: string
  licenseUrl?: string
  licenseStatement?: string
  attributionText?: string
  rightsHolder?: string
  doi?: string
  citationText?: string
  // Lifecycle timestamps (additive — let federation subscribers see
  // when a row last changed).
  createdAt: string
  updatedAt: string
  publishedAt?: string
  /**
   * Bulk-import provenance — set by `terraviz import-snapshot` to
   * the SOS snapshot's internal id (e.g. `INTERNAL_SOS_768`). The
   * frontend's tour engine matches references to legacy IDs against
   * post-cutover ULID-keyed rows by falling back to this field
   * when a primary `id` lookup misses. NULL on rows the publisher
   * created by hand. Phase 1d/T.
   */
  legacyId?: string
  /** Probing metadata recovered from the SOS snapshot — pixel
   * coords on the color table image mapped to data values. Wire
   * type is the parsed JSON object (not the raw string D1 stores).
   * Phase 3b. */
  probingInfo?: unknown
  /** Per-variable data ranges (SOS `boundingVariables`). Wire type
   * is the parsed JSON; D1 stores as a string. Phase 3b. */
  boundingVariables?: unknown
  /**
   * For `tour/json` rows: the resolved URL the SPA's tour engine
   * fetches the tour document from, bypassing the manifest endpoint
   * indirection (which only handles `video|image` manifests).
   * Surfaced from the row's `data_ref` so the post-1d node-catalog
   * source matches the pre-cutover legacy SOS path: a tour dataset
   * carries a fetchable JSON URL, the engine fetches and runs it.
   * Older clients that don't read this field fall back to
   * `dataLink` and 415 — the new shape is additive and opt-in.
   */
  tourJsonUrl?: string
}

/**
 * Pluggable callback that turns a row's `data_ref` (e.g.
 * `url:https://...`, `r2:tours/foo.json`) into a publicly-readable
 * URL. Lives outside the serializer so the serializer doesn't have
 * to import the env or the R2 helper directly; call sites pass a
 * resolver that closes over the bindings they have on hand. Returns
 * null when the scheme isn't a directly-fetchable file (e.g.
 * `vimeo:`, `stream:`, `peer:`) — those formats don't go through
 * the tour-engine fetch path anyway.
 */
export type DataRefResolver = (dataRef: string) => string | null

/**
 * Resolves an `r2:<key>` auxiliary-asset reference (the post-3b
 * shape on `thumbnail_ref` / `legend_ref` / `caption_ref` /
 * `color_table_ref` columns) to a publicly-readable URL. Bare
 * `https://` values pass through unchanged so pre-migration
 * rows on NOAA CloudFront still serialize correctly.
 *
 * The callback shape lets the serializer stay env-agnostic — the
 * route handler binds it once via `resolveAssetRef` from
 * `r2-public-url.ts`. When omitted, the serializer falls back
 * to verbatim passthrough (useful in tests that don't care
 * about R2 resolution); production routes must always pass one
 * or the SPA receives unrenderable `r2:` strings.
 */
export type AssetRefResolver = (ref: string | null | undefined) => string | null

function nonNull<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v
}

/** Apply an optional asset-ref resolver, falling back to
 * verbatim passthrough when none is provided. */
function resolveAsset(
  ref: string | null | undefined,
  resolver: AssetRefResolver | undefined,
): string | undefined {
  if (!ref) return undefined
  if (!resolver) return ref
  return nonNull(resolver(ref))
}

/**
 * Parse a JSON-stringified text column into its object form for
 * the wire. Empty / null / unparseable values become `undefined`
 * so the field is omitted from the serialized row. The columns
 * this is used for (Phase 3b's `probing_info` and
 * `bounding_variables`) are validated on write, so a parse
 * failure here only happens if the row was edited out-of-band.
 */
function parseJsonField(v: string | null | undefined): unknown {
  if (v == null || v.length === 0) return undefined
  try {
    return JSON.parse(v) as unknown
  } catch {
    return undefined
  }
}

/**
 * Build the absolute manifest URL for a dataset. Same-origin so
 * the desktop Tauri app and the web bundle both follow it without
 * config; the proxy handles the cross-origin case.
 */
function manifestLink(baseUrl: string, datasetId: string): string {
  // Use a path-only string so subscribers and same-origin callers
  // can resolve relative; federation peers (Phase 4) resolve
  // against the origin node's base_url separately.
  return `/api/v1/datasets/${datasetId}/manifest`
}

/**
 * Group categories by facet. Frontend expects `categories` keyed
 * by facet name (e.g. "Theme") with arrays of values.
 */
function groupCategories(
  rows: Array<{ facet: string; value: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of rows) {
    const arr = out[r.facet] ?? []
    arr.push(r.value)
    out[r.facet] = arr
  }
  return out
}

export function serializeDataset(
  row: DatasetRow,
  decoration: DecorationRows,
  identity: NodeIdentityRow,
  resolveDataRef?: DataRefResolver,
  resolveAssetRef?: AssetRefResolver,
): WireDataset {
  // Auxiliary asset URLs may be either:
  //   - bare https:// (pre-Phase-3b: NOAA CloudFront), or
  //   - `r2:<key>` (post-Phase-3b migration: R2-hosted under
  //     datasets/<id>/<asset>.<ext> — and post-Phase-3c, also
  //     `r2:tours/<id>/tour.json` for migrated tour files).
  // The SPA renders these as <img src=...> / <track src=...>
  // and fetches `runTourOnLoad` as JSON; neither can resolve a
  // `r2:` scheme. The resolver flips r2: to a publicly-readable
  // URL via R2_PUBLIC_BASE. Bare URLs pass through unchanged.
  // See r2-public-url.ts:resolveAssetRef.
  const wire: WireDataset = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    format: row.format,
    dataLink: manifestLink(identity.base_url, row.id),
    organization: nonNull(row.organization),
    abstractTxt: nonNull(row.abstract),
    thumbnailLink: resolveAsset(row.thumbnail_ref, resolveAssetRef),
    legendLink: resolveAsset(row.legend_ref, resolveAssetRef),
    closedCaptionLink: resolveAsset(row.caption_ref, resolveAssetRef),
    colorTableLink: resolveAsset(row.color_table_ref, resolveAssetRef),
    websiteLink: nonNull(row.website_link),
    startTime: nonNull(row.start_time),
    endTime: nonNull(row.end_time),
    period: nonNull(row.period),
    weight: row.weight,
    isHidden: row.is_hidden === 1 ? true : undefined,
    runTourOnLoad: resolveAsset(row.run_tour_on_load, resolveAssetRef),
    tags: decoration.tags.length ? decoration.tags : undefined,

    originNode: row.origin_node,
    originNodeUrl: identity.base_url,
    originDisplayName: identity.display_name,
    visibility: row.visibility as WireDataset['visibility'],
    schemaVersion: row.schema_version,

    licenseSpdx: nonNull(row.license_spdx),
    licenseUrl: nonNull(row.license_url),
    licenseStatement: nonNull(row.license_statement),
    attributionText: nonNull(row.attribution_text),
    rightsHolder: nonNull(row.rights_holder),
    doi: nonNull(row.doi),
    citationText: nonNull(row.citation_text),

    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: nonNull(row.published_at),
    legacyId: nonNull(row.legacy_id),
    // D1 stores these as JSON-stringified text. Parsing here keeps
    // the wire-side shape friendly for consumers; a malformed
    // string is dropped silently (returned as undefined) rather
    // than 500-ing the read endpoint. Phase 3b's write-side
    // validator (validateJsonStringField) only checks JSON
    // parseability + the 4096-char cap — NOT the object's
    // field-level shape. The 'returned as undefined' fallback
    // handles the case where an out-of-band DB edit lands
    // unparseable text on the column.
    probingInfo: parseJsonField(row.probing_info),
    boundingVariables: parseJsonField(row.bounding_variables),
  }

  // Tour rows carry a fetchable JSON URL alongside the manifest
  // URL, since the manifest endpoint refuses tour formats. The
  // resolver is optional — a caller that doesn't pass one (e.g.
  // a unit test) just gets a wire row without `tourJsonUrl`,
  // which falls back to `dataLink` (and 415s) the same way old
  // clients do.
  if (row.format === 'tour/json' && resolveDataRef) {
    const tourUrl = resolveDataRef(row.data_ref)
    if (tourUrl) wire.tourJsonUrl = tourUrl
  }

  // Enriched fields go under `enriched` to mirror the existing
  // frontend shape so `dataService.ts` doesn't need restructuring.
  const enriched: WireDataset['enriched'] = {}
  if (row.abstract) enriched.description = row.abstract
  if (decoration.categories.length) enriched.categories = groupCategories(decoration.categories)
  if (decoration.keywords.length) enriched.keywords = decoration.keywords
  if (decoration.related.length) {
    enriched.relatedDatasets = decoration.related.map(r => ({
      title: r.related_title,
      url: r.related_url,
    }))
  }
  for (const dev of decoration.developers) {
    const target = dev.role === 'data' ? 'datasetDeveloper' : 'visDeveloper'
    enriched[target] = {
      name: dev.name,
      affiliationUrl: dev.affiliation_url ?? undefined,
    }
  }
  if (Object.keys(enriched).length) wire.enriched = enriched

  return wire
}

/**
 * Latest `updated_at` across a row set. Used as the cursor stamp
 * so subscribers can pass it back as `?since=...` next time. Empty
 * input returns `null` to signal "no rows seen yet"; callers omit
 * the cursor in that case.
 */
export function maxUpdatedAt(rows: DatasetRow[]): string | null {
  let max: string | null = null
  for (const r of rows) {
    if (max === null || r.updated_at > max) max = r.updated_at
  }
  return max
}
