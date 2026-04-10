/**
 * General Feedback Service — posts app-level feedback (bug reports,
 * feature requests, other) to /api/general-feedback.
 *
 * Distinct from the AI response feedback flow in chatUI.ts; this one
 * is driven by the help panel's feedback form.
 */

import type { GeneralFeedbackPayload } from '../types'
import { logger } from '../utils/logger'

// On Tauri, use the HTTP plugin's fetch to bypass webview CORS restrictions.
const IS_TAURI = !!(window as any).__TAURI__
const tauriFetchReady: Promise<typeof globalThis.fetch | null> | null = IS_TAURI
  ? import('@tauri-apps/plugin-http').then(m => m.fetch as typeof globalThis.fetch).catch(() => null)
  : null

async function corsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (tauriFetchReady) {
    const f = await tauriFetchReady
    if (f) return f(input, init)
  }
  return fetch(input, init)
}

export interface SubmitResult {
  ok: boolean
  status: number
  error?: string
}

/**
 * POST a general feedback payload to the server. Returns a SubmitResult
 * describing success/failure — callers should surface the error message
 * in the UI rather than throwing.
 */
export async function submitGeneralFeedback(payload: GeneralFeedbackPayload): Promise<SubmitResult> {
  try {
    const res = await corsFetch('/api/general-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      return { ok: true, status: res.status }
    }
    let error = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) error = body.error
    } catch {
      // non-JSON error body
    }
    return { ok: false, status: res.status, error }
  } catch (err) {
    logger.warn('[generalFeedback] network error', err)
    return { ok: false, status: 0, error: 'Network error — please try again' }
  }
}
