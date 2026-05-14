/**
 * /publish/datasets/new — create a new draft dataset.
 *
 * 3pc/B is the scaffolding pass: only the required + identity
 * fields the validator's `validateDraftCreate` covers on the
 * required side — Title and Format. Slug is auto-derived from
 * the title (the server does the same derivation, but the form
 * shows it live so the publisher can override before saving).
 * Visibility defaults to `public` and is presented as a radio.
 *
 * Recommended fields (abstract + markdown preview, organization,
 * categories, keywords, time range, license) land in 3pc/C — same
 * form, just more sections. The deferred fields are explicitly
 * listed below the Save button so the publisher knows they're
 * coming.
 *
 * On success the page navigates to /publish/datasets/{id} where
 * the read-only detail view from 3pb/C renders the newly-created
 * row. Validation errors render inline next to the offending
 * field; non-validation errors render a top-level alert.
 */

import { t } from '../../../i18n'
import {
  clearWarmupFlag,
  handleSessionError,
  publisherSend,
  type PublisherValidationError,
} from '../api'
import { buildErrorCard, type ErrorCardDetails } from '../components/error-card'
import {
  attachToolbar,
  renderMarkdownToolbar,
} from '../components/markdown-toolbar'
import { renderMarkdown } from '../../../services/markdownRenderer'

export interface DatasetNewPageOptions {
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  navigate?: (url: string) => void
  /** History-API SPA navigation for the post-save redirect.
   *  Tests stub it to assert on the destination URL. */
  routerNavigate?: (path: string) => void
}

const CREATE_ENDPOINT = '/api/v1/publish/datasets'

interface FormState {
  title: string
  slug: string
  /** `true` when the user has manually edited the slug field;
   *  after that we stop auto-deriving from the title so we don't
   *  clobber their explicit choice. */
  slugLocked: boolean
  format: string
  visibility: string
  abstract: string
  /** Toggle between editing the abstract markdown source and
   *  rendering the sanitized preview. The same `renderMarkdown`
   *  function the public dataset detail page will use generates
   *  the preview, so what the publisher sees is byte-for-byte
   *  what the public will see. */
  abstractPreviewing: boolean
  isSaving: boolean
  errors: ReadonlyArray<PublisherValidationError>
  /** Non-validation top-level error (network / server / session
   *  / not_found). Rendered in an alert above the form when set. */
  topLevelError: 'server' | 'network' | 'session' | null
  /** Status + body captured for `server`-kind errors so the error
   *  card can disclose them. Operator-debugging affordance. */
  topLevelErrorDetails: ErrorCardDetails
}

const FORMATS: ReadonlyArray<{ value: string; labelKey: FormatLabelKey }> = [
  { value: 'video/mp4', labelKey: 'publisher.datasetForm.format.video' },
  { value: 'image/png', labelKey: 'publisher.datasetForm.format.imagePng' },
  { value: 'image/jpeg', labelKey: 'publisher.datasetForm.format.imageJpeg' },
  { value: 'image/webp', labelKey: 'publisher.datasetForm.format.imageWebp' },
  { value: 'tour/json', labelKey: 'publisher.datasetForm.format.tour' },
]

const VISIBILITIES: ReadonlyArray<{ value: string; labelKey: VisibilityLabelKey }> = [
  { value: 'public', labelKey: 'publisher.datasetForm.visibility.public' },
  { value: 'federated', labelKey: 'publisher.datasetForm.visibility.federated' },
  { value: 'restricted', labelKey: 'publisher.datasetForm.visibility.restricted' },
  { value: 'private', labelKey: 'publisher.datasetForm.visibility.private' },
]

type FormatLabelKey =
  | 'publisher.datasetForm.format.video'
  | 'publisher.datasetForm.format.imagePng'
  | 'publisher.datasetForm.format.imageJpeg'
  | 'publisher.datasetForm.format.imageWebp'
  | 'publisher.datasetForm.format.tour'

type VisibilityLabelKey =
  | 'publisher.datasetForm.visibility.public'
  | 'publisher.datasetForm.visibility.federated'
  | 'publisher.datasetForm.visibility.restricted'
  | 'publisher.datasetForm.visibility.private'

/**
 * Client-side slug derivation matching `deriveSlug` in
 * `functions/api/v1/_lib/validators.ts`. We mirror it so the live
 * preview matches what the server would persist if the publisher
 * leaves the slug blank.
 */
function deriveSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '')
  if (!base) return 'dataset'
  if (!/^[a-z]/.test(base)) {
    return `dataset-${base}`.slice(0, 64).replace(/-+$/, '')
  }
  return base
}

function findError(
  errors: ReadonlyArray<PublisherValidationError>,
  field: string,
): PublisherValidationError | null {
  return errors.find(e => e.field === field) ?? null
}

function backLink(): HTMLElement {
  const a = document.createElement('a')
  a.href = '/publish/datasets'
  a.className = 'publisher-back-link'
  a.textContent = `← ${t('publisher.datasetDetail.backToList')}`
  return a
}

function renderTopLevelError(
  kind: 'server' | 'network' | 'session',
  details: ErrorCardDetails,
): HTMLElement {
  return buildErrorCard(kind, details)
}

function abstractCard(
  state: FormState,
  rerender: () => void,
): HTMLElement {
  const card = document.createElement('section')
  card.className = 'publisher-card publisher-glass publisher-form-card'

  const heading = document.createElement('h2')
  heading.className = 'publisher-card-heading'
  heading.textContent = t('publisher.datasetForm.section.abstract')
  card.appendChild(heading)

  const wrap = document.createElement('div')
  wrap.className = 'publisher-form-field'

  const labelRow = document.createElement('div')
  labelRow.className = 'publisher-form-label-row'

  const label = document.createElement('label')
  label.className = 'publisher-form-label'
  label.htmlFor = 'dataset-abstract'
  label.textContent = t('publisher.datasetForm.field.abstract')
  labelRow.appendChild(label)

  // Edit ↔ Preview toggle. Plain button rather than tab pattern
  // because there are exactly two states and the textarea / preview
  // panes don't carry conceptual identity beyond "the abstract".
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'publisher-form-toggle'
  toggle.textContent = state.abstractPreviewing
    ? t('publisher.datasetForm.action.edit')
    : t('publisher.datasetForm.action.preview')
  toggle.addEventListener('click', () => {
    state.abstractPreviewing = !state.abstractPreviewing
    rerender()
  })
  labelRow.appendChild(toggle)

  wrap.appendChild(labelRow)

  if (state.abstractPreviewing) {
    const preview = document.createElement('div')
    preview.className = 'publisher-form-markdown-preview'
    if (state.abstract.trim().length === 0) {
      const empty = document.createElement('p')
      empty.className = 'publisher-form-markdown-empty'
      empty.textContent = t('publisher.datasetForm.preview.empty')
      preview.appendChild(empty)
    } else {
      // renderMarkdown runs `marked` then sanitizeMarkdownHtml.
      // The returned HTML is safe to set as innerHTML — XSS-tested
      // in src/services/markdownRenderer.test.ts.
      preview.innerHTML = renderMarkdown(state.abstract)
    }
    wrap.appendChild(preview)
  } else {
    // Toolbar above the textarea — GitHub-issue style. Buttons
    // mutate the textarea directly (no parent re-render), so
    // focus + selection stay intact across button presses.
    const toolbar = renderMarkdownToolbar()
    wrap.appendChild(toolbar)

    const textarea = document.createElement('textarea')
    textarea.id = 'dataset-abstract'
    textarea.className = 'publisher-form-textarea'
    textarea.rows = 8
    textarea.placeholder = t('publisher.datasetForm.placeholder.abstract')
    textarea.value = state.abstract
    textarea.addEventListener('input', () => {
      state.abstract = textarea.value
    })
    textarea.addEventListener('change', () => {
      state.abstract = textarea.value
    })
    wrap.appendChild(textarea)

    attachToolbar(toolbar, textarea, {
      onChange: v => {
        state.abstract = v
      },
    })
  }

  const help = document.createElement('p')
  help.className = 'publisher-form-help'
  help.textContent = t('publisher.datasetForm.help.abstract')
  wrap.appendChild(help)

  const error = findError(state.errors, 'abstract')
  if (error) {
    const err = document.createElement('p')
    err.className = 'publisher-form-error'
    err.setAttribute('role', 'alert')
    err.textContent = error.message
    wrap.appendChild(err)
  }

  card.appendChild(wrap)
  return card
}

function inputField(opts: {
  id: string
  labelKey:
    | 'publisher.datasetForm.field.title'
    | 'publisher.datasetForm.field.slug'
  required: boolean
  value: string
  placeholder?: string
  error: PublisherValidationError | null
  helpKey?: 'publisher.datasetForm.help.slug'
  onChange: (v: string) => void
  onInput?: (v: string) => void
}): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'publisher-form-field'

  const label = document.createElement('label')
  label.className = 'publisher-form-label'
  label.htmlFor = opts.id
  const labelText = document.createElement('span')
  labelText.textContent = t(opts.labelKey)
  label.appendChild(labelText)
  if (opts.required) {
    const req = document.createElement('span')
    req.className = 'publisher-form-required'
    req.setAttribute('aria-label', t('publisher.datasetForm.requiredAria'))
    req.textContent = '*'
    label.appendChild(req)
  }
  wrap.appendChild(label)

  const input = document.createElement('input')
  input.type = 'text'
  input.id = opts.id
  input.className = 'publisher-form-input'
  input.value = opts.value
  if (opts.placeholder) input.placeholder = opts.placeholder
  if (opts.error) {
    input.setAttribute('aria-invalid', 'true')
    input.setAttribute('aria-describedby', `${opts.id}-err`)
  }
  input.addEventListener('input', () => {
    if (opts.onInput) opts.onInput(input.value)
  })
  input.addEventListener('change', () => opts.onChange(input.value))
  input.addEventListener('blur', () => opts.onChange(input.value))
  wrap.appendChild(input)

  if (opts.helpKey) {
    const help = document.createElement('p')
    help.className = 'publisher-form-help'
    help.textContent = t(opts.helpKey)
    wrap.appendChild(help)
  }

  if (opts.error) {
    const err = document.createElement('p')
    err.id = `${opts.id}-err`
    err.className = 'publisher-form-error'
    err.setAttribute('role', 'alert')
    err.textContent = opts.error.message
    wrap.appendChild(err)
  }
  return wrap
}

function radioGroup(opts: {
  legendKey:
    | 'publisher.datasetForm.field.format'
    | 'publisher.datasetForm.field.visibility'
  name: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  required: boolean
  error: PublisherValidationError | null
  onChange: (v: string) => void
}): HTMLElement {
  const fieldset = document.createElement('fieldset')
  fieldset.className = 'publisher-form-fieldset'

  const legend = document.createElement('legend')
  legend.className = 'publisher-form-label'
  const legendText = document.createElement('span')
  legendText.textContent = t(opts.legendKey)
  legend.appendChild(legendText)
  if (opts.required) {
    const req = document.createElement('span')
    req.className = 'publisher-form-required'
    req.setAttribute('aria-label', t('publisher.datasetForm.requiredAria'))
    req.textContent = '*'
    legend.appendChild(req)
  }
  fieldset.appendChild(legend)

  for (const o of opts.options) {
    const id = `${opts.name}-${o.value.replace(/\W/g, '-')}`
    const wrap = document.createElement('label')
    wrap.className = 'publisher-form-radio'
    wrap.htmlFor = id

    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.id = id
    radio.name = opts.name
    radio.value = o.value
    radio.checked = o.value === opts.value
    radio.addEventListener('change', () => opts.onChange(o.value))
    wrap.appendChild(radio)

    const span = document.createElement('span')
    span.textContent = o.label
    wrap.appendChild(span)

    fieldset.appendChild(wrap)
  }

  if (opts.error) {
    const err = document.createElement('p')
    err.className = 'publisher-form-error'
    err.setAttribute('role', 'alert')
    err.textContent = opts.error.message
    fieldset.appendChild(err)
  }

  return fieldset
}

function renderForm(
  content: HTMLElement,
  state: FormState,
  options: Required<Pick<DatasetNewPageOptions, 'fetchFn' | 'sleep' | 'navigate'>> & {
    routerNavigate: (path: string) => void
  },
): void {
  const shell = document.createElement('main')
  shell.className = 'publisher-shell'

  shell.appendChild(backLink())

  const heading = document.createElement('h1')
  heading.className = 'publisher-detail-title'
  heading.textContent = t('publisher.datasetForm.headingNew')
  shell.appendChild(heading)

  if (state.topLevelError) {
    shell.appendChild(renderTopLevelError(state.topLevelError, state.topLevelErrorDetails))
  }

  const form = document.createElement('form')
  form.className = 'publisher-form'
  form.setAttribute('novalidate', '')
  form.addEventListener('submit', e => {
    e.preventDefault()
    void onSubmit()
  })

  const identityCard = document.createElement('section')
  identityCard.className = 'publisher-card publisher-glass publisher-form-card'

  const cardHeading = document.createElement('h2')
  cardHeading.className = 'publisher-card-heading'
  cardHeading.textContent = t('publisher.datasetForm.section.identity')
  identityCard.appendChild(cardHeading)

  identityCard.appendChild(
    inputField({
      id: 'dataset-title',
      labelKey: 'publisher.datasetForm.field.title',
      required: true,
      value: state.title,
      placeholder: t('publisher.datasetForm.placeholder.title'),
      error: findError(state.errors, 'title'),
      onChange: v => {
        state.title = v
        if (!state.slugLocked) state.slug = deriveSlug(v)
        update()
      },
      onInput: v => {
        // Live-update the slug field as the user types, without
        // re-rendering the whole form (which would steal focus).
        if (!state.slugLocked) {
          const slugInput = content.querySelector<HTMLInputElement>('#dataset-slug')
          if (slugInput) slugInput.value = deriveSlug(v)
          state.slug = deriveSlug(v)
        }
      },
    }),
  )

  identityCard.appendChild(
    inputField({
      id: 'dataset-slug',
      labelKey: 'publisher.datasetForm.field.slug',
      required: false,
      value: state.slug,
      placeholder: 'sst-anomaly-2026-04',
      error: findError(state.errors, 'slug'),
      helpKey: 'publisher.datasetForm.help.slug',
      onChange: v => {
        state.slug = v
        state.slugLocked = true
      },
      onInput: v => {
        // Mark locked the moment the user types into the field,
        // so subsequent title edits don't clobber their override.
        state.slug = v
        state.slugLocked = true
      },
    }),
  )

  identityCard.appendChild(
    radioGroup({
      legendKey: 'publisher.datasetForm.field.format',
      name: 'format',
      options: FORMATS.map(f => ({ value: f.value, label: t(f.labelKey) })),
      value: state.format,
      required: true,
      error: findError(state.errors, 'format'),
      onChange: v => {
        state.format = v
        update()
      },
    }),
  )

  identityCard.appendChild(
    radioGroup({
      legendKey: 'publisher.datasetForm.field.visibility',
      name: 'visibility',
      options: VISIBILITIES.map(v => ({ value: v.value, label: t(v.labelKey) })),
      value: state.visibility,
      required: false,
      error: findError(state.errors, 'visibility'),
      onChange: v => {
        state.visibility = v
        update()
      },
    }),
  )

  form.appendChild(identityCard)
  form.appendChild(abstractCard(state, update))

  // Submit row.
  const actions = document.createElement('div')
  actions.className = 'publisher-form-actions'

  const cancel = document.createElement('a')
  cancel.href = '/publish/datasets'
  cancel.className = 'publisher-button publisher-button-secondary'
  cancel.textContent = t('publisher.datasetForm.action.cancel')
  cancel.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    options.routerNavigate('/publish/datasets')
  })
  actions.appendChild(cancel)

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'publisher-button publisher-button-primary'
  submit.textContent = state.isSaving
    ? t('publisher.datasetForm.action.saving')
    : t('publisher.datasetForm.action.saveDraft')
  submit.disabled = state.isSaving
  actions.appendChild(submit)

  form.appendChild(actions)

  // "More fields coming" hint so the publisher knows the form
  // isn't yet feature-complete and a draft can still be saved
  // partial.
  const hint = document.createElement('p')
  hint.className = 'publisher-form-deferred'
  hint.textContent = t('publisher.datasetForm.deferredHint')
  form.appendChild(hint)

  shell.appendChild(form)
  content.replaceChildren(shell)

  function update(): void {
    renderForm(content, state, options)
  }

  async function onSubmit(): Promise<void> {
    state.isSaving = true
    state.errors = []
    state.topLevelError = null
    update()

    const body: Record<string, unknown> = {
      title: state.title.trim(),
      format: state.format,
      visibility: state.visibility,
    }
    // Only send slug if the publisher manually overrode it.
    // Otherwise the server's deriveSlug() runs and we get
    // exactly the same value we previewed.
    if (state.slugLocked && state.slug.trim()) {
      body.slug = state.slug.trim()
    }
    // Trim — leading/trailing whitespace shouldn't survive into
    // the persisted row. An empty post-trim abstract is omitted
    // entirely so the column lands NULL rather than `""`.
    const abstract = state.abstract.trim()
    if (abstract) body.abstract = abstract

    const result = await publisherSend<{ dataset: { id: string } }>(
      CREATE_ENDPOINT,
      body,
      {
        fetchFn: options.fetchFn,
        sleep: options.sleep,
        method: 'POST',
      },
    )
    state.isSaving = false

    if (result.ok) {
      clearWarmupFlag()
      options.routerNavigate(`/publish/datasets/${encodeURIComponent(result.data.dataset.id)}`)
      return
    }
    if (result.kind === 'validation') {
      state.errors = result.errors
      update()
      return
    }
    if (result.kind === 'session') {
      if (handleSessionError({ navigate: options.navigate }) === 'show-error') {
        state.topLevelError = 'session'
        state.topLevelErrorDetails = {}
        update()
      }
      return
    }
    if (result.kind === 'server') {
      state.topLevelError = 'server'
      state.topLevelErrorDetails = { status: result.status, body: result.body }
      update()
      return
    }
    // network / not_found — surface as a transient network error.
    state.topLevelError = 'network'
    state.topLevelErrorDetails = {}
    update()
  }
}

/**
 * Boot the /publish/datasets/new page. Initialises form state
 * with the spec's defaults (format=video/mp4, visibility=public)
 * and renders the form. Idempotent — calling again resets the
 * form to defaults.
 */
export function renderDatasetNewPage(
  content: HTMLElement,
  options: DatasetNewPageOptions = {},
): void {
  const state: FormState = {
    title: '',
    slug: '',
    slugLocked: false,
    format: 'video/mp4',
    visibility: 'public',
    abstract: '',
    abstractPreviewing: false,
    isSaving: false,
    errors: [],
    topLevelError: null,
    topLevelErrorDetails: {},
  }
  renderForm(content, state, {
    fetchFn: options.fetchFn ?? globalThis.fetch,
    sleep: options.sleep ?? (ms => new Promise(r => setTimeout(r, ms))),
    navigate:
      options.navigate ??
      (url => {
        window.location.href = url
      }),
    routerNavigate:
      options.routerNavigate ??
      (path => {
        window.location.href = path
      }),
  })
}
