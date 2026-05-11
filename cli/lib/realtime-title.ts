/**
 * Heuristic to detect "real-time" SOS rows by title — the rows
 * whose Vimeo source is re-uploaded on a recurring (typically
 * daily) cadence by NOAA's automation.
 *
 * Phase 3a commit E. Originally lived inside `cli/migrate-r2-hls.ts`
 * (3a/A) and was re-exported for `cli/list-realtime-r2.ts` (3a/B)
 * to consume. Extracted here so the read-only triage helper
 * doesn't transitively drag in ffmpeg-hls / r2-upload / vimeo-source
 * just to ask "is this title real-time?"
 *
 * The SOS catalog has no explicit `update_cadence` field — the
 * row title is the only reliable signal (e.g. `Sea Surface
 * Temperature - Real-time`, `Precipitation - Real-time`, etc.).
 * The pattern catches hyphenated, space-separated, and joined
 * variants case-insensitively because publisher-side editors
 * aren't strictly consistent.
 */

export const REALTIME_TITLE_PATTERN = /real[-\s]?time/i

export function isRealtimeTitle(title: string): boolean {
  return REALTIME_TITLE_PATTERN.test(title)
}
