/**
 * Operator-side telemetry emitter for the migration CLI.
 *
 * Phase 2 commit E. The browser-based emitter in `src/analytics/`
 * runs in a session context (rotating session_id, batched dispatch,
 * pagehide flush). The migration CLI is a Node process that runs
 * once and exits — it has no session, no batching, no pagehide.
 *
 * This helper POSTs each `migration_video` event individually to
 * the same `/api/ingest` endpoint the SPA uses. The session_id
 * rotates per migration run; events from a single run share one
 * id so a Grafana operator can correlate "this migration's
 * progress" without joining across runs.
 *
 * Best-effort. Emit failures log a warning to stderr but never
 * abort the migration itself — the per-row migration result is
 * already captured in the operator's terminal.
 */

import { randomUUID } from 'node:crypto'
import type { MigrationVideoEvent } from '../../src/types'
import type { MigrationResult } from '../migrate-videos'

export interface MigrationTelemetryOptions {
  /** Server URL — same one the publisher CLI talks to. */
  serverUrl: string
  /** Test injection point. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Override the per-run session id. Defaults to a fresh UUID. */
  sessionId?: string
  /** Sink for soft failures. Defaults to stderr.write. */
  onWarn?: (msg: string) => void
}

export interface MigrationTelemetryEmitter {
  /** Emit a single migration_video event. Resolves on success;
   * resolves silently on transport failure (warning emitted via
   * `onWarn`). */
  emit(result: MigrationResult): Promise<void>
  /** The session id stamped on every emit from this emitter —
   * exposed so the operator can correlate Grafana queries. */
  readonly sessionId: string
}

function toEvent(result: MigrationResult): MigrationVideoEvent {
  return {
    event_type: 'migration_video',
    dataset_id: result.datasetId,
    legacy_id: result.legacyId,
    vimeo_id: result.vimeoId,
    stream_uid: result.streamUid,
    bytes_uploaded: result.bytesUploaded,
    duration_ms: result.durationMs,
    outcome: result.outcome,
  }
}

/**
 * Build a one-shot telemetry emitter for the migration run. Each
 * `emit()` POSTs a single-event batch to `<serverUrl>/api/ingest`
 * with the shared session id.
 */
export function makeMigrationTelemetryEmitter(
  options: MigrationTelemetryOptions,
): MigrationTelemetryEmitter {
  const fetchImpl = options.fetchImpl ?? fetch
  const sessionId = options.sessionId ?? randomUUID()
  const onWarn = options.onWarn ?? ((msg: string) => process.stderr.write(`${msg}\n`))
  const baseUrl = options.serverUrl.replace(/\/$/, '')
  const url = `${baseUrl}/api/ingest`
  // /api/ingest's `isAllowedOrigin` rejects requests with no Origin
  // header (and Node fetch doesn't set one by default). The endpoint
  // already accepts same-origin requests — derive the server's origin
  // from the configured serverUrl so the CLI emit lands as
  // `Origin: <serverUrl>` and matches the request URL's origin. A
  // live --dry-run revealed the 403-on-emit failure mode this fixes.
  let originHeader = ''
  try {
    originHeader = new URL(baseUrl).origin
  } catch {
    // Malformed serverUrl — skip the Origin header and let the
    // endpoint reject with the same 403, which surfaces via onWarn
    // exactly as before this fix.
  }

  return {
    sessionId,
    async emit(result: MigrationResult): Promise<void> {
      const event = toEvent(result)
      const body = JSON.stringify({ session_id: sessionId, events: [event] })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (originHeader) headers['Origin'] = originHeader
      let res: Response
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers,
          body,
        })
      } catch (e) {
        onWarn(
          `migration-telemetry: emit unreachable for ${result.datasetId}: ${e instanceof Error ? e.message : String(e)}`,
        )
        return
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        onWarn(
          `migration-telemetry: emit returned ${res.status} for ${result.datasetId}: ${text.slice(0, 100)}`,
        )
      }
    },
  }
}
