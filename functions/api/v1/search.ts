/**
 * Cloudflare Pages Function — GET /api/v1/search?q=...
 *
 * Public semantic-search endpoint. Embeds the query, queries the
 * Vectorize index, hydrates dataset rows from D1, returns
 * `{ datasets: [{ id, title, abstract_snippet, categories,
 * peer_id, score }] }`.
 *
 * Query parameters:
 *   - `q`         (required, 1–200 chars): the search text.
 *   - `limit`     (optional, 1–50; default 10): number of hits.
 *   - `category`  (optional): exact-match filter, lowercased.
 *   - `peer_id`   (optional): `'local'` (translated to the local
 *                 node id) or a peer node id. Defaults to `'local'`
 *                 when omitted, so federated peers are excluded by
 *                 default — matching the plan's federation-opt-in
 *                 stance (CATALOG_BACKEND_PLAN.md "Per-peer inclusion
 *                 in the docent"). Pass an explicit peer node id to
 *                 search a specific peer's content.
 *
 * Caching:
 *   - The most-common query shapes are cached in KV under a
 *     content-derived key with a short TTL (60s). The cache lives
 *     under `CATALOG_KV` so it shares a binding with the
 *     full-catalog snapshot. Distinct query / filters / limit
 *     combinations get their own keys; the cache shape is
 *     `search:v1:<sha256(canonicalised options)>`.
 *   - No If-None-Match support: search hits are short-lived and
 *     not really meant to ETag-revalidate; clients refetch when
 *     the user types.
 *   - When the embed bindings aren't wired (`degraded:
 *     'unconfigured'`) the response is NOT cached — operators
 *     wiring up Vectorize for the first time get fresh results
 *     immediately rather than serving 60 s of empty payloads from
 *     KV.
 *
 * Errors:
 *   - 400 `invalid_request` for missing / overlong `q` or
 *     out-of-range `limit`.
 *   - 503 `binding_missing` for missing `CATALOG_DB`.
 *   - 5xx for upstream Vectorize / Workers AI failures the helper
 *     bubbles up.
 */

import type { CatalogEnv } from './_lib/env'
import {
  searchDatasets,
  type SearchDatasetsResult,
} from './_lib/search-datasets'

const CONTENT_TYPE = 'application/json; charset=utf-8'
const CACHE_TTL_SECONDS = 60
const SEARCH_CACHE_KEY_PREFIX = 'search:v1:'

const MAX_QUERY_LENGTH = 200
const MAX_LIMIT = 50

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': CONTENT_TYPE },
  })
}

interface ParsedRequest {
  q: string
  limit: number
  category: string | undefined
  /** Always populated — defaults to 'local' when the URL omits the param. */
  peer_id: string
}

function parseRequest(url: URL): ParsedRequest | { error: string; message: string } {
  const q = url.searchParams.get('q')
  if (!q || q.trim().length === 0) {
    return { error: 'invalid_request', message: 'Missing required query parameter `q`.' }
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return {
      error: 'invalid_request',
      message: `Query parameter \`q\` is too long (max ${MAX_QUERY_LENGTH} chars).`,
    }
  }

  const limitRaw = url.searchParams.get('limit')
  let limit = 10
  if (limitRaw != null) {
    const parsed = Number(limitRaw)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return {
        error: 'invalid_request',
        message: `Query parameter \`limit\` must be an integer between 1 and ${MAX_LIMIT}.`,
      }
    }
    limit = parsed
  }

  // Default peer_id to 'local' so federated peers are excluded
  // unless an operator explicitly opts in. The helper translates
  // 'local' to the configured node id before forwarding to
  // Vectorize. An explicit empty string in the URL is also
  // treated as "use the default" — `URLSearchParams.get('')`
  // returns `''` which is falsy here.
  const peerIdRaw = url.searchParams.get('peer_id')
  const peer_id = peerIdRaw && peerIdRaw.length > 0 ? peerIdRaw : 'local'

  return {
    q,
    limit,
    category: url.searchParams.get('category') ?? undefined,
    peer_id,
  }
}

/**
 * Stable cache key for the (query, limit, filters) tuple.
 * Canonicalises whitespace and case for `q` and `category` so trivial
 * variants share a cache slot. `peer_id` keeps its case — node ids
 * are case-sensitive in Vectorize metadata + D1 filtering, so two
 * differently-cased peer ids must NOT collapse into the same cache
 * slot (otherwise `peer_id=PEER_X` would serve `peer_id=peer_x`'s
 * results back).
 */
async function cacheKeyFor(parsed: ParsedRequest): Promise<string> {
  const canonical = JSON.stringify({
    q: parsed.q.normalize('NFC').trim().toLowerCase(),
    l: parsed.limit,
    c: parsed.category?.normalize('NFC').trim().toLowerCase() ?? null,
    p: parsed.peer_id.normalize('NFC').trim(),
  })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return `${SEARCH_CACHE_KEY_PREFIX}${hex.slice(0, 32)}`
}

export const onRequestGet: PagesFunction<CatalogEnv> = async context => {
  if (!context.env.CATALOG_DB) {
    return jsonError(503, 'binding_missing', 'CATALOG_DB binding is not configured on this deployment.')
  }

  const url = new URL(context.request.url)
  const parsedOrError = parseRequest(url)
  if ('error' in parsedOrError) {
    return jsonError(400, parsedOrError.error, parsedOrError.message)
  }
  const parsed = parsedOrError

  const cacheKey = await cacheKeyFor(parsed)

  if (context.env.CATALOG_KV) {
    const cached = await context.env.CATALOG_KV.get(cacheKey)
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPE,
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          'X-Cache': 'HIT',
        },
      })
    }
  }

  const result: SearchDatasetsResult = await searchDatasets(context.env, {
    query: parsed.q,
    limit: parsed.limit,
    filters: {
      category: parsed.category,
      peer_id: parsed.peer_id,
    },
  })

  const body = JSON.stringify(result)
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPE,
    'X-Cache': 'MISS',
  }

  // Don't cache degraded responses — an operator wiring Vectorize
  // for the first time should get fresh results the moment the
  // binding lands, not 60 s of empty payloads from KV.
  if (result.degraded) {
    headers['Cache-Control'] = 'no-store'
    headers.Warning = `199 - "search degraded: ${result.degraded}"`
  } else {
    headers['Cache-Control'] = `public, max-age=${CACHE_TTL_SECONDS}`
    if (context.env.CATALOG_KV) {
      try {
        await context.env.CATALOG_KV.put(cacheKey, body, {
          expirationTtl: CACHE_TTL_SECONDS,
        })
      } catch {
        // Best-effort cache fill; serving the response wins.
      }
    }
  }

  return new Response(body, { status: 200, headers })
}
