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
  })

  it('renders the session-expired error on opaqueredirect (Cloudflare Access redirect)', async () => {
    // `redirect: 'manual'` causes the fetch runtime to return
    // an opaque response whose type is 'opaqueredirect' (and
    // status 0). Cloudflare Access uses this path to redirect
    // unauthenticated callers to its login HTML — a cross-origin
    // page we can't read.
    const opaque = Object.assign(new Response('', { status: 200 }), {
      type: 'opaqueredirect' as const,
      status: 0,
    })
    const fetchFn = vi.fn().mockResolvedValue(opaque)
    await renderMePage(mount, fetchFn as unknown as typeof fetch)

    expect(mount.querySelector('.publisher-error')?.getAttribute('role')).toBe('alert')
    expect(mount.textContent).toContain('session has expired')
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

  it('refresh button calls window.location.reload', async () => {
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
