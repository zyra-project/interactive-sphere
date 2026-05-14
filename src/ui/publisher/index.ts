/**
 * Publisher portal entry point.
 *
 * Lazy-loaded from `src/main.ts` when the user navigates to a
 * `/publish/*` path. The portal is a small admin UI on top of the
 * already-shipped publisher API (`/api/v1/publish/**`); see
 * [`docs/CATALOG_PUBLISHING_TOOLS.md`](../../../docs/CATALOG_PUBLISHING_TOOLS.md)
 * for the full design.
 *
 * Phase 3pa scaffolding: the lazy chunk, the History API router,
 * and a single placeholder page wired to every route. Real pages
 * land in 3pa/B (i18n keys), 3pa/C (/publish/me content) and the
 * subsequent sub-phases (3pb–3pg).
 *
 * The portal lives behind Cloudflare Access in production
 * (`DEV_BYPASS_ACCESS=true` for local dev). When this entry runs
 * the user is already authenticated; the portal can call
 * `/api/v1/publish/me` immediately to fetch identity.
 */

import { logger } from '../../utils/logger'
import { t } from '../../i18n'
import { PublisherRouter, type RouteHandler } from './router'
import { renderMePage } from './pages/me'
import '../../styles/publisher.css'

const PORTAL_ROOT_ID = 'publisher-root'

/**
 * Resolve (or create) the portal's mount point. The host page
 * (index.html) doesn't include a `#publisher-root` element by
 * default — the SPA-only DOM stays untouched for the 99.9% of
 * visits that never hit `/publish`. When the portal boots it
 * either reuses an existing host node or appends one to `<body>`
 * and hides every SPA-only top-level element so the two trees
 * don't fight for the viewport.
 */
function ensureMount(): HTMLElement {
  let mount = document.getElementById(PORTAL_ROOT_ID)
  if (!mount) {
    mount = document.createElement('div')
    mount.id = PORTAL_ROOT_ID
    mount.className = 'publisher-portal'
    document.body.appendChild(mount)
  }
  // Hide the SPA's loading splash. It's `position: fixed;
  // z-index: 1000; opacity: 1` and only fades out when the SPA's
  // own boot path adds a `.fade-out` class. Because our route gate
  // skips the SPA boot entirely, the splash would otherwise sit on
  // top of the portal forever.
  const loading = document.getElementById('loading-screen')
  if (loading) loading.style.display = 'none'
  const spa = document.getElementById('app')
  if (spa) spa.style.display = 'none'
  return mount
}

/**
 * Render the placeholder content for any sub-phase that hasn't
 * shipped yet. 3pa wires every route to this — the actual page
 * implementations replace it in 3pa/C onwards.
 *
 * DOM is constructed via createElement + textContent rather than
 * innerHTML so route params (e.g., the `:id` segment) cannot
 * carry HTML into the page. The fixed-shape scaffold doesn't need
 * the convenience of template literals.
 */
function renderPlaceholder(mount: HTMLElement, sectionLabel: string, subPhase: string): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'

  const title = document.createElement('h1')
  title.textContent = t('publisher.portal.title')
  shell.appendChild(title)

  const section = document.createElement('p')
  section.className = 'publisher-section'
  section.textContent = sectionLabel
  shell.appendChild(section)

  const comingSoon = document.createElement('p')
  comingSoon.className = 'publisher-coming-soon'
  comingSoon.textContent = t('publisher.placeholder.comingSoon', { subPhase })
  shell.appendChild(comingSoon)

  mount.replaceChildren(shell)
}

function mePage(mount: HTMLElement): RouteHandler {
  return () => renderMePage(mount)
}

function datasetsPage(mount: HTMLElement): RouteHandler {
  return () => renderPlaceholder(mount, t('publisher.section.datasets'), '3pb')
}

function datasetDetailPage(mount: HTMLElement): RouteHandler {
  return params => {
    const id = params.id ?? ''
    renderPlaceholder(mount, t('publisher.section.datasetDetail', { id }), '3pb')
  }
}

function toursPage(mount: HTMLElement): RouteHandler {
  return () => renderPlaceholder(mount, t('publisher.section.tours'), '3pe')
}

function importPage(mount: HTMLElement): RouteHandler {
  return () => renderPlaceholder(mount, t('publisher.section.import'), '3pf')
}

function notFoundPage(mount: HTMLElement): RouteHandler {
  return () => renderPlaceholder(mount, t('publisher.section.notFound'), '3pa/A')
}

let activeRouter: PublisherRouter | null = null

/**
 * Boot the publisher portal. Idempotent — calling twice reuses the
 * existing router rather than mounting a second one.
 */
export async function bootPublisherPortal(): Promise<void> {
  if (activeRouter) {
    logger.debug('[publisher] bootPublisherPortal called twice; reusing router')
    return
  }

  const mount = ensureMount()
  activeRouter = new PublisherRouter(
    [
      { pattern: '/publish', handler: mePage(mount) },
      { pattern: '/publish/me', handler: mePage(mount) },
      { pattern: '/publish/datasets', handler: datasetsPage(mount) },
      { pattern: '/publish/datasets/:id', handler: datasetDetailPage(mount) },
      { pattern: '/publish/tours', handler: toursPage(mount) },
      { pattern: '/publish/import', handler: importPage(mount) },
    ],
    notFoundPage(mount),
  )
  await activeRouter.start()
  logger.info('[publisher] portal booted at', window.location.pathname)
}

/** Tear down the portal — only used by tests. */
export function teardownPublisherPortal(): void {
  if (activeRouter) {
    activeRouter.stop()
    activeRouter = null
  }
  const mount = document.getElementById(PORTAL_ROOT_ID)
  if (mount) mount.remove()
  const loading = document.getElementById('loading-screen')
  if (loading) loading.style.display = ''
  const spa = document.getElementById('app')
  if (spa) spa.style.display = ''
}
