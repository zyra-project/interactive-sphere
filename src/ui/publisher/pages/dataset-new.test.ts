import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDatasetNewPage } from './dataset-new'

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setInput(mount: HTMLElement, selector: string, value: string): void {
  const el = mount.querySelector<HTMLInputElement>(selector)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setInputOnly(mount: HTMLElement, selector: string, value: string): void {
  const el = mount.querySelector<HTMLInputElement>(selector)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function clickRadio(mount: HTMLElement, name: string, value: string): void {
  const id = `${name}-${value.replace(/\W/g, '-')}`
  const el = mount.querySelector<HTMLInputElement>(`#${id}`)!
  el.checked = true
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function submitForm(mount: HTMLElement): void {
  const form = mount.querySelector<HTMLFormElement>('form.publisher-form')!
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('renderDatasetNewPage', () => {
  let mount: HTMLDivElement

  beforeEach(() => {
    mount = document.createElement('div')
    document.body.appendChild(mount)
    sessionStorage.clear()
  })

  it('renders the new-dataset heading and the required form fields', () => {
    renderDatasetNewPage(mount)
    expect(mount.querySelector('.publisher-detail-title')?.textContent).toBe(
      'New dataset',
    )
    expect(mount.querySelector('#dataset-title')).not.toBeNull()
    expect(mount.querySelector('#dataset-slug')).not.toBeNull()
    expect(mount.querySelectorAll('input[name="format"]').length).toBe(5)
    expect(mount.querySelectorAll('input[name="visibility"]').length).toBe(4)
  })

  it('defaults to format=video/mp4 and visibility=public', () => {
    renderDatasetNewPage(mount)
    const checkedFormat = mount.querySelector<HTMLInputElement>(
      'input[name="format"]:checked',
    )
    const checkedVis = mount.querySelector<HTMLInputElement>(
      'input[name="visibility"]:checked',
    )
    expect(checkedFormat?.value).toBe('video/mp4')
    expect(checkedVis?.value).toBe('public')
  })

  it('auto-derives the slug from the title as the user types', () => {
    renderDatasetNewPage(mount)
    setInputOnly(mount, '#dataset-title', 'Sea Surface Temperature — April 2026')
    const slug = mount.querySelector<HTMLInputElement>('#dataset-slug')!
    expect(slug.value).toBe('sea-surface-temperature-april-2026')
  })

  it('stops auto-deriving once the user edits the slug manually', () => {
    renderDatasetNewPage(mount)
    setInputOnly(mount, '#dataset-title', 'First title')
    setInputOnly(mount, '#dataset-slug', 'my-custom-slug')
    setInputOnly(mount, '#dataset-title', 'Second title')
    const slug = mount.querySelector<HTMLInputElement>('#dataset-slug')!
    expect(slug.value).toBe('my-custom-slug')
  })

  it('prefixes a slug derived from non-letter title with `dataset-`', () => {
    renderDatasetNewPage(mount)
    setInputOnly(mount, '#dataset-title', '2026 summary')
    const slug = mount.querySelector<HTMLInputElement>('#dataset-slug')!
    expect(slug.value).toBe('dataset-2026-summary')
  })

  it('POSTs the trimmed body on submit', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ dataset: { id: 'NEW01' } }))
    const routerNavigate = vi.fn()
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate,
    })

    setInput(mount, '#dataset-title', '  My Dataset  ')
    clickRadio(mount, 'format', 'image/png')
    clickRadio(mount, 'visibility', 'private')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))

    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/publish/datasets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'My Dataset',
          format: 'image/png',
          visibility: 'private',
        }),
      }),
    )
  })

  it('omits the slug from the body when not manually overridden (server derives)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ dataset: { id: 'NEW01' } }))
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'Auto-Slug Title')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))

    const sentBody = JSON.parse(fetchFn.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >
    expect(sentBody.slug).toBeUndefined()
  })

  it('includes the slug in the body when manually overridden', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ dataset: { id: 'NEW01' } }))
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'Any Title')
    setInput(mount, '#dataset-slug', 'my-custom')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))

    const sentBody = JSON.parse(fetchFn.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >
    expect(sentBody.slug).toBe('my-custom')
  })

  it('navigates to the detail page on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ dataset: { id: 'NEW01' } }))
    const routerNavigate = vi.fn()
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate,
    })

    setInput(mount, '#dataset-title', 'A Title')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    expect(routerNavigate).toHaveBeenCalledWith('/publish/datasets/NEW01')
  })

  it('renders per-field error messages on a 400 validation response', async () => {
    const errorsBody = {
      errors: [
        { field: 'title', code: 'too_short', message: 'Title must be at least 3 characters.' },
      ],
    }
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorsBody), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'Hi')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    const titleInput = mount.querySelector<HTMLInputElement>('#dataset-title')
    expect(titleInput?.getAttribute('aria-invalid')).toBe('true')
    expect(mount.textContent).toContain('Title must be at least 3 characters')
  })

  it('disables the Save button while saving', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>(r => {
        resolveFetch = r
      }),
    )
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'Some title')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))

    const btn = mount.querySelector<HTMLButtonElement>(
      'button.publisher-button-primary',
    )!
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('Saving…')

    resolveFetch(jsonResponse({ dataset: { id: 'X' } }))
  })

  it('renders the top-level server-error card on a 5xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'A title')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    expect(mount.querySelector('.publisher-error')?.getAttribute('role')).toBe('alert')
    expect(mount.textContent).toContain('server returned an error')
  })

  it('delegates session errors to the shared handler', async () => {
    sessionStorage.clear()
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    const navigate = vi.fn()
    renderDatasetNewPage(mount, {
      fetchFn: fetchFn as unknown as typeof fetch,
      navigate,
      routerNavigate: vi.fn(),
    })

    setInput(mount, '#dataset-title', 'A title')
    submitForm(mount)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    expect(navigate).toHaveBeenCalledOnce()
  })

  it('Cancel link routes back to /publish/datasets via SPA navigation', () => {
    const routerNavigate = vi.fn()
    renderDatasetNewPage(mount, { routerNavigate })

    const cancel = mount.querySelector<HTMLAnchorElement>('a.publisher-button-secondary')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    cancel.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(routerNavigate).toHaveBeenCalledWith('/publish/datasets')
  })
})
