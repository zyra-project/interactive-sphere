import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderTopbar, teardownTopbar } from './topbar'
import { PublisherRouter, ROUTE_CHANGE_EVENT } from '../router'

function clickWith(el: HTMLElement, init: Partial<MouseEventInit> = {}): MouseEvent {
  const e = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  el.dispatchEvent(e)
  return e
}

describe('renderTopbar', () => {
  const originalPath = window.location.pathname
  let host: HTMLDivElement
  let router: PublisherRouter

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    router = new PublisherRouter([{ pattern: '/publish/me', handler: vi.fn() }], vi.fn())
  })

  afterEach(() => {
    teardownTopbar(host)
    router.stop()
    host.remove()
    window.history.replaceState(null, '', originalPath)
  })

  it('renders all four section tabs in order', () => {
    renderTopbar(host, router)
    const links = host.querySelectorAll<HTMLAnchorElement>('a.publisher-nav-link')
    expect(Array.from(links).map(a => a.textContent)).toEqual([
      'Profile',
      'Datasets',
      'Tours',
      'Import',
    ])
  })

  it('marks the link that matches the current path as active', () => {
    window.history.replaceState(null, '', '/publish/datasets')
    renderTopbar(host, router)
    const active = host.querySelector<HTMLAnchorElement>('.publisher-nav-link-active')
    expect(active?.textContent).toBe('Datasets')
    expect(active?.getAttribute('aria-current')).toBe('page')
  })

  it('keeps the parent tab active on sub-paths (e.g., /publish/datasets/abc)', () => {
    window.history.replaceState(null, '', '/publish/datasets/some-id')
    renderTopbar(host, router)
    const active = host.querySelector<HTMLAnchorElement>('.publisher-nav-link-active')
    expect(active?.textContent).toBe('Datasets')
  })

  it('does not mark any link active on an unknown path', () => {
    window.history.replaceState(null, '', '/publish/unknown')
    renderTopbar(host, router)
    expect(host.querySelector('.publisher-nav-link-active')).toBeNull()
  })

  it('intercepts plain left-clicks and calls router.navigate()', () => {
    renderTopbar(host, router)
    const datasets = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a.publisher-nav-link'),
    ).find(a => a.textContent === 'Datasets')!
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue()

    const event = clickWith(datasets)
    expect(event.defaultPrevented).toBe(true)
    expect(navSpy).toHaveBeenCalledWith('/publish/datasets')
  })

  it('lets cmd/ctrl-click fall through to the browser default', () => {
    renderTopbar(host, router)
    const datasets = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a.publisher-nav-link'),
    ).find(a => a.textContent === 'Datasets')!
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue()

    const event = clickWith(datasets, { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
    expect(navSpy).not.toHaveBeenCalled()

    const event2 = clickWith(datasets, { ctrlKey: true })
    expect(event2.defaultPrevented).toBe(false)
  })

  it('lets middle-click fall through', () => {
    renderTopbar(host, router)
    const datasets = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('a.publisher-nav-link'),
    ).find(a => a.textContent === 'Datasets')!
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue()

    const event = clickWith(datasets, { button: 1 })
    expect(event.defaultPrevented).toBe(false)
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('updates active state when the route-change event fires', () => {
    window.history.replaceState(null, '', '/publish/me')
    renderTopbar(host, router)
    expect(
      host.querySelector<HTMLAnchorElement>('.publisher-nav-link-active')?.textContent,
    ).toBe('Profile')

    window.dispatchEvent(
      new CustomEvent(ROUTE_CHANGE_EVENT, { detail: { path: '/publish/tours' } }),
    )
    expect(
      host.querySelector<HTMLAnchorElement>('.publisher-nav-link-active')?.textContent,
    ).toBe('Tours')
  })

  it('removes the prior listener and DOM on re-render', () => {
    renderTopbar(host, router)
    const first = host.querySelector('.publisher-topbar')!
    renderTopbar(host, router)
    const second = host.querySelector('.publisher-topbar')!
    expect(host.querySelectorAll('.publisher-topbar').length).toBe(1)
    expect(first).not.toBe(second)
  })

  it('mounts the back-to-Terraviz link with the correct aria-label and href', () => {
    renderTopbar(host, router)
    const back = host.querySelector<HTMLAnchorElement>('.publisher-topbar-back')
    expect(back?.getAttribute('aria-label')).toBe('Back to Terraviz')
    expect(back?.getAttribute('href')).toBe('/')
  })
})
