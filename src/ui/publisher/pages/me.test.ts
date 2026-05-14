import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderMePage } from './me'

const SAMPLE: ReturnType<typeof samplePayload> = samplePayload()

function samplePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '01ABC',
    email: 'jane@example.org',
    display_name: 'Jane Doe',
    affiliation: 'NOAA/PMEL',
    role: 'staff',
    is_admin: true,
    status: 'active',
    created_at: '2024-09-15T12:00:00Z',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('renderMePage', () => {
  let mount: HTMLDivElement

  beforeEach(() => {
    mount = document.createElement('div')
    document.body.appendChild(mount)
  })

  it('renders a loading state immediately, then swaps in the profile', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>(r => {
        resolveFetch = r
      }),
    )

    const pending = renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.querySelector('.publisher-loading')).not.toBeNull()
    expect(mount.querySelector('.publisher-card')).toBeNull()

    resolveFetch(jsonResponse(SAMPLE))
    await pending

    expect(mount.querySelector('.publisher-loading')).toBeNull()
    expect(mount.querySelector('.publisher-card')).not.toBeNull()
    expect(mount.textContent).toContain('jane@example.org')
    expect(mount.textContent).toContain('NOAA/PMEL')
  })

  it('shows role + admin badges when is_admin is true', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(SAMPLE))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    const badges = mount.querySelectorAll('.publisher-badge')
    const texts = Array.from(badges).map(b => b.textContent)
    expect(texts).toContain('Staff')
    expect(texts).toContain('Admin')
  })

  it('hides the admin badge when is_admin is false', async () => {
    const payload = samplePayload({ is_admin: false })
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    const adminBadge = mount.querySelector('.publisher-badge-admin')
    expect(adminBadge).toBeNull()
  })

  it("renders an explicit 'Not set' when affiliation is null", async () => {
    const payload = samplePayload({ affiliation: null })
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.textContent).toContain('Not set')
  })

  it('applies the status data-status attribute so the badge can colour-code', async () => {
    const payload = samplePayload({ status: 'pending' })
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    const statusBadge = mount.querySelector<HTMLElement>('.publisher-badge-status')
    expect(statusBadge?.dataset.status).toBe('pending')
    expect(statusBadge?.textContent).toBe('Pending approval')
  })

  it('renders the session-expired error on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.querySelector('.publisher-error')?.getAttribute('role')).toBe('alert')
    expect(mount.textContent).toContain('session has expired')
    expect(mount.querySelector('.publisher-card')).not.toBeNull()
    const btn = mount.querySelector<HTMLButtonElement>('.publisher-button')
    expect(btn?.textContent).toBe('Sign in')
  })

  it('retries once on opaqueredirect and renders the profile when the retry succeeds', async () => {
    // First fetch returns opaqueredirect — Cloudflare Access has
    // 302'd to its cross-origin login HTML. The 302 response
    // carries Set-Cookie for the API-app CF_Authorization cookie
    // (cookie handling lives below the fetch API, so the browser
    // sets it even though fetch can't read the body). An
    // immediate retry then succeeds with the cookie present.
    const opaque = Object.assign(new Response('', { status: 200 }), {
      type: 'opaqueredirect' as const,
      status: 0,
    })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(opaque)
      .mockResolvedValueOnce(jsonResponse(SAMPLE))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await renderMePage(mount, fetchFn as unknown as typeof fetch, sleep)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(mount.querySelector('.publisher-card')).not.toBeNull()
    expect(mount.textContent).toContain('jane@example.org')
    expect(mount.querySelector('.publisher-error')).toBeNull()
  })

  it('renders the session-expired error when both attempts are opaqueredirect', async () => {
    // Second consecutive opaqueredirect is a real auth gap —
    // the cookie warmup didn't help, so the user genuinely needs
    // to sign in.
    const opaque = Object.assign(new Response('', { status: 200 }), {
      type: 'opaqueredirect' as const,
      status: 0,
    })
    const fetchFn = vi.fn().mockResolvedValue(opaque)
    const sleep = vi.fn().mockResolvedValue(undefined)
    await renderMePage(mount, fetchFn as unknown as typeof fetch, sleep)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(mount.querySelector('.publisher-error')?.getAttribute('role')).toBe('alert')
    expect(mount.textContent).toContain('session has expired')
    const btn = mount.querySelector<HTMLButtonElement>('.publisher-button')
    expect(btn?.textContent).toBe('Sign in')
  })

  it('renders the network error when the retry fetch throws', async () => {
    const opaque = Object.assign(new Response('', { status: 200 }), {
      type: 'opaqueredirect' as const,
      status: 0,
    })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(opaque)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await renderMePage(mount, fetchFn as unknown as typeof fetch, sleep)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(mount.textContent).toContain("Couldn't reach the server")
  })

  it('Sign in button navigates to /api/v1/publish/redirect-back with the current path as `to`', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    // location.href is read-only on the standard Location but
    // jsdom-style runtimes let us override it for the test.
    let navigatedTo: string | null = null
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      set(v: string) {
        navigatedTo = v
      },
      get() {
        return ''
      },
    })

    const btn = mount.querySelector<HTMLButtonElement>('.publisher-button')
    btn?.click()
    expect(navigatedTo).toMatch(/^\/api\/v1\/publish\/redirect-back\?to=/)
    // The current pathname is what would be encoded — at test
    // time that's the jsdom default (often `/`). Confirm round-
    // trip rather than literal value to keep the test robust.
    const params = new URL('https://localhost' + navigatedTo).searchParams
    expect(params.get('to')).toBe(window.location.pathname + window.location.search)
  })

  it("requests the fetch with redirect: 'manual'", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(SAMPLE))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/publish/me',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('renders the server error on 5xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.textContent).toContain('server returned an error')
  })

  it('renders the network error when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.textContent).toContain("Couldn't reach the server")
  })

  it('renders the server error when JSON parsing fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.textContent).toContain('server returned an error')
  })

  it('Refresh button (on server error) calls window.location.reload', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    const reload = vi.fn()
    // location.reload is read-only on the standard Location, but
    // jsdom lets us define a property override via defineProperty.
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reload,
    })

    const btn = mount.querySelector<HTMLButtonElement>('.publisher-button')
    expect(btn?.textContent).toBe('Refresh')
    btn?.click()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back to the raw role string for unknown roles', async () => {
    const payload = samplePayload({ role: 'future-role-name' })
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.textContent).toContain('future-role-name')
  })
})
