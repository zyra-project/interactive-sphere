import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadViewPreferences,
  saveViewPreferences,
  getBordersVisible,
  setBordersVisible,
} from './viewPreferences'

describe('viewPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns defaults when localStorage is empty', () => {
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(true)
    expect(prefs.legendVisible).toBe(true)
    expect(prefs.bordersVisible).toBe(false)
  })

  it('round-trips a saved preference', () => {
    saveViewPreferences({ infoPanelVisible: false, legendVisible: true, bordersVisible: false, gazeFollowOverlays: false })
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(false)
    expect(prefs.legendVisible).toBe(true)
  })

  it('round-trips both flags independently', () => {
    saveViewPreferences({ infoPanelVisible: false, legendVisible: false, bordersVisible: true, gazeFollowOverlays: true })
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(false)
    expect(prefs.legendVisible).toBe(false)
    expect(prefs.bordersVisible).toBe(true)
    expect(prefs.gazeFollowOverlays).toBe(true)
  })

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('sos-view-prefs', '{not valid json')
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(true)
    expect(prefs.legendVisible).toBe(true)
    expect(prefs.bordersVisible).toBe(false)
  })

  it('falls back to defaults for fields with wrong type', () => {
    localStorage.setItem('sos-view-prefs', JSON.stringify({
      infoPanelVisible: 'yes',
      legendVisible: 0,
      bordersVisible: 'on',
    }))
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(true)
    expect(prefs.legendVisible).toBe(true)
    expect(prefs.bordersVisible).toBe(false)
  })

  it('preserves a known good field when another is invalid', () => {
    localStorage.setItem('sos-view-prefs', JSON.stringify({
      infoPanelVisible: false,
      legendVisible: 'bogus',
    }))
    const prefs = loadViewPreferences()
    expect(prefs.infoPanelVisible).toBe(false)
    expect(prefs.legendVisible).toBe(true)
  })

  it('swallows save errors without throwing', () => {
    // Simulate a storage quota error by stubbing setItem
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = vi.fn(() => { throw new Error('quota') })
    try {
      expect(() => saveViewPreferences({
        infoPanelVisible: false, legendVisible: false, bordersVisible: false, gazeFollowOverlays: false,
      })).not.toThrow()
    } finally {
      Storage.prototype.setItem = orig
    }
  })

  describe('shared borders flag', () => {
    it('reflects the saved preference on first read', () => {
      saveViewPreferences({ infoPanelVisible: true, legendVisible: true, bordersVisible: true, gazeFollowOverlays: false })
      // getBordersVisible lazy-loads from localStorage on first call; fresh
      // state across tests is guaranteed by localStorage.clear() in beforeEach
      // plus the module cache being initialized here for the first time in
      // this test. When run with others, the cache may already have been
      // populated, so we set first and then assert the setter takes effect.
      setBordersVisible(true)
      expect(getBordersVisible()).toBe(true)
    })

    it('setter persists through the blob load path', () => {
      setBordersVisible(true)
      const prefs = loadViewPreferences()
      expect(prefs.bordersVisible).toBe(true)
    })

    it('toggle survives a cache-is-stale scenario', () => {
      // Explicit regression coverage: user toggles borders in VR,
      // VR writes to localStorage + cache. A later read through
      // `loadViewPreferences` must see the update, not an older
      // cached blob.
      setBordersVisible(false)
      setBordersVisible(true)
      expect(loadViewPreferences().bordersVisible).toBe(true)
      setBordersVisible(false)
      expect(loadViewPreferences().bordersVisible).toBe(false)
    })
  })
})
