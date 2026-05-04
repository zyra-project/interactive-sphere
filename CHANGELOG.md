# Changelog

Operator-facing changelog for the Terraviz catalog backend roll-out.
Each phase corresponds to a single merged PR; the per-commit detail
lives in `git log` (commit messages follow the `catalog(<phase>/<letter>):`
convention) and the design docs in `docs/CATALOG_*`.

For the upstream catalog plan, see
[`docs/CATALOG_BACKEND_PLAN.md`](docs/CATALOG_BACKEND_PLAN.md).
For the developer onboarding,
[`docs/CATALOG_BACKEND_DEVELOPMENT.md`](docs/CATALOG_BACKEND_DEVELOPMENT.md).

This file documents Phase 1 onward. The pre-catalog history (analytics
pipeline, VR mode, tour engine, etc.) lives in the merged PRs
referenced in [`README.md`](README.md).

---

## Phase 2 — Stream re-upload migration

**Branch:** `claude/stream-migration-phase-2-dbBnm`
**Commits:** 2/A through 2/H — eight logical changes.

Phase 1b shipped the canonical Stream upload pipeline (publisher
API mints Stream direct-upload URLs, content-addressed by sha256
of the bytes); the legacy SOS rows that Phase 1d imported never
migrated. ~138 video rows still played through the legacy
`vimeo:<id>` data_ref proxied via `video-proxy.zyra-project.org`.
Phase 2 closes that gap with one-time operator tooling.

| Commit | Summary |
|---|---|
| 2/A | `cli/lib/vimeo-fetch.ts` — resolves a `vimeo:<id>` to a streaming MP4 + duration via the existing video-proxy. Picks the highest-quality MP4 by size; ties broken by width. Splits metadata fetch from byte-stream fetch so the cost guard rail can sum durations without buffering bytes. |
| 2/B | `cli/lib/stream-upload.ts` — TUS-resumable upload helper. POSTs the create endpoint with `Tus-Resumable: 1.0.0` + `Upload-Length`, then PATCHes the body to the returned `Location` URL in a single shot. Returns the resulting Stream UID. Plain library function — a future server-side real-time ingestion endpoint can reuse it. |
| 2/C | `terraviz migrate-videos` CLI subcommand. Walks every published `vimeo:` `video/mp4` row, drives the per-row pipeline (resolve → upload → PATCH `data_ref` → emit telemetry). Idempotent — `stream:` rows skipped at plan time. Sequential, paced 5 s default. `--dry-run`, `--limit=N`, `--id=<id>`, `--pace-ms=N`. |
| 2/D | Cost guard rail. `--max-minutes=N` (default 300, ~$0.30/mo) hard-fails when total estimated minutes exceed the budget. Source: Vimeo's oembed endpoint. Cache: `.cache/vimeo-durations.json` (gitignored). Estimate respects `--limit` and surfaces missing-duration count separately. |
| 2/E | `migration_video` telemetry event. Tier A. Fields: `dataset_id` / `legacy_id` / `vimeo_id` / `stream_uid` / `bytes_uploaded` / `duration_ms` / `outcome` (`ok` / `vimeo_fetch_failed` / `stream_upload_failed` / `data_ref_patch_failed`). Operator-side emitter at `cli/lib/migration-telemetry.ts` POSTs single-event batches to `/api/ingest`. |
| 2/F | Operator runbook in `CATALOG_BACKEND_DEVELOPMENT.md` "Migrating legacy Vimeo data refs to Stream". Pre-flight, batched migration, recovery from partial failures, rollback recipe, observation window. |
| 2/G | Grafana migration row on `Terraviz — Product Health`. Three panels at y=34: per-day runs by outcome, cumulative ok rows, failure breakdown. After a clean run the row becomes a quiet "still 0% on `vimeo:`" reassurance. |
| 2/H | This file. |

### Operator-visible changes

- **New CLI subcommand:**
  ```sh
  npm run terraviz -- migrate-videos --dry-run         # plan + cost
  npm run terraviz -- migrate-videos --limit=5         # sanity batch
  npm run terraviz -- migrate-videos                   # full run
  ```
  Requires `STREAM_ACCOUNT_ID` + `STREAM_API_TOKEN` in the
  environment — same names the publisher API binding uses.
- **New telemetry event:** `migration_video` — Tier A, one-shot,
  no throttling. The session id is printed at run start so the
  operator can correlate Grafana queries.
- **New Grafana panels:** three on `Terraviz — Product Health`,
  bumped to `version: 7`. Re-import from
  `grafana/dashboards/product-health.json` after deploying.

### Stream cost calibration

138 rows × ~1 min average ≈ ~140 minutes ≈ ~$0.14/month at
Cloudflare Stream's $1/1000-min rate. The default
`--max-minutes=300` keeps ~2× headroom — tight enough that
exceeding it means something genuinely surprising is in the
catalog (a mis-imported full-length film, a row pointing at the
wrong Vimeo ID), loose enough not to trip on the long tail of
legitimate ~6-min narrated videos. The Grafana migration row
is the ongoing observation surface.

### No breaking changes

The manifest endpoint already resolves both `vimeo:` and
`stream:` (Phase 1b/N). A row mid-migration (uploaded but
data_ref not yet patched) plays through the proxy until the
patch step lands; a row post-migration plays through Stream's
HLS edges directly. The SPA is unchanged.

### Rollback recipe

Single-direction migration only. Per-row rollback is a manual
data_ref update via the existing PUT route:

```sh
npm run terraviz -- update <dataset_id> '{"data_ref":"vimeo:<id>"}'
```

The orphan Stream UID stays in Stream until manually deleted via
the dashboard or API. There is no `--reverse` flag in v1; if
rollback proves common, add one as a follow-on commit.

### Out of scope (deferred)

- **Vimeo proxy retirement.** Proxy stays running until the
  migration is 100% complete AND has been observed for ≥1
  month.
- **Real-time / ongoing Vimeo→Stream ingestion.** Belongs
  server-side via the publisher API; Phase 2 only ships the
  one-shot operator path. The library helpers
  (`vimeo-fetch.ts`, `stream-upload.ts`) are deliberately
  reusable from a future server endpoint.
- **R2 migration of image rows.** A separate phase if it ever
  lands (call it 2b).
- **Stream re-encoding tier upgrades** (HEVC, AV1) — separate
  ops pass.

---

## Phase 1f — Cutover stabilisation (PR #62)

**Released:** May 2026
**Branch:** `claude/cutover-stabilization-phase-1f-EwThP`
**Commits:** 1f/A through 1f/O — fifteen logical changes
(eight planned + seven follow-ons across review feedback and a
live-reported regression).

The Phase 1d cutover landed safely but the live deploy surfaced
operator-experience and cost-observability friction the plan didn't
predict. Phase 1f closes those gaps. Three Copilot review rounds
on top of the original plan caught a verify-deploy contract bug
that would have shipped broken (1f/M) and a JPEG renderer
mismatch that silently dropped ~30 datasets from the browse list
(1f/K, operator-reported, confirmed fixed live).

| Commit | Summary |
|---|---|
| 1f/A | Error-envelope audit across `functions/api/v1/publish/**`. Same `{error, message}` vs `{errors: [...]}` discipline 1d/O introduced for the reindex route, applied to publish.ts and retract.ts (404-race parity). |
| 1f/B | `scripts/check-pages-bindings.ts` — automated audit of the Pages project's bindings against an expected manifest. Catches the per-environment Production / Preview toggle gotcha 1d/AB documented but didn't enforce. |
| 1f/C | Per-session pre-search LRU cache wrapping `executeSearchDatasets`. 16-entry LRU, 5-minute TTL, query canonicalisation. Cuts Workers AI neuron burn for repeated queries within a session. |
| 1f/D | Workers AI 4006 quota guard rail. Server-side detection in `/api/chat/completions` and `/api/v1/search`; client-side session-scoped degraded state; "Reduced functionality" badge in the chat panel; transparent fallback through the local engine. |
| 1f/E | `grafana/dashboards/orbit-cost.json` — Grafana panels consuming 1d/Y's `turn_rounds` telemetry. Distribution, total LLM rounds, p95 duration split, top hashed query terms. |
| 1f/F | `terraviz verify-deploy` CLI subcommand. Per-check pass/fail/skip table for the post-deploy smoke-test from CATALOG_BACKEND_DEVELOPMENT.md. |
| 1f/G | `docs/SELF_HOSTING.md` Phase 8 walkthrough refresh. Catalog-stack bindings, Workers Paid recommendation, snapshot import, post-deploy verification. |
| 1f/H | This file. |
| 1f/I | Round-1 Copilot fixes: cache-key correctness, listener cleanup, badge wording, helper API tightening, doc drift. |
| 1f/J | Round-2 Copilot fixes: never cache degraded responses, cross-platform entrypoint detection, follow-on wording-drift sweeps. |
| 1f/K | **Regression fix.** Operator-reported: ~30 JPEG datasets (incl. "Age of the Seafloor") silently filtered from the browse list because the SPA's `isImageDataset` didn't recognise the publisher API's canonical `image/jpeg`. Confirmed fixed live by the operator. |
| 1f/L | Catalog-source `normaliseSourceFormat` collapses legacy SOS JPEG typos to canonical `image/jpeg`; `image/webp` added to `isImageDataset` to match the validator's `FORMAT_VALUES` surface. |
| 1f/M | Round-3 Copilot fixes: `verify-deploy` was built against an imagined `/api/v1/search` contract (used `hits`, expected 503 for degraded). Real route returns `datasets` and signals degraded via 200+`body.degraded`+`Warning` header. Tests + check + doc all corrected. |
| 1f/N | Round-4 Copilot fixes: drop "Capacity temporarily exceeded" pattern from the quota classifier (load-shedding ≠ quota); emit `wrong_type` from `diffBindings` so binding-name+wrong-bucket collisions surface as one row instead of two; add chat UI tests for the degraded badge (initial render, live updates, double-init guard). |
| 1f/O | Round-5 Copilot fixes: `wrong_type` now fails `check-pages-bindings` (was exit 0); search-side degraded short-circuits the LLM round and routes to the local engine instead of letting the chat call burn a second quota check on an ungrounded prompt; this changelog entry brought up to date. |

### Operator-visible changes

- **Quota guard rail:** When Workers AI returns 4006 / quota
  exhausted, the chat panel shows a "Reduced functionality —
  Workers AI quota reached" badge and the docent transparently
  routes through the local-engine fallback. Self-heals on the
  next successful LLM call. Reactive only — preemptive
  detection is parked until 1f/E's cost panel produces real
  per-turn data to calibrate against.
- **New operator commands:**
  - `npm run check:pages-bindings` — diff Pages bindings against
    the expected manifest (requires `CLOUDFLARE_API_TOKEN` +
    `CLOUDFLARE_ACCOUNT_ID`; project name defaults to `terraviz`,
    override via `CLOUDFLARE_PAGES_PROJECT_NAME`).
  - `npm run terraviz -- verify-deploy [--skip-publish-checks]`
    — post-deploy smoke-test against the configured server.
- **New Grafana dashboard:** `Terraviz — Orbit Cost`
  (uid `terraviz-orbit-cost`). Import from
  `grafana/dashboards/orbit-cost.json`.

### No breaking changes

Every API envelope shift is additive (`degraded: 'quota_exhausted'`
joins `'unconfigured'` rather than replacing it; the publish/retract
route shape changes only in the race-only 404 path that already
returns 404 just with a different envelope shape).

### Rollback recipes

- **Pre-search cache too aggressive:** revert 1f/C; the cache
  is purely client-side, no server impact.
- **Quota guard rail false-positive:** revert 1f/D's
  `functions/api/_lib/workers-ai-error.ts` patterns or the
  call sites in `chat/completions.ts` / `search-datasets.ts`.
  The badge UI in `chatUI.ts` is harmless if the state never
  flips.
- **Verify-deploy false-fail:** the command runs read-only HTTP
  probes — no rollback needed; reproduce locally with the same
  `--server` flag and add a stub case in `cli/lib/verify-checks.ts`.
- **JPEG renderer (1f/K, 1f/L):** revert the `image/jpeg` /
  `image/webp` additions to `DatasetFormat` and `isImageDataset`
  to fall back to the legacy typo'd MIME set. Will re-introduce
  the silent-drop bug; only useful if a different fork's
  catalog source has been hand-canonicalised to those legacy
  values.
- **Search-degraded short-circuit (1f/O):** revert the
  `if (needsPreSearch && preSearchResult.degraded)` block in
  `processMessage`. The badge still flips correctly via the
  state-update path; the chat call resumes burning quota on
  ungrounded prompts.

---

## Phase 1d — SOS bulk import + docent cutover (PR #60)

**Merged:** April 2026
**Branch:** `claude/docent-cutover-phase-1d-MmIqm`
**Commits:** 1d/A through 1d/AD — 30 logical changes.

The cutover phase: flipped the docent's primary discovery surface
from the legacy in-memory keyword scan to the Vectorize-backed
`search_datasets` tool, imported the SOS catalog into the new
publisher pipeline, and shipped the operator deploy walkthrough.

### Highlights

- **SOS bulk importer** (1d/A, 1d/B, 1d/C): `terraviz
  import-snapshot` walks the upstream SOS catalog snapshot,
  shapes rows for the publisher API, and uploads them with
  `legacy_id` idempotency.
- **Docent cutover** (1d/E, 1d/F, 1d/G): tool ordering flipped
  to `search_datasets` first; frontend default
  `VITE_CATALOG_SOURCE=node`.
- **`--reindex` flag** (1d/D): bulk re-embed for operators
  wiring Vectorize after publishing rows, and for future
  model-version bumps.
- **Vectorize-backed pre-search injection** (1d/AC): restored the
  `[RELEVANT DATASETS]` block in the user message, this time
  sourced from `search_datasets` instead of in-memory keyword
  scan. Closes the chip-render reliability regression that 1d/F
  introduced on mid-tier LLMs.
- **Production deployment checklist** (1d/AB): step-by-step
  walkthrough in `CATALOG_BACKEND_DEVELOPMENT.md` covering
  bindings, Access setup, snapshot import, smoke tests.
- **Tour engine legacy_id support** (1d/T, 1d/U, 1d/Z):
  case-insensitive `INTERNAL_*` matching with `legacyId`
  fallback so existing tour JSON keeps working post-cutover.
- **`turn_rounds` telemetry** (1d/Y): plumbed through to the
  `orbit_turn` analytics event; consumed by Phase 1f/E's
  Grafana panels.

### Breaking changes

- The default catalog source flipped from `legacy` to `node`. A
  fork that wants the old behaviour must set
  `VITE_CATALOG_SOURCE=legacy` explicitly.

### Rollback recipe

Set `VITE_CATALOG_SOURCE=legacy` and redeploy. The legacy
`search_catalog` tool stays in the docent's tool list as the
fallback — a deploy without Vectorize wired works without
intervention. Full rollback recipe in
`CATALOG_BACKEND_DEVELOPMENT.md` "Cutover rollback recipe".

---

## Phase 1c — Vectorize semantic search (PR #59)

**Merged:** March 2026
**Branch:** `claude/docent-search-phase-1c-QSBRE`
**Commits:** 1c/A through 1c/P.

Plumbed the embed pipeline end-to-end: Workers AI generates
768-dim vectors from canonical dataset text, Vectorize stores them
under metadata-indexed keys (peer_id / category / visibility), and
the new `/api/v1/search?q=` endpoint hydrates hits back through
D1. The docent gained a `search_datasets` LLM tool that calls the
public endpoint and shapes the result for the LLM.

### Highlights

- **Vectorize integration** (1c/A): `vectorize-store.ts` helpers
  + an in-memory mock for local dev.
- **Embeddings** (1c/B, 1c/C): canonical dataset text + Workers
  AI call + the embed-dataset-job pipeline, queued from
  publish/update/retract.
- **Search route** (1c/E): `GET /api/v1/search?q=` with KV
  snapshot caching; degrades to `{datasets: [], degraded:
  'unconfigured'}` when AI/Vectorize aren't wired.
- **Featured-list endpoint + tool** (1c/F): operator-curated
  cold-start list for "what should I look at?" prompts.
- **Frontend docent refactor** (1c/G): the system prompt is
  static again; the tool list (search_datasets,
  list_featured_datasets, search_catalog) is the single
  source of grounded IDs.
- **Cutover deferred** (1c/L): `search_catalog` stayed primary
  in this phase to avoid a mid-deploy regression on
  unwired-Vectorize forks; Phase 1d landed the actual flip.

### Mock-mode parity

`MOCK_VECTORIZE=true` + `MOCK_AI=true` in `.dev.vars` (defaults
in `.dev.vars.example`) makes the entire pipeline work offline.
Cosine similarity in the mock is feature-hashed against the
vocabulary, so multi-step "publish three datasets, search for
the closest" walks behave like real embeddings at a coarse level.

---

## Phase 1b — Asset upload pipeline (PR #58)

**Merged:** February 2026
**Branch:** `claude/catalog-backend-phase-1b-97irR`
**Commits:** 1b/A through 1b/P.

Direct upload pipeline for dataset assets — Stream for video,
R2 for images / legends / captions / tour JSON. Two-phase flow
(`POST .../asset` mints a presigned URL, `POST .../asset/{id}/complete`
verifies the digest and flips the row's `*_ref` column).

### Highlights

- **R2 + Stream bindings** (1b/A, 1b/B): helpers + tests for the
  S3-compatible presigned PUT path and the Stream direct-upload
  flow.
- **Asset init / complete endpoints** (1b/C, 1b/D): publisher
  API gains `POST .../asset` (mints upload URL) and `POST
  .../asset/{upload_id}/complete` (verifies digest, flips row).
- **Sphere-thumbnail pipeline** (1b/E): operator-side image
  resize via Cloudflare Images URL transformations.
- **Featured-datasets endpoints** (1b/F): operator curation
  surface for the cold-start list (consumed by 1c/F's tool).
- **CLI `upload` command** (1b/G): `terraviz upload <id> <kind>
  <path>`, polls Stream transcode for `data` kind videos
  before completing.
- **Manifest endpoint resolves `r2:` and `stream:` refs** (1b/N):
  the public manifest API hands the SPA a real playback URL
  even for newly-uploaded rows.

### Mock mode

`MOCK_R2=true` + `MOCK_STREAM=true` (defaults in
`.dev.vars.example`) returns deterministic stub URLs; the
`/complete` route trusts the publisher's claimed digest as
ground truth. Refused on non-loopback hostnames so a production
misconfig can't accept forged claims.

---

## Phase 1a — Catalog backend foundation (PR #57)

**Merged:** January 2026
**Branch:** `claude/catalog-backend-phase-1a-TUYq3`
**Commits:** 1a/A through 1a/I.

The bones of the catalog backend: D1 schema, the public read
API, the Cloudflare Access middleware, the publisher API metadata
endpoints, the well-known doc, the CLI skeleton, and the frontend
catalog-source switch.

### Highlights

- **D1 migrations + seed pipeline** (1a/A): catalog schema lives
  under `migrations/catalog/` with a separate `CATALOG_DB`
  binding so it can be applied independently of the existing
  feedback DB.
- **Catalog read API + KV cache** (1a/B): `GET /api/v1/catalog`
  with a hot-path snapshot keyed by ETag; invalidated on every
  publish/retract.
- **Manifest endpoint** (1a/C): `GET /api/v1/manifest/{id}`
  resolves `vimeo:` and `url:` data_refs into HLS playback URLs.
- **`gen:node-key` script + well-known doc** (1a/D): every node
  has an Ed25519 keypair signed with `npm run gen:node-key`;
  advertised via `/.well-known/terraviz.json` for the federation
  story (Phase 4).
- **Cloudflare Access middleware** (1a/E): JIT-provisions a
  publisher row keyed off the Access JWT's email; `DEV_BYPASS_ACCESS=true`
  is the localhost-only escape hatch.
- **Publisher API metadata** (1a/F): list / get / create /
  update / publish / retract / preview endpoints over D1.
- **`terraviz` CLI skeleton** (1a/G): subcommands for me, list,
  get, publish, update, retract, preview, with `Cf-Access-Client-Id`
  / `-Secret` headers for service-token auth.
- **`VITE_CATALOG_SOURCE`** (1a/H): build-time switch flipping
  the SPA between the legacy SOS S3 fetch and the new node-API
  read. Default stayed `legacy` for 1a/1b/1c; flipped to `node`
  in 1d/G.
- **Onboarding** (1a/I): `.dev.vars.example`, devcontainer fixes,
  README polish.

### Out of scope (deferred to later phases)

- Asset uploads (R2 / Stream) — Phase 1b.
- Vectorize semantic search — Phase 1c.
- SOS bulk import + cutover — Phase 1d.
- Cost observability + quota guard rail — Phase 1f.
- Legacy retirement (`search_catalog` tool, `VITE_CATALOG_SOURCE=legacy`,
  SOS S3 fetch path) — Phase 1e, observation-gated.

---

## Earlier phases

Pre-catalog history is documented in PR descriptions and the
design docs under `docs/`. See in particular:

- [`docs/ANALYTICS.md`](docs/ANALYTICS.md) — telemetry pipeline
  (PR #51, #54).
- [`docs/VR_INVESTIGATION_PLAN.md`](docs/VR_INVESTIGATION_PLAN.md)
  — WebXR mode.
- [`docs/TOURS_IMPLEMENTATION_PLAN.md`](docs/TOURS_IMPLEMENTATION_PLAN.md)
  — SOS tour playback.
- The merged PR list in `git log --grep="Merge pull request"`.
