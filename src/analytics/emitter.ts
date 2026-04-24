/**
 * Telemetry emitter — batched event queue with tier-gated emission.
 *
 * Commit 1 lands the queue, the tier gate, and a console-mode flush.
 * There is no network transport yet — that lands in Commit 6. A
 * build with `VITE_TELEMETRY_ENABLED=false` compiles to a no-op
 * because the guards below inline to `false` and the minifier drops
 * the bodies.
 *
 * Call sites interact through the top-level `emit(event)` only.
 * `flush()`, `size()`, `resetForTests()` and `__peek()` exist for
 * tests and for the transport module that will wrap this in later
 * commits.
 */

import { TIER_B_EVENT_TYPES, type TelemetryEvent, type TelemetryTier } from '../types'
import {
  TELEMETRY_BUILD_ENABLED,
  TELEMETRY_CONSOLE_MODE,
  generateSessionId,
  loadConfig,
} from './config'

/** Flush triggers. These constants are test-visible so a test can
 * verify the cadence without hard-coding literals. */
export const BATCH_SIZE = 20
export const BATCH_INTERVAL_MS = 5_000

const TIER_B_SET: ReadonlySet<string> = new Set(TIER_B_EVENT_TYPES)

/** Pathnames where the emitter must stay silent regardless of tier.
 * The privacy policy page itself is a legal deliverable that must
 * emit zero events — fresh irony aside, a "we don't track you" page
 * that fires a session_start ping would be embarrassing. */
const SILENCED_PATHS: ReadonlySet<string> = new Set([
  '/privacy',
  '/privacy.html',
])

/** True when the current page is a no-emit surface. Reads
 * `location.pathname` defensively so non-DOM environments (early
 * Node, isolated unit tests) don't blow up. */
function isSilencedPath(): boolean {
  if (typeof location === 'undefined') return false
  return SILENCED_PATHS.has(location.pathname)
}

interface EmitterState {
  sessionId: string
  /** `performance.now()` captured at emitter construction. All
   * `client_offset_ms` values are computed relative to this. */
  sessionStartPerf: number
  queue: TelemetryEvent[]
  flushTimer: ReturnType<typeof setTimeout> | null
}

function createState(): EmitterState {
  return {
    sessionId: generateSessionId(),
    sessionStartPerf:
      typeof performance !== 'undefined' ? performance.now() : 0,
    queue: [],
    flushTimer: null,
  }
}

let state: EmitterState = createState()

/** Return the current in-memory session ID. Rotated at module load
 * and never persisted. Exposed for the Tools → Privacy UI display. */
export function getSessionId(): string {
  return state.sessionId
}

/** Queue an event for the next flush. Tier A events are queued when
 * the user is on Essential or Research; Tier B only on Research.
 * `tier === 'off'` drops everything. When the compile-time flag is
 * off, the whole body is dead code and tree-shakes out. */
export function emit(event: TelemetryEvent): void {
  if (!TELEMETRY_BUILD_ENABLED) return
  if (isSilencedPath()) return
  if (!tierGate(event.event_type)) return
  const stamped: TelemetryEvent = {
    ...event,
    client_offset_ms: currentOffset(),
  }
  state.queue.push(stamped)
  if (state.queue.length >= BATCH_SIZE) {
    flush()
  } else {
    scheduleFlush()
  }
}

/** True if events of the given type are allowed under the current
 * tier. Pure function of config + event type — no side effects. */
export function tierGate(eventType: TelemetryEvent['event_type']): boolean {
  const { tier } = loadConfig()
  if (tier === 'off') return false
  if (tier === 'essential') return !TIER_B_SET.has(eventType)
  return true
}

/** Drain the queue. In console mode, logs the batch. In network mode
 * (future commits), hands off to the transport. Returns the drained
 * events so tests and the transport can inspect what flushed. */
export function flush(): TelemetryEvent[] {
  if (!TELEMETRY_BUILD_ENABLED) return []
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }
  if (state.queue.length === 0) return []
  const drained = state.queue
  state.queue = []
  if (TELEMETRY_CONSOLE_MODE) {
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', { sessionId: state.sessionId, events: drained })
  }
  return drained
}

/** Current queue length. For tests and for a future dev inspector. */
export function size(): number {
  return state.queue.length
}

/** Test helper: reset emitter state. Regenerates the session ID and
 * clears the queue + timer. Not exported from the barrel. */
export function resetForTests(): void {
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer)
  }
  state = createState()
}

/** Test helper: peek without draining. */
export function __peek(): readonly TelemetryEvent[] {
  return state.queue
}

/** Apply the runtime consequences of a tier change to the in-memory
 * queue. `setTier()` in config.ts handles persistence; this handles
 * the buffer:
 *   - `off`  → drop every queued event (consent withdrawn)
 *   - `essential` → strip Tier B events that were queued while in
 *     research (stops research data from leaking after the user
 *     steps down a tier)
 *   - `research` → no-op (essential → research can only add new
 *     events; nothing queued needs removing)
 * Call sites should call this alongside `setTier` — the privacy UI
 * does. Keeping it a separate function keeps config.ts free of
 * emitter state references. */
export function applyTierChange(newTier: TelemetryTier): void {
  if (newTier === 'off') {
    state.queue = []
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer)
      state.flushTimer = null
    }
    return
  }
  if (newTier === 'essential') {
    state.queue = state.queue.filter((e) => !TIER_B_SET.has(e.event_type))
  }
}

function currentOffset(): number {
  if (typeof performance === 'undefined') return 0
  return Math.max(0, Math.round(performance.now() - state.sessionStartPerf))
}

function scheduleFlush(): void {
  if (state.flushTimer !== null) return
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null
    flush()
  }, BATCH_INTERVAL_MS)
}
