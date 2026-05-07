/**
 * Initial-locale detection.
 *
 * Resolution order:
 *   1. Stored override from `loadLocalePref()` (user picked one)
 *   2. `?lang=` query param (lets us share localized links + aids QA)
 *   3. `navigator.languages[]` walked through the BCP-47 ladder
 *      (`pt-BR` → `pt` → fallback). Stops at the first supported tag.
 *   4. Default: the source locale (typically `'en'`).
 */

import { loadLocalePref } from './persistence'

export interface DetectOptions {
  supported: readonly string[]
  fallback: string
  /** Override `navigator.languages` for tests. */
  navigatorLanguages?: readonly string[]
  /** Override `?lang=…` parsing for tests. */
  queryLang?: string | null
}

/** Walk the BCP-47 ladder for one tag against the supported set. */
export function pickFallback(
  tag: string,
  supported: readonly string[],
): string | undefined {
  if (!tag) return undefined
  const segments = tag.split('-')
  // Try progressively shorter tags: "zh-Hant-TW" → "zh-Hant" → "zh".
  for (let i = segments.length; i > 0; i--) {
    const candidate = segments.slice(0, i).join('-')
    if (supported.includes(candidate)) return candidate
    // Also try the lowercase base ("EN" → "en") to be defensive about
    // navigator/browser inconsistencies. We don't lowercase the whole
    // tag because BCP-47 region subtags are conventionally uppercase
    // and "en-US" is a different supported entry than "en-us".
    const lower = candidate.toLowerCase()
    if (lower !== candidate && supported.includes(lower)) return lower
  }
  return undefined
}

/** Resolve the initial locale given the user's environment. */
export function detectLocale(opts: DetectOptions): string {
  const { supported, fallback } = opts

  // 1. Stored preference wins.
  const stored = safeLoadStored(supported)
  if (stored) return stored

  // 2. Query param ?lang=xx-YY.
  const queryLang = opts.queryLang ?? readQueryLang()
  if (queryLang) {
    const matched = pickFallback(queryLang, supported)
    if (matched) return matched
  }

  // 3. Walk navigator.languages.
  const navLangs = opts.navigatorLanguages ?? readNavigatorLanguages()
  for (const tag of navLangs) {
    const matched = pickFallback(tag, supported)
    if (matched) return matched
  }

  // 4. Final fallback.
  return fallback
}

function safeLoadStored(supported: readonly string[]): string | undefined {
  try {
    return loadLocalePref(supported)
  } catch {
    // SSR / non-browser test contexts may not have localStorage.
    return undefined
  }
}

function readQueryLang(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('lang')
  } catch {
    return null
  }
}

function readNavigatorLanguages(): readonly string[] {
  try {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return navigator.languages
    }
    if (typeof navigator.language === 'string') {
      return [navigator.language]
    }
  } catch {
    // No navigator (SSR / scripts).
  }
  return []
}
