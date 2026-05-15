/**
 * /publish/datasets/:id — read-only dataset detail view.
 *
 * Surfaces the catalog row through `GET /api/v1/publish/datasets/{id}`
 * (returns `{ dataset: PublisherDatasetDetail }`). Read-only in
 * 3pb; the edit form lands in 3pc. The page is intentionally
 * dense — it's the admin "show me everything we know about this
 * dataset" view — but groups fields into four glass-surface
 * cards so it stays scannable.
 *
 * 404 is distinct from generic server errors because the API
 * deliberately returns 404 both for "row doesn't exist" and "row
 * exists but you can't see it" (avoiding leakage of other
 * publishers' draft IDs). A not-found message that lets the user
 * jump back to the list is more useful than the generic retry
 * card.
 */

import { t } from '../../../i18n'
import {
  clearWarmupFlag,
  handleSessionError,
  publisherGet,
  publisherSend,
  type PublisherValidationError,
} from '../api'
import { buildErrorCard, type ErrorCardDetails } from '../components/error-card'
import type {
  DatasetDetailResponse,
  PublisherDatasetDetail,
} from '../types'
import { lifecycleOf } from '../types'

export interface DatasetDetailPageOptions {
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  navigate?: (url: string) => void
  /** History-API SPA navigation. Used by the Edit button so the
   *  jump to `/publish/datasets/:id/edit` reuses the portal's
   *  router instead of a hard page load. */
  routerNavigate?: (path: string) => void
  /** Confirmation prompt. Defaults to `window.confirm`; tests
   *  override to skip / auto-confirm without a real dialog. */
  confirmFn?: (message: string) => boolean
  /** Transcode poll cadence in ms. Defaults to 5000; tests
   *  override to a small value so the polling loop completes
   *  inside a vitest run. */
  transcodePollIntervalMs?: number
}

/** Kind of lifecycle-flip action the detail page can dispatch. */
type LifecycleAction = 'publish' | 'retract'

function endpoint(id: string): string {
  return `/api/v1/publish/datasets/${encodeURIComponent(id)}`
}

function renderLoading(content: HTMLElement): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'
  shell.setAttribute('aria-busy', 'true')
  const status = document.createElement('p')
  status.className = 'publisher-loading'
  status.setAttribute('role', 'status')
  status.textContent = t('publisher.datasetDetail.loading')
  shell.appendChild(status)
  content.replaceChildren(shell)
}

function renderError(
  content: HTMLElement,
  kind: 'session' | 'server' | 'network' | 'not_found',
  details: ErrorCardDetails = {},
): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'
  shell.appendChild(backLink())
  shell.appendChild(buildErrorCard(kind, details))
  content.replaceChildren(shell)
}

function backLink(): HTMLElement {
  const a = document.createElement('a')
  a.href = '/publish/datasets'
  a.className = 'publisher-back-link'
  a.textContent = `← ${t('publisher.datasetDetail.backToList')}`
  return a
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface HeaderHooks {
  routerNavigate?: (path: string) => void
  /** Dispatched when the publisher confirms a lifecycle flip.
   *  The page hands this through to `dispatchAction` so the
   *  re-fetch / re-render loop has access to options + content. */
  onAction?: (action: LifecycleAction) => void
}

function renderHeader(d: PublisherDatasetDetail, hooks: HeaderHooks): HTMLElement {
  const header = document.createElement('header')
  header.className = 'publisher-detail-header'

  const titleRow = document.createElement('div')
  titleRow.className = 'publisher-detail-title-row'

  const title = document.createElement('h1')
  title.className = 'publisher-detail-title'
  title.textContent = d.title
  titleRow.appendChild(title)

  const status = lifecycleOf(d)
  const badge = document.createElement('span')
  badge.className = 'publisher-badge publisher-badge-status'
  badge.dataset.status =
    status === 'draft' ? 'pending' : status === 'retracted' ? 'suspended' : 'active'
  badge.textContent =
    status === 'draft'
      ? t('publisher.datasets.status.draft')
      : status === 'published'
        ? t('publisher.datasets.status.published')
        : t('publisher.datasets.status.retracted')

  titleRow.appendChild(badge)

  // Transcoding badge — shown when 3pd's video upload has fired a
  // dispatch but the workflow hasn't finished yet. Renders inline
  // next to the lifecycle badge so the publisher sees both states
  // at a glance ("Draft" + "Transcoding…"). The badge disappears
  // automatically when the row's `transcoding` flag clears.
  if (d.transcoding) {
    const transcodingBadge = document.createElement('span')
    transcodingBadge.className = 'publisher-badge publisher-badge-transcoding'
    transcodingBadge.textContent = t('publisher.datasetDetail.transcoding.badge')
    titleRow.appendChild(transcodingBadge)
  }

  const editHref = `/publish/datasets/${encodeURIComponent(d.id)}/edit`
  const editLink = document.createElement('a')
  editLink.className = 'publisher-button publisher-button-secondary publisher-detail-edit'
  editLink.href = editHref
  editLink.textContent = t('publisher.datasetDetail.editAction')
  if (hooks.routerNavigate) {
    editLink.addEventListener('click', event => {
      // Plain left-click + no modifier → SPA navigation. Anything
      // else (cmd-click, middle-click, etc.) falls through to the
      // browser so the publisher can still open the edit form in a
      // new tab.
      if (
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault()
        hooks.routerNavigate!(editHref)
      }
    })
  }
  titleRow.appendChild(editLink)

  // Drafts and retracted rows surface a "Publish" affordance;
  // published rows surface "Retract". The route handlers accept
  // re-publishing a retracted row (it clears retracted_at and
  // re-stamps published_at) so the same button does double duty.
  //
  // While a row is transcoding (Phase 3pd video upload in flight)
  // the Publish button is gated: data_ref is empty until the GHA
  // workflow finishes, so the publish-readiness validator would
  // reject anyway. Disabling here gives the publisher a clearer
  // signal than "submit-then-error."
  if (status === 'published') {
    titleRow.appendChild(renderActionButton('retract', hooks.onAction))
  } else {
    titleRow.appendChild(
      renderActionButton('publish', hooks.onAction, { disabled: !!d.transcoding }),
    )
  }

  header.appendChild(titleRow)

  const slug = document.createElement('p')
  slug.className = 'publisher-detail-slug'
  slug.textContent = d.slug
  header.appendChild(slug)

  return header
}

function renderActionButton(
  action: LifecycleAction,
  onAction: ((action: LifecycleAction) => void) | undefined,
  opts: { disabled?: boolean } = {},
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className =
    action === 'publish'
      ? 'publisher-button publisher-button-primary publisher-detail-publish'
      : 'publisher-button publisher-button-danger publisher-detail-retract'
  btn.textContent =
    action === 'publish'
      ? t('publisher.datasetDetail.action.publish')
      : t('publisher.datasetDetail.action.retract')
  if (opts.disabled) {
    btn.disabled = true
    btn.title = t('publisher.datasetDetail.action.publishDisabledTranscoding')
  }
  btn.addEventListener('click', () => {
    if (!onAction || btn.disabled) return
    onAction(action)
  })
  return btn
}

interface FieldSpec {
  labelKey: DetailFieldKey
  value: string | null | undefined
  /** Render the value in a monospace cell. Used for IDs, refs,
   *  slugs — anything where character-level precision matters. */
  mono?: boolean
}

type DetailFieldKey =
  | 'publisher.datasetDetail.field.id'
  | 'publisher.datasetDetail.field.legacyId'
  | 'publisher.datasetDetail.field.format'
  | 'publisher.datasetDetail.field.visibility'
  | 'publisher.datasetDetail.field.organization'
  | 'publisher.datasetDetail.field.startTime'
  | 'publisher.datasetDetail.field.endTime'
  | 'publisher.datasetDetail.field.period'
  | 'publisher.datasetDetail.field.runTourOnLoad'
  | 'publisher.datasetDetail.field.dataRef'
  | 'publisher.datasetDetail.field.thumbnailRef'
  | 'publisher.datasetDetail.field.legendRef'
  | 'publisher.datasetDetail.field.captionRef'
  | 'publisher.datasetDetail.field.websiteLink'
  | 'publisher.datasetDetail.field.licenseSpdx'
  | 'publisher.datasetDetail.field.licenseUrl'
  | 'publisher.datasetDetail.field.licenseStatement'
  | 'publisher.datasetDetail.field.attribution'
  | 'publisher.datasetDetail.field.rightsHolder'
  | 'publisher.datasetDetail.field.doi'
  | 'publisher.datasetDetail.field.citation'
  | 'publisher.datasetDetail.field.publisherId'
  | 'publisher.datasetDetail.field.createdAt'
  | 'publisher.datasetDetail.field.updatedAt'
  | 'publisher.datasetDetail.field.publishedAt'
  | 'publisher.datasetDetail.field.retractedAt'

function renderFieldsCard(
  headingKey:
    | 'publisher.datasetDetail.section.identity'
    | 'publisher.datasetDetail.section.lifecycle'
    | 'publisher.datasetDetail.section.assets'
    | 'publisher.datasetDetail.section.licensing',
  fields: ReadonlyArray<FieldSpec>,
): HTMLElement {
  const visibleFields = fields.filter(f => f.value)
  if (visibleFields.length === 0) {
    // Don't render an empty card; the section just doesn't appear.
    return document.createDocumentFragment() as unknown as HTMLElement
  }

  const card = document.createElement('section')
  card.className = 'publisher-card publisher-glass'

  const h2 = document.createElement('h2')
  h2.className = 'publisher-card-heading'
  h2.textContent = t(headingKey)
  card.appendChild(h2)

  const grid = document.createElement('div')
  grid.className = 'publisher-fields'
  for (const f of visibleFields) {
    const row = document.createElement('div')
    row.className = 'publisher-field'

    const label = document.createElement('span')
    label.className = 'publisher-field-label'
    label.textContent = t(f.labelKey)
    row.appendChild(label)

    const value = document.createElement('span')
    value.className = f.mono
      ? 'publisher-field-value publisher-field-value-mono'
      : 'publisher-field-value'
    value.textContent = f.value!
    row.appendChild(value)

    grid.appendChild(row)
  }
  card.appendChild(grid)
  return card
}

function renderAbstract(d: PublisherDatasetDetail): HTMLElement {
  if (!d.abstract) {
    return document.createDocumentFragment() as unknown as HTMLElement
  }
  const card = document.createElement('section')
  card.className = 'publisher-card publisher-glass'

  const h2 = document.createElement('h2')
  h2.className = 'publisher-card-heading'
  h2.textContent = t('publisher.datasetDetail.section.abstract')
  card.appendChild(h2)

  // 3pb renders the abstract as plain text — the markdown
  // sanitizer lands in 3pc alongside the entry form's preview.
  // Setting textContent (not innerHTML) keeps this XSS-safe by
  // construction.
  const body = document.createElement('p')
  body.className = 'publisher-detail-abstract'
  body.textContent = d.abstract
  card.appendChild(body)
  return card
}

function renderChipList(values: ReadonlyArray<string>): HTMLElement {
  const list = document.createElement('div')
  list.className = 'publisher-chip-list'
  for (const v of values) {
    const chip = document.createElement('span')
    chip.className = 'publisher-chip'
    const text = document.createElement('span')
    text.className = 'publisher-chip-text'
    text.textContent = v
    chip.appendChild(text)
    list.appendChild(chip)
  }
  return list
}

function renderCategorizationCard(
  keywords: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
): HTMLElement {
  if (keywords.length === 0 && tags.length === 0) {
    return document.createDocumentFragment() as unknown as HTMLElement
  }
  const card = document.createElement('section')
  card.className = 'publisher-card publisher-glass'

  const h2 = document.createElement('h2')
  h2.className = 'publisher-card-heading'
  h2.textContent = t('publisher.datasetDetail.section.categorization')
  card.appendChild(h2)

  const grid = document.createElement('div')
  grid.className = 'publisher-fields'

  const rows: ReadonlyArray<
    readonly [
      (
        | 'publisher.datasetDetail.section.keywords'
        | 'publisher.datasetDetail.section.tags'
      ),
      ReadonlyArray<string>,
    ]
  > = [
    ['publisher.datasetDetail.section.keywords', keywords],
    ['publisher.datasetDetail.section.tags', tags],
  ]
  for (const [labelKey, values] of rows) {
    if (values.length === 0) continue
    const row = document.createElement('div')
    row.className = 'publisher-field'
    const label = document.createElement('span')
    label.className = 'publisher-field-label'
    label.textContent = t(labelKey)
    row.appendChild(label)
    const value = document.createElement('span')
    value.className = 'publisher-field-value'
    value.appendChild(renderChipList(values))
    row.appendChild(value)
    grid.appendChild(row)
  }

  card.appendChild(grid)
  return card
}

function renderDetail(
  content: HTMLElement,
  d: PublisherDatasetDetail,
  keywords: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
  hooks: HeaderHooks,
  actionError: string | null,
): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'

  shell.appendChild(backLink())
  shell.appendChild(renderHeader(d, hooks))
  if (actionError) {
    const err = document.createElement('p')
    err.className = 'publisher-detail-action-error'
    err.setAttribute('role', 'alert')
    err.textContent = actionError
    shell.appendChild(err)
  }
  shell.appendChild(renderAbstract(d))

  shell.appendChild(
    renderFieldsCard('publisher.datasetDetail.section.identity', [
      { labelKey: 'publisher.datasetDetail.field.id', value: d.id, mono: true },
      {
        labelKey: 'publisher.datasetDetail.field.legacyId',
        value: d.legacy_id,
        mono: true,
      },
      { labelKey: 'publisher.datasetDetail.field.format', value: d.format, mono: true },
      {
        labelKey: 'publisher.datasetDetail.field.visibility',
        value: d.visibility,
      },
      {
        labelKey: 'publisher.datasetDetail.field.organization',
        value: d.organization,
      },
      {
        labelKey: 'publisher.datasetDetail.field.publisherId',
        value: d.publisher_id,
        mono: true,
      },
    ]),
  )

  shell.appendChild(
    renderFieldsCard('publisher.datasetDetail.section.lifecycle', [
      {
        labelKey: 'publisher.datasetDetail.field.createdAt',
        value: formatDate(d.created_at),
      },
      {
        labelKey: 'publisher.datasetDetail.field.updatedAt',
        value: formatDate(d.updated_at),
      },
      {
        labelKey: 'publisher.datasetDetail.field.publishedAt',
        value: d.published_at ? formatDate(d.published_at) : null,
      },
      {
        labelKey: 'publisher.datasetDetail.field.retractedAt',
        value: d.retracted_at ? formatDate(d.retracted_at) : null,
      },
      {
        labelKey: 'publisher.datasetDetail.field.startTime',
        value: d.start_time,
      },
      { labelKey: 'publisher.datasetDetail.field.endTime', value: d.end_time },
      { labelKey: 'publisher.datasetDetail.field.period', value: d.period },
    ]),
  )

  shell.appendChild(renderCategorizationCard(keywords, tags))

  shell.appendChild(
    renderFieldsCard('publisher.datasetDetail.section.assets', [
      {
        labelKey: 'publisher.datasetDetail.field.dataRef',
        value: d.data_ref,
        mono: true,
      },
      {
        labelKey: 'publisher.datasetDetail.field.thumbnailRef',
        value: d.thumbnail_ref,
        mono: true,
      },
      {
        labelKey: 'publisher.datasetDetail.field.legendRef',
        value: d.legend_ref,
        mono: true,
      },
      {
        labelKey: 'publisher.datasetDetail.field.captionRef',
        value: d.caption_ref,
        mono: true,
      },
      {
        labelKey: 'publisher.datasetDetail.field.websiteLink',
        value: d.website_link,
      },
      {
        labelKey: 'publisher.datasetDetail.field.runTourOnLoad',
        value: d.run_tour_on_load,
      },
    ]),
  )

  shell.appendChild(
    renderFieldsCard('publisher.datasetDetail.section.licensing', [
      {
        labelKey: 'publisher.datasetDetail.field.licenseSpdx',
        value: d.license_spdx,
      },
      {
        labelKey: 'publisher.datasetDetail.field.licenseUrl',
        value: d.license_url,
      },
      {
        labelKey: 'publisher.datasetDetail.field.licenseStatement',
        value: d.license_statement,
      },
      {
        labelKey: 'publisher.datasetDetail.field.attribution',
        value: d.attribution_text,
      },
      {
        labelKey: 'publisher.datasetDetail.field.rightsHolder',
        value: d.rights_holder,
      },
      { labelKey: 'publisher.datasetDetail.field.doi', value: d.doi, mono: true },
      { labelKey: 'publisher.datasetDetail.field.citation', value: d.citation_text },
    ]),
  )

  content.replaceChildren(shell)
}

/**
 * Boot the /publish/datasets/:id page. The shared API helper
 * surfaces 404 as its own result kind so we can render the
 * not-found view directly instead of pretending it's a generic
 * server error.
 */
export async function renderDatasetDetailPage(
  content: HTMLElement,
  id: string,
  options: DatasetDetailPageOptions = {},
): Promise<void> {
  renderLoading(content)
  const result = await publisherGet<DatasetDetailResponse>(endpoint(id), options)
  if (!result.ok) {
    if (result.kind === 'session') {
      if (handleSessionError({ navigate: options.navigate }) === 'show-error') {
        renderError(content, 'session')
      }
      return
    }
    if (result.kind === 'server') {
      renderError(content, 'server', { status: result.status, body: result.body })
      return
    }
    renderError(content, result.kind)
    return
  }
  clearWarmupFlag()
  paint(content, id, result.data, options, null)
}

function paint(
  content: HTMLElement,
  id: string,
  data: DatasetDetailResponse,
  options: DatasetDetailPageOptions,
  actionError: string | null,
): void {
  const hooks: HeaderHooks = {
    routerNavigate: options.routerNavigate,
    onAction: action => {
      void dispatchAction(content, id, action, options)
    },
  }
  renderDetail(
    content,
    data.dataset,
    data.keywords ?? [],
    data.tags ?? [],
    hooks,
    actionError,
  )
  // Start (or restart) transcode polling if the row is still
  // transcoding. Stop any running poller if it isn't. The
  // start helper is idempotent — it cancels any prior poller
  // bound to this mount before starting a new one.
  if (data.dataset.transcoding) {
    startTranscodePolling(content, id, options)
  } else {
    stopTranscodePolling(content)
  }
}

/** Tracks the in-flight poll loop per mount element so a route
 *  change (or a successful poll completing) cancels the prior
 *  loop cleanly. WeakMap so detached mounts don't pin the
 *  AbortController in memory. */
const activeTranscodePolls = new WeakMap<HTMLElement, AbortController>()

/** Default polling cadence — matches what the asset-pipeline doc
 *  promises the publisher ("Whole loop takes 1–10 minutes ... the
 *  detail page polls every 5 s"). */
const TRANSCODE_POLL_INTERVAL_MS = 5000

function startTranscodePolling(
  content: HTMLElement,
  id: string,
  options: DatasetDetailPageOptions,
): void {
  // Cancel any prior loop on this mount — paint() re-runs on every
  // poll tick and we'd otherwise stack one new AbortController per
  // tick.
  activeTranscodePolls.get(content)?.abort()
  const controller = new AbortController()
  activeTranscodePolls.set(content, controller)
  void runTranscodePollLoop(content, id, options, controller.signal)
}

function stopTranscodePolling(content: HTMLElement): void {
  activeTranscodePolls.get(content)?.abort()
  activeTranscodePolls.delete(content)
}

async function runTranscodePollLoop(
  content: HTMLElement,
  id: string,
  options: DatasetDetailPageOptions,
  signal: AbortSignal,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep
  while (!signal.aborted) {
    await sleep(options.transcodePollIntervalMs ?? TRANSCODE_POLL_INTERVAL_MS)
    if (signal.aborted) return
    const result = await publisherGet<DatasetDetailResponse>(endpoint(id), {
      fetchFn: options.fetchFn,
      sleep: options.sleep,
    })
    if (signal.aborted) return
    if (!result.ok) {
      // Transient errors don't tear down the page — they just
      // pause the polling for one cycle. Session errors hand
      // through to the shared handler.
      if (result.kind === 'session') {
        if (handleSessionError({ navigate: options.navigate }) === 'show-error') {
          renderError(content, 'session')
          return
        }
      }
      continue
    }
    // paint() reads the fresh `transcoding` flag and either
    // restarts this loop (still transcoding) or stops it (cleared).
    paint(content, id, result.data, options, null)
    if (!result.data.dataset.transcoding) return
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Run a publish or retract action: ask for confirmation, POST to
 * the lifecycle endpoint, and re-render the page (with a fresh row
 * on success, or with an inline error banner on failure). The
 * heavy lifting — the audit row, the snapshot invalidation, the
 * embed enqueue — happens server-side. The portal's job here is
 * to surface the result.
 */
async function dispatchAction(
  content: HTMLElement,
  id: string,
  action: LifecycleAction,
  options: DatasetDetailPageOptions,
): Promise<void> {
  const confirmFn = options.confirmFn ?? ((m: string) => window.confirm(m))
  const message =
    action === 'publish'
      ? t('publisher.datasetDetail.action.confirm.publish')
      : t('publisher.datasetDetail.action.confirm.retract')
  if (!confirmFn(message)) return

  const url = `${endpoint(id)}/${action}`
  const result = await publisherSend<DatasetDetailResponse>(url, {}, {
    fetchFn: options.fetchFn,
    sleep: options.sleep,
  })

  if (result.ok) {
    // The action endpoints return `{ dataset }`; refetch so we pick
    // up the fresh decoration arrays the action route doesn't echo
    // back. Cheap and keeps the surface trivially correct against
    // future server-side response-shape drift.
    await renderDatasetDetailPage(content, id, options)
    return
  }
  if (result.kind === 'session') {
    if (handleSessionError({ navigate: options.navigate }) === 'show-error') {
      renderError(content, 'session')
    }
    return
  }
  // Re-fetch the row so the displayed status badge is consistent
  // with what the server thinks, then render the error banner over
  // the refreshed row.
  const errorMessage =
    result.kind === 'validation'
      ? formatValidationErrors(result.errors)
      : actionErrorMessage(result.kind)
  const fresh = await publisherGet<DatasetDetailResponse>(endpoint(id), {
    fetchFn: options.fetchFn,
    sleep: options.sleep,
  })
  if (fresh.ok) {
    paint(content, id, fresh.data, options, errorMessage)
    return
  }
  // If even the refetch fails, fall back to the static error card.
  if (fresh.kind === 'session') {
    if (handleSessionError({ navigate: options.navigate }) === 'show-error') {
      renderError(content, 'session')
    }
    return
  }
  renderError(content, fresh.kind)
}

function actionErrorMessage(kind: 'validation' | 'network' | 'server' | 'not_found'): string {
  if (kind === 'network') return t('publisher.datasetDetail.action.error.network')
  if (kind === 'validation') return t('publisher.datasetDetail.action.error.validation')
  if (kind === 'not_found') return t('publisher.datasetDetail.notFound')
  return t('publisher.datasetDetail.action.error.network')
}

/**
 * Compose a per-field publish-readiness message from the
 * server's `{errors: [{field, code, message}]}` envelope.
 * Falls back to the generic banner when no field-level details
 * are available — but the publish / retract endpoints always
 * populate `errors`, so in practice this returns the joined
 * server messages so the publisher can see what to fix without
 * leaving the detail page.
 */
function formatValidationErrors(errors: ReadonlyArray<PublisherValidationError>): string {
  if (errors.length === 0) {
    return t('publisher.datasetDetail.action.error.validation')
  }
  const prefix = t('publisher.datasetDetail.action.error.validationPrefix')
  const detail = errors.map(e => `${e.field}: ${e.message}`).join('; ')
  return `${prefix} ${detail}`
}
