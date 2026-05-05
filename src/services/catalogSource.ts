/**
 * Build-time switch that controls where `dataService.ts` and
 * `datasetLoader.ts` source their catalog data from.
 *
 *   - `node` (default, post-1d cutover): pull the rendered catalog
 *     from this deployment's own `/api/v1/catalog`, follow each
 *     dataset's `dataLink` (`/api/v1/datasets/{id}/manifest`) for
 *     video / image resolution. The wire shape is the same as the
 *     existing `Dataset` plus a few additive fields, so call sites
 *     that already work against `Dataset` need no further changes.
 *   - `legacy`: existing behaviour — pull SOS catalog JSON from
 *     `s3.dualstack.us-east-1.amazonaws.com`, merge with
 *     `/assets/sos_dataset_metadata.json`, point video playback at
 *     `https://video-proxy.zyra-project.org/video/{vimeoId}`. Kept
 *     behind the explicit flag for the cutover stabilisation
 *     window — operators can roll back to legacy with a single
 *     env-var change while the rest of the cutover commits are
 *     reverted in their own follow-on PR.
 *
 * Pre-1d/G the default was `legacy`. The flip to `node` is
 * reversed by `git revert` of this commit alongside the other two
 * cutover commits (1d/E, 1d/F) — no schema or data changes.
 */

export type CatalogSource = 'legacy' | 'node'

export function getCatalogSource(): CatalogSource {
  const raw = (import.meta.env.VITE_CATALOG_SOURCE as string | undefined) ?? 'node'
  return raw === 'legacy' ? 'legacy' : 'node'
}

/**
 * True when a `dataLink` URL is shaped like one of this node's
 * manifest endpoints. Used by the dataset loader to decide whether
 * to fetch the manifest envelope or treat the link as a direct
 * asset URL (the sample tours' `/assets/test-tour.json` paths, or
 * any legacy URL the SOS source still hands us).
 */
export function isManifestUrl(dataLink: string): boolean {
  return /^\/api\/v\d+\/datasets\/[^/]+\/manifest$/.test(dataLink)
}

/**
 * Public origin of the production Pages deployment. Used as the
 * fallback host for `/api/v1/...` requests in Tauri builds, where
 * the webview origin is `tauri://localhost/` (or
 * `http://tauri.localhost/` on Windows) and there is no Pages
 * Functions backend to serve relative API paths — they would
 * otherwise return the bundled `index.html` and fail JSON parse
 * with `Unexpected token '<'`.
 *
 * Override at build time via `VITE_API_ORIGIN` to point a fork's
 * desktop builds at a different deployment.
 */
const DEFAULT_API_ORIGIN = 'https://terraviz.zyra-project.org'

const IS_TAURI =
  typeof window !== 'undefined' && !!(window as { __TAURI__?: unknown }).__TAURI__

function getApiOrigin(): string {
  const override = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim()
  if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, '')
  return DEFAULT_API_ORIGIN
}

/**
 * Lazy-loaded reference to the Tauri HTTP plugin's `fetch`. The
 * webview's native fetch enforces CORS for cross-origin HTTPS
 * targets and the catalog API endpoints don't set
 * `Access-Control-Allow-Origin`, so requests from `tauri://localhost`
 * to the production deployment would otherwise be blocked. The
 * plugin issues the request from Rust (reqwest), bypassing webview
 * CORS — same lazy-import pattern used by `llmProvider.ts` and
 * `downloadService.ts`.
 */
const tauriFetchReady: Promise<typeof globalThis.fetch | null> = IS_TAURI
  ? import('@tauri-apps/plugin-http')
      .then(m => m.fetch as typeof globalThis.fetch)
      .catch(() => null)
  : Promise.resolve(null)

/**
 * Resolve a relative API path to an absolute URL the active
 * runtime can fetch. Web builds keep the relative path so the
 * request hits the same Pages deployment serving the SPA. Tauri
 * builds rewrite `/api/v1/...` (and webview-origin URLs already
 * coerced through `new URL(..., window.location.origin)`) to the
 * production API origin. Already-absolute non-webview URLs pass
 * through unchanged.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (!IS_TAURI) return pathOrUrl
  let path = pathOrUrl
  if (typeof window !== 'undefined') {
    const origin = window.location.origin
    if (origin && path.startsWith(origin)) {
      path = path.slice(origin.length) || '/'
    }
  }
  if (!path.startsWith('/')) return path
  return `${getApiOrigin()}${path}`
}

/**
 * `fetch` wrapper for `/api/v1/...` calls. Pass-through to the
 * native `fetch` in web builds. In Tauri it rewrites relative
 * paths to the production API origin and routes through the
 * Tauri HTTP plugin to bypass webview CORS — which would
 * otherwise reject every cross-origin request because the catalog
 * Pages Functions don't set `Access-Control-Allow-Origin`.
 */
export async function apiFetch(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const url = resolveApiUrl(pathOrUrl)
  if (IS_TAURI) {
    const tauriFetch = await tauriFetchReady
    if (tauriFetch) return tauriFetch(url, init)
  }
  return fetch(url, init)
}
