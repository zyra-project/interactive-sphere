/**
 * Shared types for the Orbit character.
 *
 * These are the external-facing names. Future phases extend `StateKey`
 * and `GestureKind` as the STATES and GESTURES tables land.
 */

export type PaletteKey = 'cyan' | 'green' | 'amber' | 'violet'

export type ScaleKey = 'close' | 'continental' | 'planetary'

// Phase 1 ships Idle only. Phase 3 extends to the full 14-state
// vocabulary from ORBIT_CHARACTER_DESIGN.md §State and gesture catalog.
export type StateKey = 'IDLE'

export type GestureKind = never // populated in Phase 4

export interface Palette {
  base: string
  accent: string
  glow: string
}

export const PALETTES: Record<PaletteKey, Palette> = {
  cyan:   { base: '#faf5e8', accent: '#5cefd7', glow: '#a8f5e5' },
  green:  { base: '#faf5e8', accent: '#7eef5c', glow: '#b5f5a0' },
  amber:  { base: '#fff5e0', accent: '#efb75c', glow: '#f5d8a0' },
  violet: { base: '#f5f0fa', accent: '#b87cef', glow: '#d4b0f5' },
}
