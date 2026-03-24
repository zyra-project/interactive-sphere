/**
 * Simple log-level gating so production builds stay silent.
 *
 * Levels (lowest → highest): debug, info, warn, error, silent.
 * Default level is 'debug' in development and 'warn' in production.
 * Override at runtime:  (window as any).__LOG_LEVEL__ = 'debug'
 */

declare const __BUNDLED_DEV__: boolean

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

function detectDevMode(): boolean {
  try {
    // __BUNDLED_DEV__ is defined by Vite at build time
    if (typeof __BUNDLED_DEV__ !== 'undefined') return __BUNDLED_DEV__
  } catch { /* not defined */ }
  try {
    return !!(import.meta as any).env?.DEV
  } catch { /* not available */ }
  return false
}

const DEFAULT_LEVEL: LogLevel = detectDevMode() ? 'debug' : 'warn'

function currentLevel(): LogLevel {
  if (typeof window !== 'undefined' && (window as any).__LOG_LEVEL__) {
    return (window as any).__LOG_LEVEL__ as LogLevel
  }
  return DEFAULT_LEVEL
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()]
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog('debug')) console.log(...args)
  },
  info(...args: unknown[]): void {
    if (shouldLog('info')) console.log(...args)
  },
  warn(...args: unknown[]): void {
    if (shouldLog('warn')) console.warn(...args)
  },
  error(...args: unknown[]): void {
    if (shouldLog('error')) console.error(...args)
  },
}
