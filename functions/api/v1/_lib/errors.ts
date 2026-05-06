/**
 * Typed errors used by the storage helpers (`r2-store.ts`,
 * `stream-store.ts`) so the route handlers can distinguish
 * "operator forgot to set credentials" from "the upstream service
 * failed" without regex-matching error messages.
 *
 * `ConfigurationError` → 503 with a `*_unconfigured` code; the
 * operator needs to fix the deploy.
 *
 * `UpstreamError` → 502 with a `*_upstream_error` code; the call
 * may succeed on retry. The optional `status` carries the upstream
 * HTTP status when known so handlers can map specific codes (e.g.
 * 404 → mark upload row failed with a stable reason).
 */

export class ConfigurationError extends Error {
  readonly kind = 'configuration' as const
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export class UpstreamError extends Error {
  readonly kind = 'upstream' as const
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export function isConfigurationError(err: unknown): err is ConfigurationError {
  return err instanceof Error && (err as { kind?: string }).kind === 'configuration'
}

export function isUpstreamError(err: unknown): err is UpstreamError {
  return err instanceof Error && (err as { kind?: string }).kind === 'upstream'
}
