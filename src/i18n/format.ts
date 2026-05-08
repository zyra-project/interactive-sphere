/**
 * Locale-aware formatting helpers.
 *
 * Wrap the platform `Intl.*` constructors so display code reads from
 * the active locale (via {@link getLocale}) without each call site
 * threading the locale through. Replaces hardcoded `'en-US'` calls
 * elsewhere — see `src/utils/time.ts:formatDate()` for the previous
 * pattern.
 *
 * Formatter instances are cached per (locale, opts) tuple. The
 * native constructors do non-trivial work (locale data lookups,
 * options normalization) and these helpers run on hot paths
 * (browse-card render iterates the dataset list, each card calls
 * formatDate twice). A single page session sees a small number of
 * distinct opts shapes, so the cache stays bounded in practice.
 */

import { getLocale } from './index'

/** Cache key for formatter memoization — locale + a stable opts
 *  signature. JSON.stringify is good enough since options objects
 *  contain only primitives and the SAME caller hands in the same
 *  shape each time. */
function cacheKey(locale: string, opts: object | undefined): string {
  return opts ? `${locale}|${JSON.stringify(opts)}` : locale
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

/** Format a `Date` (or ISO string) with the active locale. */
export function formatDate(
  value: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  const locale = getLocale()
  const key = cacheKey(locale, opts)
  let fmt = dateFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, opts)
    dateFormatters.set(key, fmt)
  }
  return fmt.format(date)
}

/** Format a number with the active locale (default: locale-default). */
export function formatNumber(
  value: number,
  opts?: Intl.NumberFormatOptions,
): string {
  const locale = getLocale()
  const key = cacheKey(locale, opts)
  let fmt = numberFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, opts)
    numberFormatters.set(key, fmt)
  }
  return fmt.format(value)
}

/**
 * Relative-time format ("3 days ago" / "hace 3 días").
 *
 * Picks the largest sensible unit (day / hour / minute / second) so
 * callers don't have to do unit math themselves.
 */
export function formatRelative(target: Date, baseline: Date = new Date()): string {
  const diffMs = target.getTime() - baseline.getTime()
  const locale = getLocale()
  const opts: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }
  const key = cacheKey(locale, opts)
  let fmt = relativeFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, opts)
    relativeFormatters.set(key, fmt)
  }
  const abs = Math.abs(diffMs)
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  if (abs >= DAY) return fmt.format(Math.round(diffMs / DAY), 'day')
  if (abs >= HOUR) return fmt.format(Math.round(diffMs / HOUR), 'hour')
  if (abs >= MINUTE) return fmt.format(Math.round(diffMs / MINUTE), 'minute')
  return fmt.format(Math.round(diffMs / SECOND), 'second')
}

/** Test-only: drop all cached formatters. Locale changes already
 *  trigger reload in production, so the cache keys never collide
 *  in normal flow; tests that switch locales mid-run need an
 *  explicit reset. */
export function __resetFormatterCacheForTests(): void {
  dateFormatters.clear()
  numberFormatters.clear()
  relativeFormatters.clear()
}
