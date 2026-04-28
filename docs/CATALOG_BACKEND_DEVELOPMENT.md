# Catalog Backend Development

How a contributor runs the catalog backend on their laptop, what
the repo looks like, how tests are layered, and what CI/CD does
on the way to production. Companion to
[`CATALOG_BACKEND_PLAN.md`](CATALOG_BACKEND_PLAN.md); schema
referenced from
[`CATALOG_DATA_MODEL.md`](CATALOG_DATA_MODEL.md); the
federation conformance test runs against the protocol described
in
[`CATALOG_FEDERATION_PROTOCOL.md`](CATALOG_FEDERATION_PROTOCOL.md).

The plan is unbuildable without an answer to "how do I run the
catalog backend on my laptop." Cloudflare Pages Functions, D1,
KV, R2, Stream, and Queues all have local-emulation stories of
varying maturity; the plan picks one path and commits to it.

## Stack

- **Wrangler** (`wrangler pages dev`) is the runner. It loads the
  Pages config, spins up a local Miniflare instance, and serves
  Functions at `localhost:8788`.
- **D1 local mode** (`wrangler d1 ... --local`) gives a real
  SQLite file under `.wrangler/`. The same migration files apply
  to local and remote.
- **KV local** is in-memory in Miniflare; ephemeral by design,
  fine for development.
- **R2 local** is on-disk under `.wrangler/`; persists across
  restarts.
- **Stream** has no local emulation. Local dev uses a static
  `.m3u8` served from R2 (or `public/`) and a `MOCK_STREAM=true`
  flag that makes the manifest endpoint return a fixed URL
  instead of a Stream signed playback URL.
- **Queues** also has no production-quality local emulation; the
  job-queue interface ships an `InMemoryJobQueue` for dev that
  runs jobs synchronously in the same Worker. Federation sync
  in dev is a manual `npm run sync-peers` invocation rather
  than a scheduled cron.
- **Workers AI** in dev: the Cloudflare AI binding works against
  the production endpoint with a free quota; tests stub it.

## Repo layout for the new code

```
functions/api/v1/
  catalog.ts
  datasets/[id].ts
  datasets/[id]/manifest.ts
  federation/...
  publish/...
  _lib/                          # the portability interfaces
  _routes/                       # thin wrappers binding env to handlers

migrations/
  catalog/
    0001_init.sql
    0002_renditions.sql
    ...

scripts/
  seed-catalog.ts                # imports SOS catalog → local D1
  generate-fixtures.ts           # canned dataset rows for tests
  sync-peers.ts                  # manual federation pull (dev only)
  rotate-peer-secret.ts          # ops helper

src/services/
  ...                            # frontend-only, unchanged
```

## Contributor entry points

```bash
npm run dev:backend     # wrangler pages dev with all local bindings
npm run dev             # vite dev server (existing) — proxies /api/* to :8788
npm run db:migrate      # wrangler d1 migrations apply terraviz --local
npm run db:seed         # node scripts/seed-catalog.ts (writes to local D1)
npm run db:reset        # rm .wrangler/state/v3/d1/* && db:migrate && db:seed
npm run test            # vitest run (existing, plus new backend tests)
npm run test:federation # contract tests — spins up two Wranglers, peers them
```

The frontend dev workflow stays as it is today (`npm run dev` →
Vite dev server). Vite proxies `/api/*` to the local Wrangler at
`:8788` via a `vite.config.ts` proxy entry; production resolves
the same paths to Pages Functions on the same origin. The desktop
app uses `localhost:8788` during dev and the deployed origin in
production.

## Seed data

`scripts/seed-catalog.ts` is the same importer described in the
data model section, restricted to a configurable subset (default:
20 representative datasets across video, image, and tour types).
Subset keeps `db:seed` fast and avoids hammering the public S3 in
CI. A `--full` flag pulls the entire ~600-item catalog when a
contributor needs realistic load.

`scripts/generate-fixtures.ts` produces deterministic test data:
fixed ULIDs, fixed timestamps, fixed signatures. Used by federation
contract tests and unit tests.

## Testing strategy

- **Unit** — Vitest, colocated `*.test.ts`. Pure logic
  (canonicalization, signature verification, manifest assembly,
  visibility resolution).
- **Integration** — Vitest with Miniflare. A handler is invoked
  with a real local D1, real local KV, real local R2; assertions
  check both the response and the side effects in storage.
- **Contract (federation)** — `npm run test:federation` boots two
  Miniflare instances on different ports, runs a handshake, runs
  a sync, asserts that catalog state on the subscriber matches a
  golden snapshot. This is the test that catches protocol
  regressions across versions.
- **End-to-end** — Playwright against the running stack: publish a
  dataset, browse the catalog, load the dataset on the globe.
  Only for high-value flows; not a replacement for integration
  tests.
- **Load** — `k6` script targeting the local `/api/v1/catalog`
  with a seeded ~600-dataset DB; verifies p95 latency budget
  before merging changes that touch the hot path.

## CI/CD

- **Per-PR.** Lint, type-check, unit + integration, build the
  frontend bundle, run migrations against an ephemeral local D1
  to catch SQL errors. Federation contract test runs on PRs that
  touch `functions/api/v1/federation/**`.
- **Preview deploys.** Pages already creates a preview URL per
  PR. Migrations applied to a preview D1 (per-branch DB) so a
  schema change can be exercised against real Cloudflare runtime
  before merge.
- **Production.** On merge to `main`, migrations apply to the
  production D1 *before* the new Pages build is promoted, so a
  rollback can revert the bundle without leaving D1 mid-migration.
  Migrations are forward-only; rollbacks are forward-fix migrations.

## Conventions

- One commit per migration, with the migration file in the same
  commit as the code that depends on it.
- `schema_version` bumps in a separate commit so its diff is the
  one place to audit shape changes.
- Federation protocol changes go through a separate `protocol/`
  changelog file (in addition to git history) so peer operators
  can subscribe to it.
