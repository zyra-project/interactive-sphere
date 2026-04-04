/**
 * Device capability detection for adaptive performance tuning.
 */

/** True on touch-capable devices with narrow viewports (≤768px). */
export function isMobile(): boolean {
  return (
    window.innerWidth <= 768 || navigator.maxTouchPoints > 0
  )
}

interface NetworkInformation {
  effectiveType?: string
}

/** True when the Network Information API reports 2g or slow-2g. */
export function isSlowNetwork(): boolean {
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
  return conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g'
}
