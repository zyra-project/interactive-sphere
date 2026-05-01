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
      'burns ~5 D1 reads per browse-page load.',
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
      'Workers AI binding. Without it the docent search_datasets path 503s with ' +
      'embed_unconfigured.',
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
      'request; absence of the binding fails closed.',
  },
]
