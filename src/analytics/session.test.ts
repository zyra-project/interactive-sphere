import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initSession, emitSessionEnd, __resetSessionForTests } from './session'
import { resetForTests, __peek, emit } from './emitter'
import { setTier } from './config'
import type { LayerLoadedEvent } from '../types'

function layerLoaded(id = 'A'): LayerLoadedEvent {
  return {
    event_type: 'layer_loaded',
    layer_id: id,
    layer_source: 'network',
    slot_index: '0',
    trigger: 'browse',
    load_ms: 50,
  }
}

beforeEach(() => {
  localStorage.clear()
  resetForTests()
  __resetSessionForTests()
  setTier('essential')
})

afterEach(() => {
  __resetSessionForTests()
})

describe('session — initSession', () => {
  it('emits exactly one session_start with the expected fields', async () => {
    await initSession()
    const evs = __peek()
    const starts = evs.filter((e) => e.event_type === 'session_start')
    expect(starts).toHaveLength(1)
    const s = starts[0]
    if (s.event_type !== 'session_start') throw new Error('unreachable')
    expect(s.platform === 'web' || s.platform === 'desktop').toBe(true)
    expect(s.locale.length).toBeGreaterThan(0)
    expect(s.viewport_class).toMatch(/xs|sm|md|lg|xl/)
    expect(s.vr_capable).toMatch(/none|vr|ar|both/)
    expect(s.schema_version.length).toBeGreaterThan(0)
  })

  it('is idempotent — a second call does not emit a second session_start', async () => {
    await initSession()
    await initSession()
    const evs = __peek()
    const starts = evs.filter((e) => e.event_type === 'session_start')
    expect(starts).toHaveLength(1)
  })
})

describe('session — emitSessionEnd', () => {
  it('emits one session_end with a non-negative duration and the emitted-event count', async () => {
    await initSession()
    // Emit a couple of events so event_count > 0.
    emit(layerLoaded('A'))
    emit(layerLoaded('B'))
    emitSessionEnd('pagehide')

    const evs = __peek()
    const ends = evs.filter((e) => e.event_type === 'session_end')
    expect(ends).toHaveLength(1)
    const e = ends[0]
    if (e.event_type !== 'session_end') throw new Error('unreachable')
    expect(e.exit_reason).toBe('pagehide')
    expect(e.duration_ms).toBeGreaterThanOrEqual(0)
    // session_start counts as an event too.
    expect(e.event_count).toBeGreaterThanOrEqual(3)
  })

  it('is idempotent — pagehide fired twice yields one session_end', async () => {
    await initSession()
    emitSessionEnd('pagehide')
    emitSessionEnd('pagehide')
    const evs = __peek()
    const ends = evs.filter((e) => e.event_type === 'session_end')
    expect(ends).toHaveLength(1)
  })

  it('pagehide on window triggers session_end exactly once', async () => {
    await initSession()
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))
    const evs = __peek()
    const ends = evs.filter((e) => e.event_type === 'session_end')
    expect(ends).toHaveLength(1)
  })
})
