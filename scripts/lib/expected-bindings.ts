/**
 * Expected binding manifest for the production Cloudflare Pages
 * project. The check-pages-bindings script (Phase 1f/B) diffs the
 * actual project's bindings against this list and prints the
 * delta — missing, unexpected, or wrong-environment.
 *
 * The manifest is the source of truth for the table in
 * `CATALOG_BACKEND_DEVELOPMENT.md` "Step 4 — Set Pages env vars and
 * bindings (Production AND Preview)". When a new binding is added
 * to the deploy story, add it here and reference it from the dev
 * doc — operators will then see a clean missing-binding row in the
 * script's output before the route 503s in production.
 *
 * Phase 1d/AB called out the most common foot-gun the live cutover
 * exposed: the dashboard offers a separate Production / Preview
 * toggle per binding, and forgetting either one shows up later as
 * "works on preview, breaks on production" (or vice versa). This
 * manifest models that explicitly — every entry declares which
 * environments it must cover.
 */

export type BindingType =
  | 'plaintext'
  | 'secret'
  | 'd1'
  | 'kv'
  | 'r2'
  | 'vectorize'
  | 'ai'
  | 'analytics_engine'

export type Environment = 'production' | 'preview'

export interface ExpectedBinding {
  name: string
  type: BindingType
  environments: Environment[]
  /** Operator-facing hint shown when the binding is missing. */
  hint?: string
}

const BOTH: Environment[] = ['production', 'preview']

export const EXPECTED_BINDINGS: ExpectedBinding[] = [
  // ── Cloudflare Access (publisher API auth) ────────────────────
  {
    name: 'ACCESS_TEAM_DOMAIN',
    type: 'plaintext',
    environments: BOTH,
    hint:
      'Without this the publisher middleware 503s with access_unconfigured. ' +
      'Set to the team domain (no protocol).',
  },
  {
    name: 'ACCESS_AUD',
    type: 'plaintext',
    environments: BOTH,
    hint:
      'The AUD tag from the Access application. Mismatch surfaces as 401 ' +
      '"Invalid or expired Access assertion".',
  },

  // ── Node identity + preview signing (secrets) ─────────────────
  {
    name: 'NODE_ID_PRIVATE_KEY_PEM',
    type: 'secret',
    environments: BOTH,
    hint:
      'Generate with `npm run gen:node-key`, then ' +
      '`wrangler pages secret put NODE_ID_PRIVATE_KEY_PEM`.',
  },
  {
    name: 'PREVIEW_SIGNING_KEY',
    type: 'secret',
    environments: BOTH,
    hint:
      'HMAC-SHA-256 secret for preview tokens. Without it the preview ' +
      'endpoints fail closed (503 preview_unconfigured).',
  },

  // ── Catalog data plane bindings ───────────────────────────────
  {
    name: 'CATALOG_DB',
    type: 'd1',
    environments: BOTH,
    hint: 'D1 database carrying the catalog schema (datasets, tours, publishers).',
  },
  {
    name: 'CATALOG_KV',
    type: 'kv',
    environments: BOTH,
    hint:
      'KV namespace for the public catalog snapshot. Without it `/api/v1/catalog` ' +
      'burns ~5 D1 reads per browse-page load. Common foot-gun: in the Pages ' +
      'binding form the "name" field is the runtime variable (must be exactly ' +
      'CATALOG_KV) and the "value" dropdown is the underlying namespace; setting ' +
      'the name to the namespace id (32-hex) instead of CATALOG_KV makes ' +
      'env.CATALOG_KV undefined and silently falls through to D1.',
  },
  {
    name: 'CATALOG_R2',
    type: 'r2',
    environments: BOTH,
    hint: 'R2 bucket for sphere thumbnails, image data refs, and tour JSON.',
  },
  {
    name: 'AI',
    type: 'ai',
    environments: BOTH,
    hint:
      'Workers AI binding. Without it /api/v1/search returns 200 with ' +
      "{ degraded: 'unconfigured' } and a Warning header (the route never 5xxs " +
      "for missing bindings); the docent's [RELEVANT DATASETS] block stays empty " +
      'and chip rendering relies on the local-engine fallback (1f/O).',
  },
  {
    name: 'CATALOG_VECTORIZE',
    type: 'vectorize',
    environments: BOTH,
    hint:
      'Vectorize index `terraviz-datasets`. Provision via ' +
      '`wrangler vectorize create terraviz-datasets --dimensions=768 --metric=cosine` ' +
      'plus the metadata-index commands in CATALOG_BACKEND_DEVELOPMENT.md.',
  },

  // ── Other catalog/feedback/telemetry bindings ─────────────────
  {
    name: 'FEEDBACK_DB',
    type: 'd1',
    environments: BOTH,
    hint:
      'Sphere feedback D1 — same physical database as CATALOG_DB on the reference ' +
      'deploy, separate binding for migration scoping.',
  },
  {
    name: 'ANALYTICS',
    type: 'analytics_engine',
    environments: BOTH,
    hint: 'Analytics Engine dataset `terraviz_events` — backs the Grafana dashboards.',
  },
  {
    name: 'TELEMETRY_KILL_SWITCH',
    type: 'kv',
    environments: BOTH,
    hint:
      'KV namespace for the telemetry runtime kill switch. Read on every ingest ' +
      'request. The endpoint deliberately fails OPEN when this binding is missing ' +
      'or its read throws (`functions/api/ingest.ts` `isKillSwitchOn`) — telemetry ' +
      'continues to ingest. So a missing binding is operator-actionable (you lose ' +
      'the emergency lever) but does not stop ingest.',
  },

  // ── Cloudflare Stream (Phase 1b uploads + Phase 2 migration) ──
  // Required once any catalog row's data_ref is on `stream:<uid>`.
  // The manifest endpoint 503s with `stream_unconfigured` when
  // resolving a stream: row without these. Phase 2's migrate-videos
  // CLI talks to Cloudflare Stream directly with operator-shell
  // credentials, so the CLI side doesn't read these bindings — but
  // the SPA's playback path does, immediately after the migration
  // PATCHes data_ref. Configure these BEFORE the first migration
  // run, otherwise migrated rows are unplayable until the next
  // deploy picks them up.
  {
    name: 'STREAM_CUSTOMER_SUBDOMAIN',
    type: 'plaintext',
    environments: BOTH,
    hint:
      'Stream customer subdomain (e.g. customer-abc123.cloudflarestream.com). ' +
      'The manifest endpoint uses it to build HLS playback URLs for stream: ' +
      'data_refs. Find it in the Cloudflare dashboard → Stream → any video → ' +
      'API tab. Without it, /api/v1/datasets/{id}/manifest returns 503 ' +
      'stream_unconfigured for every migrated row.',
  },
  {
    name: 'STREAM_ACCOUNT_ID',
    type: 'plaintext',
    environments: BOTH,
    hint:
      'Cloudflare account id (32-hex). Used by the publisher API\'s ' +
      'mintDirectUploadUrl path (Phase 1b CLI upload command) and by any ' +
      'future server-side Stream operation. Same value as the dashboard\'s ' +
      'right-sidebar Account ID.',
  },
  {
    name: 'STREAM_API_TOKEN',
    type: 'secret',
    environments: BOTH,
    hint:
      'Cloudflare API token with Stream:Edit permission. Paired with ' +
      'STREAM_ACCOUNT_ID for any Pages-side Stream API call. Mint via My ' +
      'Profile → API Tokens → Create Token → Custom → Stream:Edit. The ' +
      'Phase 2 migration CLI also reads this from the operator\'s shell, ' +
      'not from the Pages binding.',
  },

  // ── R2 S3-API credentials (Phase 1b sphere thumbnail uploads) ─
  // Documented at CATALOG_BACKEND_DEVELOPMENT.md "R2 S3 access keys
  // live under 'Manage API tokens'; mint a Read+Write token scoped
  // to the bucket and stash the access-key pair". Required by the
  // sphere-thumbnail-job worker when it writes derived images back
  // to R2; absence surfaces as 503 on the sphere-thumbnail enqueue
  // path. Audit included so these stop showing as "extra".
  {
    name: 'R2_ACCESS_KEY_ID',
    type: 'secret',
    environments: BOTH,
    hint:
      'R2 S3-API access key id. Mint via R2 dashboard → Manage R2 API Tokens → ' +
      'Create token with Read+Write on the catalog bucket.',
  },
  {
    name: 'R2_SECRET_ACCESS_KEY',
    type: 'secret',
    environments: BOTH,
    hint:
      'R2 S3-API secret access key. Paired with R2_ACCESS_KEY_ID; shown once at ' +
      'token mint time.',
  },
  {
    name: 'R2_S3_ENDPOINT',
    type: 'secret',
    environments: BOTH,
    hint:
      'R2 S3-API endpoint URL (e.g. https://<acct>.r2.cloudflarestorage.com). ' +
      'Shown alongside the access key when the R2 API token is minted.',
  },

  // ── Feedback admin gate (legacy, pre-Access) ──────────────────
  // Documented at SELF_HOSTING.md §5b. Cloudflare Access protects
  // the feedback-admin route in the reference deploy; this token
  // is the break-glass fallback used by direct-scripting paths
  // (`api/feedback-export`, etc.) that haven't been migrated to
  // service-token auth. Required for those paths to function.
  {
    name: 'FEEDBACK_ADMIN_TOKEN',
    type: 'secret',
    environments: BOTH,
    hint:
      'Bearer token gating the legacy feedback-admin direct-scripting routes. ' +
      'Generate with `openssl rand -hex 32` and stash via `wrangler pages secret ' +
      'put FEEDBACK_ADMIN_TOKEN`. The newer dashboard route is gated by ' +
      'Cloudflare Access instead (SELF_HOSTING.md §5b).',
  },
]
