/**
 * User-toggleable opt-in flags for not-yet-default-on features.
 *
 * Mirrors the load/save shape of `src/analytics/config.ts` so the two
 * preference surfaces feel consistent in Tools → Privacy. Stored in
 * localStorage under `sos-experimental-flags` as a JSON object; every
 * field defaults to false on a missing key, malformed JSON, or
 * unavailable storage.
 *
 * The compile-time {@link ExperimentalFlags} interface in
 * `src/types/index.ts` is the single source of truth for which flags
 * exist; this module is the runtime read/write path.
 */

import type { ExperimentalFlags } from '../types'

const STORAGE_KEY = 'sos-experimental-flags'

const DEFAULT_FLAGS: ExperimentalFlags = {
  vrPhoneArEnabled: false,
}

/** Read the persisted flags, falling back to defaults on missing,
 *  invalid JSON, or any storage error. */
export function loadExperimentalFlags(): ExperimentalFlags {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_FLAGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FLAGS }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FLAGS }
    return {
      vrPhoneArEnabled: parsed.vrPhoneArEnabled === true,
    }
  } catch {
    return { ...DEFAULT_FLAGS }
  }
}

/** Persist a partial update. Silently no-ops on storage failure so a
 *  full localStorage quota or a privacy-locked profile never breaks
 *  the app. */
export function saveExperimentalFlags(partial: Partial<ExperimentalFlags>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const next: ExperimentalFlags = { ...loadExperimentalFlags(), ...partial }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Swallow — storage failures must not break the app
  }
}

/** Convenience read for a single flag. */
export function getExperimentalFlag<K extends keyof ExperimentalFlags>(
  key: K,
): ExperimentalFlags[K] {
  return loadExperimentalFlags()[key]
}

/** Convenience write for a single flag. */
export function setExperimentalFlag<K extends keyof ExperimentalFlags>(
  key: K,
  value: ExperimentalFlags[K],
): void {
  saveExperimentalFlags({ [key]: value } as Partial<ExperimentalFlags>)
}
