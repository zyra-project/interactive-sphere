/**
 * Poster deep-link handlers.
 *
 * The companion poster at poster.terraviz.zyra-project.org embeds
 * the live app in iframes and ships visitors to specific pre-set
 * states via query parameters: `?layout=4` to drop into a 4-globe
 * layout, `?tour=climate-futures` to start the Climate Futures tour,
 * `?terrain=on` to enable 3D terrain, `?orbit=open` to surface the
 * docent panel, etc.
 *
 * This module reads the query string at app boot and dispatches
 * the corresponding actions through the same APIs that the in-app
 * Tools menu and chat trigger use, so analytics emits, accessibility
 * announcements, and button-state UI all stay in sync. Behaviour is
 * conservative: an unknown param value is a silent no-op rather than
 * an error; the URL is not rewritten or cleared after dispatch so a
 * page refresh preserves the deep-linked state.
 *
 * Layout (`?layout=`) is read separately by main.ts during renderer
 * init — see `parseInitialLayout` below — so the panel grid is
 * already correct by the time `?tour=` and the view toggles fire.
 */

import { logger } from './logger'
import type { Dataset } from '../types'
import type { ViewLayout } from '../services/viewportManager'

/**
 * Slug → dataset-id alias map for `?tour=` deep-links. Lets the
 * poster use friendly slugs like `climate-futures` instead of the
 * catalog's verbose `SAMPLE_TOUR_CLIMATE_FUTURES`. Add a row here
 * when a new tour gets a poster button.
 */
const TOUR_ALIASES: Readonly<Record<string, string>> = {
  'climate-futures': 'SAMPLE_TOUR_CLIMATE_FUTURES',
  'climate-connections': 'SAMPLE_TOUR',
}

/** Suggested chat input when the poster opens the docent with a hint. */
const ORBIT_PROMPT_TEMPLATES: Readonly<Record<string, string>> = {
  tour: 'Can you recommend a tour for me?',
}

/**
 * Bridge from this module to the App. Each method dispatches through
 * the canonical app API; we never poke renderers or DOM directly
 * (except for the Tools-menu buttons, which is the right call site
 * for analytics + a11y + button-state side effects).
 */
export interface PosterDeepLinkContext {
  /** The loaded catalog. Used to resolve `?tour=` slugs to IDs. */
  catalog: readonly Dataset[]
  /**
   * Load a dataset (or tour) by ID. Caller is expected to mark the
   * trigger as "url" — same path the existing `?dataset=` flow uses.
   */
  loadDataset: (id: string) => Promise<void> | void
  /** Open the chat panel, optionally pre-filling the input. */
  openChatWithQuery: (query?: string) => void
}

/**
 * Map the public `?layout=` (and legacy `?setview=`) param to a
 * canonical {@link ViewLayout}, or null if the value is unknown.
 *
 * Public layout values the poster ships: `1` / `2` / `4`. The legacy
 * `?setview=` form additionally accepts `2h` and `2v` as advanced
 * orientations; we honour those too.
 */
export function resolveLayout(raw: string | null): ViewLayout | null {
  if (!raw) return null
  if (raw === '1' || raw === '2h' || raw === '2v' || raw === '4') return raw
  if (raw === '2') return '2h'
  return null
}

/**
 * Read the initial viewport layout from the URL. Prefers the public
 * `?layout=` param; falls back to the legacy dev `?setview=` param.
 * Returns the canonical {@link ViewLayout} or `'1'` (single globe)
 * if neither param is present or recognised.
 */
export function parseInitialLayout(search: string): ViewLayout {
  const params = new URLSearchParams(search)
  const layout = resolveLayout(params.get('layout'))
  if (layout) return layout
  const legacy = resolveLayout(params.get('setview'))
  if (legacy) return legacy
  return '1'
}

/**
 * Resolve a `?tour=` value (slug or direct ID) to a catalog dataset
 * ID, or null if no match. Slug lookup is case-insensitive; direct
 * ID lookup is exact (catalog IDs are uppercase).
 */
export function resolveTourId(
  raw: string | null,
  catalog: readonly Dataset[],
): string | null {
  if (!raw) return null
  const aliased = TOUR_ALIASES[raw.toLowerCase()]
  if (aliased && catalog.some((d) => d.id === aliased)) return aliased
  if (catalog.some((d) => d.id === raw)) return raw
  return null
}

/**
 * Map an `?orbit=open&prompt=...` value to a seed query for the chat
 * input, or undefined if the prompt name is unknown (in which case
 * the chat panel still opens, just without a pre-filled input).
 */
export function resolveOrbitPrompt(raw: string | null): string | undefined {
  if (!raw) return undefined
  return ORBIT_PROMPT_TEMPLATES[raw]
}

/**
 * Apply poster deep-link query parameters to the live app. Called
 * once from main.ts after the catalog has loaded and the Tools menu
 * has wired its buttons.
 *
 * Order:
 *   1. `?tour=` — load the requested tour. Skipped if `?dataset=`
 *      is also set, since the existing initial-load path will have
 *      handled that and a second load would clobber it.
 *   2. View toggles (`?terrain=`, `?labels=`, `?borders=`,
 *      `?rotate=`) — clicked through the Tools-menu buttons so the
 *      analytics emit + a11y announce + button-state UI all stay in
 *      sync.
 *   3. `?orbit=open` — open the chat panel, optionally seeded with
 *      a recommendation prompt.
 */
export function applyPosterDeepLinks(ctx: PosterDeepLinkContext): void {
  const params = new URLSearchParams(window.location.search)

  // 1. Tour. `?dataset=` takes precedence — the existing initial-load
  // path already handled it, so we don't double-load.
  const tour = params.get('tour')
  const datasetParam = params.get('dataset')
  if (tour && !datasetParam) {
    const id = resolveTourId(tour, ctx.catalog)
    if (id) {
      logger.debug('[PosterDeepLinks] loadTour:', id, '(from "%s")', tour)
      void ctx.loadDataset(id)
    } else {
      logger.warn('[PosterDeepLinks] unknown tour:', tour)
    }
  }

  // 2. View toggles — drive through the Tools-menu buttons.
  clickToolsMenuIfOff('terrain', 'tools-menu-terrain', params)
  clickToolsMenuIfOff('labels', 'tools-menu-labels', params)
  clickToolsMenuIfOff('borders', 'tools-menu-borders', params)
  clickToolsMenuIfOff('rotate', 'tools-menu-autorotate', params)

  // 3. Orbit chat panel.
  if (params.get('orbit') === 'open') {
    const seed = resolveOrbitPrompt(params.get('prompt'))
    logger.debug('[PosterDeepLinks] openChat seed:', seed ?? '(none)')
    ctx.openChatWithQuery(seed)
  }
}

/**
 * Click a Tools-menu toggle button if the matching `?<name>=on` query
 * param is set and the toggle is currently off. Routing through the
 * button click means the button's existing handler — which already
 * mirrors state to all renderers, persists prefs, emits analytics,
 * and announces to screen readers — runs unchanged.
 */
function clickToolsMenuIfOff(
  paramName: string,
  buttonId: string,
  params: URLSearchParams,
): void {
  if (params.get(paramName) !== 'on') return
  const btn = document.getElementById(buttonId)
  if (btn instanceof HTMLButtonElement) {
    if (!btn.classList.contains('active')) {
      btn.click()
    }
  } else {
    logger.warn(`[PosterDeepLinks] toggle button missing: ${buttonId}`)
  }
}
