import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PublisherRouter, matchRoute, type RouteHandler } from './router'

describe('matchRoute', () => {
  it('matches an exact pattern', () => {
    expect(matchRoute('/publish/me', '/publish/me')).toEqual({})
  })

  it('returns null when segment counts differ', () => {
    expect(matchRoute('/publish/me', '/publish/me/extra')).toBeNull()
    expect(matchRoute('/publish/datasets/:id', '/publish/datasets')).toBeNull()
  })

  it('captures :id into params', () => {
    expect(matchRoute('/publish/datasets/:id', '/publish/datasets/abc123')).toEqual({
      id: 'abc123',
    })
  })

  it('decodes URI-encoded id segments', () => {
    expect(
      matchRoute('/publish/datasets/:id', '/publish/datasets/sst%2Fanomaly'),
    ).toEqual({ id: 'sst/anomaly' })
  })

  it('matches :id followed by a literal segment', () => {
    expect(
      matchRoute('/publish/datasets/:id/edit', '/publish/datasets/01ABC/edit'),
    ).toEqual({ id: '01ABC' })
    expect(
      matchRoute('/publish/datasets/:id/edit', '/publish/datasets/01ABC'),
    ).toBeNull()
    expect(
      matchRoute('/publish/datasets/:id/edit', '/publish/datasets/01ABC/publish'),
    ).toBeNull()
  })

  it('treats trailing slashes as equivalent', () => {
    expect(matchRoute('/publish/me/', '/publish/me')).toEqual({})
    expect(matchRoute('/publish/me', '/publish/me/')).toEqual({})
  })

  it('does not match a different prefix', () => {
    expect(matchRoute('/publish/me', '/api/v1/publish/me')).toBeNull()
  })
})

describe('PublisherRouter', () => {
  const originalPath = window.location.pathname
  let mePage: ReturnType<typeof vi.fn<RouteHandler>>
  let datasetsPage: ReturnType<typeof vi.fn<RouteHandler>>
  let detailPage: ReturnType<typeof vi.fn<RouteHandler>>
  let notFound: ReturnType<typeof vi.fn<RouteHandler>>
  let router: PublisherRouter

  beforeEach(() => {
    mePage = vi.fn<RouteHandler>()
    datasetsPage = vi.fn<RouteHandler>()
    detailPage = vi.fn<RouteHandler>()
    notFound = vi.fn<RouteHandler>()
    router = new PublisherRouter(
      [
        { pattern: '/publish/me', handler: mePage },
        { pattern: '/publish/datasets', handler: datasetsPage },
        { pattern: '/publish/datasets/:id', handler: detailPage },
      ],
      notFound,
    )
  })

  afterEach(() => {
    router.stop()
    window.history.replaceState(null, '', originalPath)
  })

  it('dispatches the current path on start()', async () => {
    window.history.replaceState(null, '', '/publish/me')
    await router.start()
    expect(mePage).toHaveBeenCalledOnce()
    expect(mePage).toHaveBeenCalledWith({})
  })

  it('falls back to notFound when no route matches', async () => {
    window.history.replaceState(null, '', '/publish/unknown-route')
    await router.start()
    expect(notFound).toHaveBeenCalledOnce()
    expect(mePage).not.toHaveBeenCalled()
  })

  it('passes :id params to the matching handler', async () => {
    window.history.replaceState(null, '', '/publish/datasets/abc')
    await router.start()
    expect(detailPage).toHaveBeenCalledWith({ id: 'abc' })
  })

  it('navigate() pushes a new state and dispatches', async () => {
    window.history.replaceState(null, '', '/publish/me')
    await router.start()
    mePage.mockClear()

    await router.navigate('/publish/datasets')
    expect(window.location.pathname).toBe('/publish/datasets')
    expect(datasetsPage).toHaveBeenCalledOnce()
    expect(mePage).not.toHaveBeenCalled()
  })

  it('navigate() is a no-op when the path is unchanged', async () => {
    window.history.replaceState(null, '', '/publish/me')
    await router.start()
    mePage.mockClear()

    await router.navigate('/publish/me')
    expect(mePage).not.toHaveBeenCalled()
  })

  it('re-dispatches on popstate (back/forward)', async () => {
    window.history.replaceState(null, '', '/publish/me')
    await router.start()
    mePage.mockClear()

    await router.navigate('/publish/datasets')
    datasetsPage.mockClear()

    // Simulate browser back: rewind the URL then fire popstate.
    window.history.replaceState(null, '', '/publish/me')
    window.dispatchEvent(new PopStateEvent('popstate'))
    // popstate handler is sync but calls async dispatch; flush.
    await new Promise(r => setTimeout(r, 0))
    expect(mePage).toHaveBeenCalledOnce()
  })

  it('stop() removes the popstate listener', async () => {
    window.history.replaceState(null, '', '/publish/me')
    await router.start()
    mePage.mockClear()

    router.stop()
    window.dispatchEvent(new PopStateEvent('popstate'))
    await new Promise(r => setTimeout(r, 0))
    expect(mePage).not.toHaveBeenCalled()
  })
})
