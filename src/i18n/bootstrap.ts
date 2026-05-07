/**
 * Shared i18n bootstrap for entry points (`main.ts`, `orbitMain.ts`,
 * future entries). Synchronously initializes the runtime in English,
 * detects the user's preferred locale, lazy-loads its message chunk
 * if needed, then walks `data-i18n*` attributes on the live document.
 *
 * Wave 0 ships this helper but no `data-i18n*` attributes yet — the
 * walk is a no-op until Wave 1 starts annotating `index.html`.
 */

import { applyI18nAttributes } from './applyI18nAttributes'
import { detectLocale } from './detect'
import {
  initI18n,
  setLocale,
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from './index'

export async function bootstrapI18n(): Promise<Locale> {
  initI18n(SOURCE_LOCALE)
  const detected = detectLocale({
    supported: SUPPORTED_LOCALES,
    fallback: SOURCE_LOCALE,
  }) as Locale
  if (detected !== SOURCE_LOCALE) {
    await setLocale(detected)
  }
  applyI18nAttributes(document)
  return detected
}
