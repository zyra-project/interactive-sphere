/**
 * Tests for the poster deep-link parsers.
 *
 * The DOM-touching parts of `applyPosterDeepLinks` (Tools-menu button
 * clicks, chat-panel opening) are covered by the consuming
 * integration tests in main.test.ts; here we just lock down the pure
 * resolution helpers so a slug rename or a layout-token change can't
 * silently slip through.
 */

import { describe, it, expect } from 'vitest'
import {
  parseInitialLayout,
  resolveLayout,
  resolveOrbitPrompt,
  resolveTourId,
} from './posterDeepLinks'
import type { Dataset } from '../types'

function fakeDataset(id: string, format: Dataset['format']): Dataset {
  return {
    id,
    title: '',
    format,
    dataLink: '',
  } as Dataset
}

const fakeCatalog: readonly Dataset[] = [
  fakeDataset('SAMPLE_TOUR', 'tour/json'),
  fakeDataset('SAMPLE_TOUR_CLIMATE_FUTURES', 'tour/json'),
  fakeDataset('INTERNAL_SOS_42', 'image/jpg'),
]

describe('resolveLayout', () => {
  it('passes canonical layout tokens through unchanged', () => {
    expect(resolveLayout('1')).toBe('1')
    expect(resolveLayout('2h')).toBe('2h')
    expect(resolveLayout('2v')).toBe('2v')
    expect(resolveLayout('4')).toBe('4')
  })

  it('expands the public "2" alias to "2h"', () => {
    // The poster ships ?layout=2 as the public form; the canonical
    // viewport vocabulary distinguishes 2h vs 2v.
    expect(resolveLayout('2')).toBe('2h')
  })

  it('returns null for null, empty, and unknown values', () => {
    expect(resolveLayout(null)).toBeNull()
    expect(resolveLayout('')).toBeNull()
    expect(resolveLayout('3')).toBeNull()
    expect(resolveLayout('grid')).toBeNull()
    expect(resolveLayout('1x1')).toBeNull()
  })
})

describe('parseInitialLayout', () => {
  it('prefers ?layout= when both ?layout= and ?setview= are present', () => {
    expect(parseInitialLayout('?layout=4&setview=1')).toBe('4')
  })

  it('falls back to ?setview= when ?layout= is absent', () => {
    expect(parseInitialLayout('?setview=2v')).toBe('2v')
  })

  it('defaults to single-view when neither param is set', () => {
    expect(parseInitialLayout('')).toBe('1')
    expect(parseInitialLayout('?dataset=foo')).toBe('1')
  })

  it('falls back to single-view for unknown values', () => {
    expect(parseInitialLayout('?layout=bogus')).toBe('1')
  })
})

describe('resolveTourId', () => {
  it('maps known slugs to their catalog dataset ids', () => {
    expect(resolveTourId('climate-futures', fakeCatalog)).toBe(
      'SAMPLE_TOUR_CLIMATE_FUTURES',
    )
    expect(resolveTourId('climate-connections', fakeCatalog)).toBe(
      'SAMPLE_TOUR',
    )
  })

  it('is case-insensitive on slug lookup', () => {
    expect(resolveTourId('Climate-Futures', fakeCatalog)).toBe(
      'SAMPLE_TOUR_CLIMATE_FUTURES',
    )
    expect(resolveTourId('CLIMATE-FUTURES', fakeCatalog)).toBe(
      'SAMPLE_TOUR_CLIMATE_FUTURES',
    )
  })

  it('accepts a direct catalog ID as the param value', () => {
    // Lets the poster (or anything else) pass ?tour=ID without
    // needing a slug entry in the alias map.
    expect(resolveTourId('SAMPLE_TOUR_CLIMATE_FUTURES', fakeCatalog)).toBe(
      'SAMPLE_TOUR_CLIMATE_FUTURES',
    )
    expect(resolveTourId('INTERNAL_SOS_42', fakeCatalog)).toBe(
      'INTERNAL_SOS_42',
    )
  })

  it('returns null when the slug or ID is not in the catalog', () => {
    expect(resolveTourId('not-a-real-tour', fakeCatalog)).toBeNull()
    expect(resolveTourId('INTERNAL_SOS_99999', fakeCatalog)).toBeNull()
  })

  it('returns null for empty / null inputs', () => {
    expect(resolveTourId(null, fakeCatalog)).toBeNull()
    expect(resolveTourId('', fakeCatalog)).toBeNull()
  })

  it("returns null when the slug's mapped target is missing from the catalog", () => {
    // The alias map can outlive a catalog rev — an alias pointing
    // at a deleted dataset should NOT resolve, so the deep-link
    // becomes a silent no-op rather than a broken load attempt.
    const empty: readonly Dataset[] = []
    expect(resolveTourId('climate-futures', empty)).toBeNull()
  })
})

describe('resolveOrbitPrompt', () => {
  it('returns the tour-recommendation seed for prompt=tour', () => {
    expect(resolveOrbitPrompt('tour')).toBe(
      'Can you recommend a tour for me?',
    )
  })

  it('returns undefined for unknown / null prompt names', () => {
    expect(resolveOrbitPrompt(null)).toBeUndefined()
    expect(resolveOrbitPrompt('')).toBeUndefined()
    expect(resolveOrbitPrompt('not-a-real-prompt')).toBeUndefined()
  })
})
