import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publisherGet,
  handleSessionError,
  clearWarmupFlag,
  warmupAlreadyAttempted,
  buildSignInUrl,
} from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function opaqueRedirect(): Response {
  return Object.assign(new Response('', { status: 200 }), {
    type: 'opaqueredirect' as const,
    status: 0,
  })
}

describe('publisherGet', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns ok+data on a 200 JSON response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ value: 42 }))
    const result = await publisherGet<{ value: number }>('/api/v1/publish/me', { fetchFn })
    expect(result).toEqual({ ok: true, data: { value: 42 } })
  })

  it('passes redirect: manual and credentials: same-origin', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}))
    await publisherGet('/api/v1/publish/me', { fetchFn })
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/publish/me',
      expect.objectContaining({
        redirect: 'manual',
        credentials: 'same-origin',
      }),
    )
  })

  it('returns network on a thrown fetch', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await publisherGet('/api/v1/publish/me', { fetchFn })
    expect(result).toEqual({ ok: false, kind: 'network' })
  })

  it('returns session on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    const result = await publisherGet('/api/v1/publish/me', { fetchFn })
    expect(result).toEqual({ ok: false, kind: 'session' })
  })

  it('returns server on 5xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    const result = await publisherGet('/api/v1/publish/me', { fetchFn })
    expect(result).toEqual({ ok: false, kind: 'server' })
  })

  it('returns server when JSON parse fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await publisherGet('/api/v1/publish/me', { fetchFn })
    expect(result).toEqual({ ok: false, kind: 'server' })
  })

  it('retries once on opaqueredirect and returns ok when the retry succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(opaqueRedirect())
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await publisherGet<{ value: number }>('/api/v1/publish/me', {
      fetchFn,
      sleep,
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true, data: { value: 1 } })
  })

  it('returns session when both attempts are opaqueredirect', async () => {
    const fetchFn = vi.fn().mockResolvedValue(opaqueRedirect())
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await publisherGet('/api/v1/publish/me', { fetchFn, sleep })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: false, kind: 'session' })
  })

  it('returns network when the retry throws', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(opaqueRedirect())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await publisherGet('/api/v1/publish/me', { fetchFn, sleep })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: false, kind: 'network' })
  })
})

describe('handleSessionError', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it("returns 'navigating' and marks the warmup flag on a fresh call", () => {
    const navigate = vi.fn()
    const action = handleSessionError({ navigate })
    expect(action).toBe('navigating')
    expect(warmupAlreadyAttempted()).toBe(true)
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/publish\/redirect-back\?to=/),
    )
  })

  it("returns 'show-error' and clears the flag when warmup already attempted", () => {
    sessionStorage.setItem('publisher_warmup_attempted', '1')
    const navigate = vi.fn()
    const action = handleSessionError({ navigate })
    expect(action).toBe('show-error')
    expect(warmupAlreadyAttempted()).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('buildSignInUrl', () => {
  it('encodes the current pathname + search into the to= parameter', () => {
    // jsdom defaults to / for window.location; we set a more
    // interesting path to verify encoding behaviour.
    window.history.replaceState(null, '', '/publish/datasets/abc-123')
    const url = buildSignInUrl()
    expect(url).toBe(
      `/api/v1/publish/redirect-back?to=${encodeURIComponent('/publish/datasets/abc-123')}`,
    )
    // restore for other tests
    window.history.replaceState(null, '', '/')
  })
})

describe('clearWarmupFlag', () => {
  it('is a no-op when no flag is set', () => {
    sessionStorage.clear()
    expect(() => clearWarmupFlag()).not.toThrow()
    expect(warmupAlreadyAttempted()).toBe(false)
  })

  it('clears an existing flag', () => {
    sessionStorage.setItem('publisher_warmup_attempted', '1')
    clearWarmupFlag()
    expect(warmupAlreadyAttempted()).toBe(false)
  })
})
