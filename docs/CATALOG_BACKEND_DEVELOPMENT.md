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

## Onboarding

A from-zero checklist for a new contributor. The goal is: from a
fresh clone, you can run the catalog backend, hit
`/api/v1/catalog`, and see seeded data in under thirty minutes.
If any step takes substantially longer than that, please open an
issue — the checklist is a contract, not a wish.

### Prerequisites

- **Cloudflare account.** Free plan is sufficient for local
  development. Workers Paid ($5/mo) is required for the production
  deploy story (see "Free-tier viability" in
  [`CATALOG_BACKEND_PLAN.md`](CATALOG_BACKEND_PLAN.md));
  contributors do not need it.
- **Node.js ≥ 20.10.** Wrangler 4+ requires it.
- **A POSIX-y shell.** The dev scripts assume bash/zsh; PowerShell
  works but the npm scripts hard-code forward slashes.
- **Rust toolchain** is only required if you will touch the
  desktop app — unrelated to the catalog backend, but flagged
  because the repo contains both.

### Day-zero checklist

```bash
# 1. Clone and install.
git clone https://github.com/zyra-project/terraviz
cd terraviz
npm install

# 2. Wrangler login (browser-based; opens once).
npx wrangler login

# 3. Copy the dev-vars template and fill in the placeholders.
cp .dev.vars.example .dev.vars
# Edit .dev.vars — see "Required dev vars" below.

# 4. Create the local D1 database, run migrations, seed data.
npm run db:migrate
npm run db:seed

# 5. Run the backend.
npm run dev:backend     # in one terminal — Wrangler at :8788
npm run dev             # in another — Vite at :5173

# 6. Verify.
curl http://localhost:8788/api/v1/catalog | jq '.datasets | length'
# → 20 (the seed importer's default subset)
```

If step 6 prints `20`, you have a working backend. The frontend at
`http://localhost:5173` reads from the local backend automatically
when `VITE_CATALOG_SOURCE=node` is set; the default Vite config
handles the proxy.

### Required dev vars

`.dev.vars` is a Wrangler-format file (`KEY=value`, one per line)
that provides secrets to local Pages Functions. It is gitignored.
The template (`.dev.vars.example`) lists the keys; actual values
come from these sources:

| Key | Where to get it | Needed in |
|---|---|---|
| `NODE_ID_PRIVATE_KEY_PEM` | Generate with `npm run gen:node-key` (Phase 1 ships this script); writes both `.dev.vars` and a public-key file you can paste into the well-known doc | Phase 1 |
| `MOCK_STREAM` | Set `true` for development; bypasses Stream's playback URL signing so you do not need a Stream account locally | Phase 1+ |
| `STREAM_ACCOUNT_ID` / `STREAM_API_TOKEN` | Cloudflare dashboard → Stream. Only needed for Phase 2+ work; with `MOCK_STREAM=true` they can stay unset | Phase 2 |
| `LLM_API_KEY` | Existing — your Orbit LLM provider key, only relevant if you will exercise the chat path locally | n/a |
| `KILL_TELEMETRY` | Set `1` to disable analytics ingestion locally — you almost certainly want this | n/a |

Phase-1 contributors realistically only need `NODE_ID_PRIVATE_KEY_PEM`
+ `MOCK_STREAM=true` + `KILL_TELEMETRY=1`. The rest can stay
unset.

### What "good" looks like

After the checklist runs clean, you should be able to:

- Run `npm run test` and see the existing suite pass. (Day zero
  has no catalog-backend tests yet — they arrive with Phase 1.)
- Run `npm run db:reset` and have the seed re-apply cleanly (no
  schema drift between migrations and `.wrangler/state`).
- Open `http://localhost:8788/.well-known/terraviz.json` and see a
  document signed with the keypair you generated in step 3.
- See a Wrangler startup line that reads
  `Listening on http://localhost:8788` with every binding (D1, KV,
  R2) reporting `ready` (Stream prints `MOCK_STREAM` instead of
  `ready` when mocked, which is expected).

If any of these fail, the troubleshooting matrix in "Local
debugging" below lists the common causes.

### Account-level setup (production-leaning)

Most contributors never touch this. You only need it if you are
preparing a deploy environment, not running locally:

- A D1 database created via `wrangler d1 create terraviz` (or via
  the dashboard); copy the `database_id` into `wrangler.toml`.
- A KV namespace and an R2 bucket — same dashboard / CLI flow,
  bindings declared in `wrangler.toml`.
- A Stream account on the same Cloudflare account if you will
  exercise asset uploads in a non-mock environment.
- Cloudflare Access enabled on `/publish/**` for Phase 3+ work
  (the publisher portal). Local dev does not need Access; the
  publisher API has a `DEV_BYPASS_ACCESS=true` flag that mints a
  fake `staff` publisher row keyed off the local user's email.

The self-hosting walkthrough at
[`docs/SELF_HOSTING.md`](SELF_HOSTING.md) is the more thorough
reference for the full deploy story; the section above is the
minimum a contributor needs to know.

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
