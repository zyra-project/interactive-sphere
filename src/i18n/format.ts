/**
 * Locale-aware formatting helpers.
 *
 * Wrap the platform `Intl.*` constructors so display code reads from
 * the active locale (via {@link getLocale}) without each call site
 * threading the locale through. Replaces hardcoded `'en-US'` calls
 * elsewhere — see `src/utils/time.ts:formatDate()` for the previous
 * pattern.
 */

import { getLocale } from './index'

/** Format a `Date` (or ISO string) with the active locale. */
export function formatDate(
  value: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(getLocale(), opts).format(date)
}

/** Format a number with the active locale (default: locale-default). */
export function formatNumber(
  value: number,
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getLocale(), opts).format(value)
}

/**
 * Relative-time format ("3 days ago" / "hace 3 días").
 *
 * Picks the largest sensible unit (day / hour / minute / second) so
 * callers don't have to do unit math themselves.
 */
export function formatRelative(target: Date, baseline: Date = new Date()): string {
  const diffMs = target.getTime() - baseline.getTime()
  const fmt = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
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
