import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadExperimentalFlags,
  saveExperimentalFlags,
  getExperimentalFlag,
  setExperimentalFlag,
} from './experimentalFlags'

const STORAGE_KEY = 'sos-experimental-flags'

describe('experimentalFlags', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  describe('loadExperimentalFlags', () => {
    it('returns defaults when nothing is stored', () => {
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: false })
    })

    it('returns defaults when stored value is malformed JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json')
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: false })
    })

    it('returns defaults when stored value is not an object', () => {
      localStorage.setItem(STORAGE_KEY, '"a string"')
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: false })
    })

    it('returns the persisted flag when set', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ vrPhoneArEnabled: true }))
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: true })
    })

    it('coerces non-boolean values to false (strict-true gate)', () => {
      // Defensive parse — a corrupted blob (e.g. someone hand-edits to
      // `"vrPhoneArEnabled": "yes"`) shouldn't accidentally unlock
      // a default-off feature. Only a literal `true` flips the bit.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ vrPhoneArEnabled: 'yes' }),
      )
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: false })
    })
  })

  describe('saveExperimentalFlags', () => {
    it('persists a partial update without disturbing other fields', () => {
      saveExperimentalFlags({ vrPhoneArEnabled: true })
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: true })
      saveExperimentalFlags({})
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: true })
    })

    it('round-trips a flip from true back to false', () => {
      saveExperimentalFlags({ vrPhoneArEnabled: true })
      saveExperimentalFlags({ vrPhoneArEnabled: false })
      expect(loadExperimentalFlags()).toEqual({ vrPhoneArEnabled: false })
    })
  })

  describe('getExperimentalFlag / setExperimentalFlag', () => {
    it('reads and writes a single flag', () => {
      expect(getExperimentalFlag('vrPhoneArEnabled')).toBe(false)
      setExperimentalFlag('vrPhoneArEnabled', true)
      expect(getExperimentalFlag('vrPhoneArEnabled')).toBe(true)
    })
  })
})
