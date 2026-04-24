/**
 * Session lifecycle helper — builds the `session_start` event from
 * runtime signals, then registers a `pagehide` listener that emits
 * `session_end` with duration and event count.
 *
 * Kept separate from `emitter.ts` so the emitter stays focused on
 * queueing + transport and doesn't know about DOM / WebXR / locale.
 * Call `initSession()` once from `main.ts` after the app has
 * initialized.
 */

import { emit, getEventCount, getSessionDurationMs, TELEMETRY_SCHEMA_VERSION } from '.'
import {
  isImmersiveArSupported,
  isImmersiveVrSupported,
  isWebXRAvailable,
} from '../utils/vrCapability'
import type {
  Platform,
  SessionEndEvent,
  SessionStartEvent,
  ViewportClass,
  VrCapability,
} from '../types'

// __APP_VERSION__ is injected by Vite (vite.config.ts define block).
declare const __APP_VERSION__: string

let started = false
let sessionEnded = false
let pagehideAbort: AbortController | null = null

/**
 * Emit `session_start` and register the `session_end` unload hook.
 * Idempotent — a second call in the same session is a no-op so HMR
 * in dev doesn't duplicate session_start events.
 *
 * Safe to call before or after the transport is wired: session_start
 * enqueues either way, and session_end rides the beacon installed
 * by `setTransport()` as long as `initSession()` ran first
 * (listeners fire in registration order).
 */
export async function initSession(): Promise<void> {
  if (started) return
  started = true

  const vrCapable = await detectVrCapability()

  const event: SessionStartEvent = {
    event_type: 'session_start',
    app_version: appVersion(),
    platform: detectPlatform(),
    locale: detectLocale(),
    viewport_class: classifyViewport(),
    vr_capable: vrCapable,
    schema_version: TELEMETRY_SCHEMA_VERSION,
  }
  emit(event)

  if (typeof window !== 'undefined') {
    pagehideAbort = new AbortController()
    window.addEventListener(
      'pagehide',
      () => emitSessionEnd('pagehide'),
      { signal: pagehideAbort.signal },
    )
    // visibilitychange covers the iOS Safari case where `pagehide`
    // is missed on tab-switching; treated as a session_end too.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          emitSessionEnd('visibilitychange')
        }
      },
      { signal: pagehideAbort.signal },
    )
  }
}

/** Emit exactly one `session_end` per session. Repeat calls (pagehide
 * fires twice on iOS, or visibilitychange fires before pagehide) are
 * coalesced into the first one to avoid double-counting. */
export function emitSessionEnd(
  reason: SessionEndEvent['exit_reason'],
): void {
  if (sessionEnded) return
  sessionEnded = true
  const event: SessionEndEvent = {
    event_type: 'session_end',
    exit_reason: reason,
    duration_ms: getSessionDurationMs(),
    event_count: getEventCount(),
  }
  emit(event)
}

/** Test helper — clear "has a session started yet" guard and unwire
 * the pagehide listener. Not exported from the analytics barrel. */
export function __resetSessionForTests(): void {
  started = false
  sessionEnded = false
  pagehideAbort?.abort()
  pagehideAbort = null
}

// ---------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------

function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
      ? __APP_VERSION__
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

function detectPlatform(): Platform {
  const win = typeof window !== 'undefined'
    ? (window as unknown as { __TAURI__?: unknown })
    : null
  return win && !!win.__TAURI__ ? 'desktop' : 'web'
}

function detectLocale(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  return navigator.language || 'unknown'
}

/** Map the largest viewport dimension into a Tailwind-style bucket.
 * Tracks the larger side so a phone rotated to landscape still
 * reports as a phone. */
function classifyViewport(): ViewportClass {
  if (typeof window === 'undefined') return 'md'
  const w = window.innerWidth || 1024
  if (w < 480) return 'xs'
  if (w < 768) return 'sm'
  if (w < 1280) return 'md'
  if (w < 1920) return 'lg'
  return 'xl'
}

async function detectVrCapability(): Promise<VrCapability> {
  if (!isWebXRAvailable()) return 'none'
  const [vr, ar] = await Promise.all([
    isImmersiveVrSupported(),
    isImmersiveArSupported(),
  ])
  if (vr && ar) return 'both'
  if (vr) return 'vr'
  if (ar) return 'ar'
  return 'none'
}
