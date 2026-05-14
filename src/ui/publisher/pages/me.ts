/**
 * /publish/me — the publisher's own profile page.
 *
 * Fetches `GET /api/v1/publish/me` (Access-protected; the
 * middleware has already resolved a `publishers` row by the time
 * the response arrives) and renders the result as a glass-surface
 * card matching the SPA's chrome.
 *
 * Error envelopes match the rest of the publisher API:
 *
 *   - 401 — API middleware says the Access session expired.
 *   - opaqueredirect (status 0) — Access intercepted with a 302
 *     to its login page. Happens when the API path is gated by
 *     Access but the browser path (`/publish/**`) is not — the
 *     fetch gets redirected cross-origin and CORS blocks the
 *     login HTML. Treated as a session-expired condition because
 *     the user has the same recourse: sign in. Documented as
 *     part of `docs/SELF_HOSTING.md` §8f.
 *   - 5xx — server error; transient, suggest retry.
 *   - network — fetch threw; suggest connection check.
 *
 * The fetch implementation is injectable so tests can stub it
 * without `vi.stubGlobal('fetch', …)` polluting the global scope.
 */

import { t } from '../../../i18n'
import { logger } from '../../../utils/logger'

interface PublisherMeResponse {
  id: string
  email: string
  display_name: string
  affiliation: string | null
  role: string
  is_admin: boolean
  status: string
  created_at: string
}

type ErrorKind = 'session' | 'server' | 'network'

const ME_ENDPOINT = '/api/v1/publish/me'

/** Render a glass-surface card with the given child nodes. */
function card(...children: HTMLElement[]): HTMLElement {
  const el = document.createElement('section')
  el.className = 'publisher-card publisher-glass'
  for (const child of children) el.appendChild(child)
  return el
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h2')
  h.className = 'publisher-card-heading'
  h.textContent = text
  return h
}

function field(label: string, value: string, extraValueClass = ''): HTMLElement {
  const row = document.createElement('div')
  row.className = 'publisher-field'

  const labelEl = document.createElement('span')
  labelEl.className = 'publisher-field-label'
  labelEl.textContent = label

  const valueEl = document.createElement('span')
  valueEl.className = `publisher-field-value ${extraValueClass}`.trim()
  valueEl.textContent = value

  row.appendChild(labelEl)
  row.appendChild(valueEl)
  return row
}

function badge(text: string, kind: 'admin' | 'role' | 'status'): HTMLElement {
  const el = document.createElement('span')
  el.className = `publisher-badge publisher-badge-${kind}`
  el.textContent = text
  return el
}

function renderLoading(mount: HTMLElement): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'
  shell.setAttribute('aria-busy', 'true')
  const status = document.createElement('p')
  status.className = 'publisher-loading'
  status.setAttribute('role', 'status')
  status.textContent = t('publisher.me.loading')
  shell.appendChild(status)
  mount.replaceChildren(shell)
}

/**
 * Build the URL the "Sign in" button navigates to. The endpoint
 * lives under `/api/v1/publish/`, gated by the same Access app
 * that's blocking us — the browser's top-level navigation
 * triggers Access's transparent re-auth via the team-level
 * session, the cookie lands at `Path=/api/v1/publish/`, and the
 * endpoint 302s the browser back to the portal path. See
 * `functions/api/v1/publish/redirect-back.ts` for the full
 * explanation.
 */
function signInUrl(): string {
  const here = window.location.pathname + window.location.search
  return `/api/v1/publish/redirect-back?to=${encodeURIComponent(here)}`
}

function renderError(mount: HTMLElement, kind: ErrorKind): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'

  const errorCard = document.createElement('section')
  errorCard.className = 'publisher-card publisher-glass publisher-error'
  errorCard.setAttribute('role', 'alert')

  const msg = document.createElement('p')
  msg.className = 'publisher-error-message'
  const messageKey =
    kind === 'session'
      ? 'publisher.me.error.session'
      : kind === 'network'
        ? 'publisher.me.error.network'
        : 'publisher.me.error.server'
  msg.textContent = t(messageKey)
  errorCard.appendChild(msg)

  const action = document.createElement('button')
  action.type = 'button'
  action.className = 'publisher-button'
  if (kind === 'session') {
    // Session errors (opaqueredirect from Access, or a 401 from
    // the API middleware) require a top-level navigation through
    // the redirect-back endpoint so Cloudflare Access can set the
    // API app's cookie at the right Path scope. A plain reload
    // doesn't help because the portal-app cookie is already set;
    // the missing piece is the API-app cookie.
    action.textContent = t('publisher.me.error.signIn')
    action.addEventListener('click', () => {
      window.location.href = signInUrl()
    })
  } else {
    // Network and server errors are transient — the user's auth
    // state is fine, the connection or backend is hiccupping. A
    // plain reload is the right primary action.
    action.textContent = t('publisher.me.error.refresh')
    action.addEventListener('click', () => {
      window.location.reload()
    })
  }
  errorCard.appendChild(action)

  shell.appendChild(errorCard)
  mount.replaceChildren(shell)
}

function localizedRole(role: string): string {
  switch (role) {
    case 'staff':
      return t('publisher.me.role.staff')
    case 'community':
      return t('publisher.me.role.community')
    case 'service':
      return t('publisher.me.role.service')
    case 'readonly':
      return t('publisher.me.role.readonly')
    default:
      return role
  }
}

function localizedStatus(status: string): string {
  switch (status) {
    case 'active':
      return t('publisher.me.status.active')
    case 'pending':
      return t('publisher.me.status.pending')
    case 'suspended':
      return t('publisher.me.status.suspended')
    default:
      return status
  }
}

/**
 * Format an ISO 8601 timestamp using the active locale.
 * Falls back to the raw string if `Date` can't parse it.
 */
function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function renderProfile(mount: HTMLElement, me: PublisherMeResponse): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'

  const head = heading(t('publisher.me.heading'))
  const fields = document.createElement('div')
  fields.className = 'publisher-fields'

  fields.appendChild(field(t('publisher.me.field.email'), me.email))

  // Role + admin live on the same row visually but render as two
  // separate badges to keep the textContent semantics simple.
  const roleRow = document.createElement('div')
  roleRow.className = 'publisher-field'
  const roleLabel = document.createElement('span')
  roleLabel.className = 'publisher-field-label'
  roleLabel.textContent = t('publisher.me.field.role')
  const roleValue = document.createElement('span')
  roleValue.className = 'publisher-field-value'
  roleValue.appendChild(badge(localizedRole(me.role), 'role'))
  if (me.is_admin) {
    roleValue.appendChild(badge(t('publisher.me.role.admin'), 'admin'))
  }
  roleRow.appendChild(roleLabel)
  roleRow.appendChild(roleValue)
  fields.appendChild(roleRow)

  // Affiliation. Empty/null renders an explicit "not set" rather
  // than an empty value so the publisher knows the field exists.
  fields.appendChild(
    field(
      t('publisher.me.field.affiliation'),
      me.affiliation && me.affiliation.length > 0
        ? me.affiliation
        : t('publisher.me.affiliation.none'),
    ),
  )

  // Status with a coloured badge.
  const statusRow = document.createElement('div')
  statusRow.className = 'publisher-field'
  const statusLabel = document.createElement('span')
  statusLabel.className = 'publisher-field-label'
  statusLabel.textContent = t('publisher.me.field.status')
  const statusValue = document.createElement('span')
  statusValue.className = 'publisher-field-value'
  const statusBadge = badge(localizedStatus(me.status), 'status')
  statusBadge.dataset.status = me.status
  statusValue.appendChild(statusBadge)
  statusRow.appendChild(statusLabel)
  statusRow.appendChild(statusValue)
  fields.appendChild(statusRow)

  fields.appendChild(
    field(t('publisher.me.field.memberSince'), formatCreatedAt(me.created_at)),
  )

  const profileCard = card(head, fields)
  shell.appendChild(profileCard)
  mount.replaceChildren(shell)
}

/**
 * Wait `ms` milliseconds. Pure async sleep; injectable so tests
 * don't burn real wall-clock time.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Why we need this: when an unauthenticated portal session
 * fetches /api/v1/publish/me, Cloudflare Access intercepts with
 * a 302 to its cross-origin login flow. With `redirect: 'manual'`
 * the fetch surfaces this as an opaqueredirect response. The
 * 302 response, however, *also* carries `Set-Cookie` headers
 * that propagate the API-app `CF_Authorization` cookie to the
 * browser — cookie handling lives at the network layer, below
 * the fetch API, so the browser processes it even though fetch
 * cannot read the response body.
 *
 * The upshot: the first opaqueredirect fails BUT primes the
 * cookie. An immediate retry usually succeeds because the
 * cookie is now present and the next fetch sails through
 * Access.
 *
 * Cap at one retry — anything beyond that points at a genuine
 * auth gap (no team-level session, policy doesn't match the
 * user, etc.) where retrying is futile and the session-error
 * card is the right surface.
 */
const COOKIE_WARMUP_DELAY_MS = 100

function isAccessRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || res.status === 0
}

async function fetchMe(fetchFn: typeof fetch): Promise<Response> {
  return fetchFn(ME_ENDPOINT, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    // `manual` so we can recognise an Access redirect explicitly.
    // The default `follow` mode silently follows the 302 to
    // Cloudflare's login page, which is cross-origin and
    // CORS-blocked, surfacing as an indistinguishable network
    // error.
    redirect: 'manual',
  })
}

/**
 * Boot the /publish/me page. Renders a loading state, kicks off
 * the fetch, then swaps in the profile card or an error card
 * based on the result. Idempotent — calling it again replaces the
 * current contents in-place.
 *
 * `sleep` is injectable so unit tests can advance time without
 * burning wall-clock on the cookie-warmup delay.
 */
export async function renderMePage(
  mount: HTMLElement,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  renderLoading(mount)

  let res: Response
  try {
    res = await fetchMe(fetchFn)
  } catch (err) {
    logger.warn('[publisher] /publish/me fetch threw', err)
    renderError(mount, 'network')
    return
  }

  // First-attempt opaqueredirect is usually the "cookie just got
  // primed via Set-Cookie on the redirect response" pattern.
  // Wait a beat for the browser to register the cookie, then
  // retry once. Persistent opaqueredirect on the second attempt
  // is a real auth gap.
  if (isAccessRedirect(res)) {
    logger.debug('[publisher] /publish/me opaqueredirect; retrying once after cookie warmup')
    await sleep(COOKIE_WARMUP_DELAY_MS)
    try {
      res = await fetchMe(fetchFn)
    } catch (err) {
      logger.warn('[publisher] /publish/me retry fetch threw', err)
      renderError(mount, 'network')
      return
    }
    if (isAccessRedirect(res)) {
      renderError(mount, 'session')
      return
    }
  }

  if (res.status === 401) {
    renderError(mount, 'session')
    return
  }
  if (!res.ok) {
    logger.warn('[publisher] /publish/me returned', res.status)
    renderError(mount, 'server')
    return
  }

  let body: PublisherMeResponse
  try {
    body = (await res.json()) as PublisherMeResponse
  } catch (err) {
    logger.warn('[publisher] /publish/me JSON parse failed', err)
    renderError(mount, 'server')
    return
  }
  renderProfile(mount, body)
}
