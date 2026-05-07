/**
 * i18n runtime — `t()`, `plural()`, locale state, and bootstrap.
 *
 * The English message set is a static import (the universal fallback
 * must be available synchronously). Other locales lazy-load via
 * `localeLoaders` keyed off the BCP-47 tag — each loader uses
 * dynamic `import()` so Vite splits the locale into its own chunk
 * (~15 KB gzipped per locale at full migration).
 *
 * See `docs/I18N_PLAN.md` for the architecture and migration order.
 */

import {
  enMessages,
  localeLoaders,
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  type MessageKey,
} from './messages'
import { directionFor } from './rtl'

export {
  enMessages,
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  NATIVE_NAMES,
} from './messages'
export type { Locale, MessageKey } from './messages'

let activeLocale: Locale = SOURCE_LOCALE
let activeMessages: Readonly<Record<string, string>> = enMessages

/**
 * Initialize the runtime. Synchronous — must be called before any
 * `t()` invocation. The bootstrap path in `src/main.ts` calls this
 * with English first, then optionally `await setLocale(detected)`
 * for non-English locales.
 */
export function initI18n(locale: Locale = SOURCE_LOCALE): void {
  activeLocale = locale
  activeMessages = enMessages
  applyHtmlAttributes()
}

/**
 * Switch the active locale. Loads the locale's message chunk if
 * needed (no-op for English, which is bundled inline). Idempotent
 * for the currently-active locale.
 *
 * Callers that switch in response to a user action (Tools menu
 * picker) typically follow this with `location.reload()` so all
 * already-rendered UI re-paints in the new locale; that's the
 * sanctioned UX, since the vanilla-TS architecture has no per-
 * module re-render hook.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (locale === activeLocale) return
  const loader = localeLoaders[locale]
  if (!loader) {
    throw new Error(`[i18n] Unsupported locale: ${locale}`)
  }
  const messages = await loader()
  activeLocale = locale
  activeMessages = messages
  applyHtmlAttributes()
}

/** The locale tag currently driving `t()`. */
export function getLocale(): Locale {
  return activeLocale
}

/**
 * Translate a message key. Resolution order:
 *   1. Active locale
 *   2. English (universal fallback)
 *   3. The key itself (so missing translations surface visibly)
 *
 * The generic constraint narrows to `MessageKey` once `en.json`
 * has entries; while `en.json` is empty, `MessageKey` widens to
 * `string` so callers and tests aren't blocked.
 */
export function t<K extends MessageKey>(
  key: K,
  params?: Readonly<Record<string, string | number>>,
): string {
  const k = key as unknown as string
  const raw = activeMessages[k] ?? enMessages[k as keyof typeof enMessages] ?? k
  const rawStr = typeof raw === 'string' ? raw : k
  return params ? interpolate(rawStr, params) : rawStr
}

/**
 * CLDR plural-aware lookup. Picks among supplied form keys by
 * passing `count` through `Intl.PluralRules` for the active locale
 * and resolves the chosen key via `t()`. The selected key receives
 * `{count}` in `params` automatically; pass extra interpolation
 * values via the third argument.
 *
 *   plural(n,
 *     { one: 'browse.count.one', other: 'browse.count.other' },
 *     { count: n },
 *   )
 */
export function plural(
  count: number,
  forms: PluralForms,
  params?: Readonly<Record<string, string | number>>,
): string {
  const cat = new Intl.PluralRules(activeLocale).select(count)
  const key = forms[cat] ?? forms.other
  return t(key as MessageKey, { count, ...(params ?? {}) })
}

export interface PluralForms {
  zero?: MessageKey
  one?: MessageKey
  two?: MessageKey
  few?: MessageKey
  many?: MessageKey
  other: MessageKey
}

/**
 * Substitute `{name}` placeholders. Unresolved placeholders are
 * left in place so they're visible in the UI rather than silently
 * dropped — surfaces missing translation parameters during dev.
 */
export function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name]
    return v === undefined ? match : String(v)
  })
}

/**
 * Test-only: reset runtime state to defaults. Not exported from the
 * package surface — tests import this directly.
 */
export function __resetI18nForTests(): void {
  activeLocale = SOURCE_LOCALE
  activeMessages = enMessages
}

/**
 * Test-only: install a synthetic message bundle for the active
 * locale so unit tests can exercise the resolution chain without
 * round-tripping through `setLocale()`.
 */
export function __installMessagesForTests(
  locale: Locale,
  messages: Readonly<Record<string, string>>,
): void {
  activeLocale = locale
  activeMessages = messages
}

function applyHtmlAttributes(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = activeLocale
  document.documentElement.dir = directionFor(activeLocale)
}
