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

## Phase 3 — R2 + HLS for 4K spherical video

**Branch:** `claude/r2-hls-migration-phase-3-x7Kpq`
**Commits:** 3/A through 3/H — eight logical changes.

Phase 2 attempted to migrate the legacy SOS Vimeo catalog to
Cloudflare Stream but hit the standard Stream plan's 1080p
rendition ceiling — unworkable for spherical content where
viewers zoom into features smaller than the equator. Phase 3
replaces that approach with a self-managed HLS pipeline on
Cloudflare R2:

1. **Operator-side FFmpeg** pre-encodes each source MP4 into a
   multi-rendition HLS bundle (4096x2048 + 2160x1080 + 1440x720
   at 2:1 spherical aspect, 6-second VOD segments).
2. **R2 upload** stores the bundle (master playlist + variant
   playlists + .ts segments) under `videos/<dataset_id>/` in
   the existing `terraviz-assets` bucket via the S3 API.
3. **R2 public-bucket + custom domain** serves the HLS files
   directly. No Worker needed for v1.
4. **Manifest endpoint extension** resolves video `r2:` data_refs
   to the HLS master playlist URL.
5. **`r2:videos/<dataset_id>/master.m3u8`** is the data_ref scheme.

Trade-offs vs. Phase 2's Stream approach:
- **More upfront work**: operator runs FFmpeg locally (hours, not
  minutes).
- **More storage**: ~30-50 GB R2 total (3 renditions × 140 min of
  content), but R2 storage is $0.015/GB/month → ~$0.50-0.75/month.
- **Zero egress cost**: R2 has no per-delivery charge regardless of
  viewer count. Stream's $5/mo flat is replaced by R2's
  pay-for-storage-only model that's cheaper at every catalog size.
- **True 4K renditions**: 4096x2048 spherical preserved.

| Commit | Summary |
|---|---|
| 3/A | `cli/lib/ffmpeg-hls.ts` — wraps the FFmpeg child process that produces a 3-rendition HLS bundle. `buildFfmpegArgs` is exported so tests can pin the exact command shape; `encodeHls` is the high-level API the migrate subcommand calls. Captures the last 4 KB of stderr for clear error attribution. |
| 3/B | `cli/lib/r2-upload.ts` — walks a local HLS bundle and uploads each file to R2 under a key prefix via the S3 API. SigV4 signing via `aws4fetch` (~2 KB, no transitive deps — much lighter than the full AWS SDK for what's effectively "PUT bytes with a signature"). Bounded parallelism (6 concurrent per bundle). Per-file Content-Type set correctly (`application/vnd.apple.mpegurl` for `.m3u8`, `video/mp2t` for `.ts`). Also exports `deleteR2Prefix` for the rollback path. |
| 3/C | `terraviz migrate-r2-hls` CLI subcommand. Orchestrates the per-row pipeline: resolve vimeo → encode HLS → upload to R2 → PATCH data_ref → emit telemetry → clean up workdir. Idempotent (rows already on `r2:` skipped at plan time). Includes `cli/lib/vimeo-source.ts` (slimmer than Phase 2's vimeo-fetch — just resolves the source URL since FFmpeg pulls it directly via `-i`) and `cli/lib/migration-telemetry.ts` (event-type-agnostic emitter with Phase 2/M's Origin-header fix carried forward). |
| 3/D | Manifest endpoint extension — `r2:<key>.m3u8` + video format returns a `kind: 'video'` manifest with `hls` set to the R2 public URL. The existing `r2:` + video path stays for non-`.m3u8` direct-MP4 refs (rare). Case-insensitive on the suffix. |
| 3/E | `migration_r2_hls` telemetry event. Tier A. Fields: `dataset_id`, `legacy_id`, `vimeo_id`, `r2_key`, `source_bytes`, `bundle_bytes`, `encode_duration_ms`, `upload_duration_ms`, `duration_ms`, `outcome`. Added to `KNOWN_EVENT_TYPES` in `functions/api/ingest.ts` so the events the migration CLI emits actually land in AE → Grafana. |
| 3/F | `terraviz rollback-r2-hls` subcommand + operator runbook + expected-bindings audit additions. Mirrors Phase 2's would-be rollback-stream: PATCH data_ref back to `vimeo:<id>` first (commit point), then delete the R2 prefix (cleanup; non-fatal). Runbook section in `CATALOG_BACKEND_DEVELOPMENT.md` covers Pages-side prereqs (custom domain, `R2_PUBLIC_BASE`, CORS), operator-side prereqs (FFmpeg + R2 S3 creds), pre-flight dry-run, live migration, failure modes, rollback, and the observation window. `R2_PUBLIC_BASE` + the R2 S3 credentials added to `expected-bindings.ts`. |
| 3/G | Grafana migration row on `Terraviz — Product Health`. Three panels at y=34: per-day runs by outcome, cumulative ok rows, failure breakdown. Pins `blob7 = outcome` based on `toDataPoint`'s alphabetical ordering of `MigrationR2HlsEvent`'s string fields (dataset_id, legacy_id, outcome, r2_key, vimeo_id at blob5..blob9). Dashboard version 6 → 7. |
| 3/H | This file. |

### Operator-visible changes

- **New CLI subcommands:**
  ```sh
  npm run terraviz -- migrate-r2-hls --dry-run             # plan + storage estimate
  npm run terraviz -- migrate-r2-hls --limit=5             # sanity batch
  npm run terraviz -- migrate-r2-hls                       # full run
  npm run terraviz -- rollback-r2-hls <id> --to-vimeo=<n>  # roll one row back
  ```
  Both require `R2_S3_ENDPOINT` + `R2_ACCESS_KEY_ID` +
  `R2_SECRET_ACCESS_KEY` in the operator's environment, plus
  `TERRAVIZ_ACCESS_*` for the publisher API.

- **New Pages env var (Production + Preview):** `R2_PUBLIC_BASE`
  set to your custom domain (e.g. `https://video.zyra-project.org`).
  Bind the domain in Cloudflare dashboard → R2 →
  `terraviz-assets` → Settings → Connect Domain. Configure a CORS
  policy on the bucket allowing GET from the SPA's origins.

- **Re-import the Grafana dashboard** (`grafana/dashboards/product-health.json`)
  to pick up version 7 with the migration row.

- **Operator prereq:** FFmpeg ≥ 6 on PATH (or pass `--ffmpeg-bin`).
  Apt: `apt-get install -y ffmpeg`. John Van Sickle static
  binaries work on any glibc Linux for slim base images.

### Phase 2 transition

Phase 2 shipped as a draft PR targeting Cloudflare Stream but
was abandoned after live testing revealed the standard Stream
plan caps rendition output at 1080p height — a UX regression
for spherical content under SPA zoom. The Phase 2 PR was
closed unmerged; this Phase 3 branch supersedes it, branching
fresh from `main` rather than off the Phase 2 work.

Some of the operator workflow patterns (custom domains for
asset serving, expected-bindings audit, runbook structure)
carry forward from Phase 2's design exploration. The actual
code surface is independent — Phase 2's `migrate-videos` and
`rollback-stream` subcommands never landed; Phase 3 ships
`migrate-r2-hls` + `rollback-r2-hls` as the production-going
shape.

### Storage cost calibration

136 rows × ~1 min average × ~244 MB/min for the 3-rendition
ladder ≈ ~33 GB total → ~$0.50/month flat at R2's $0.015/GB-month
rate. Egress is free. Compared to Phase 2's $5/mo Stream base
tier (which would have been needed regardless for 4K renditions
at an Enterprise tier), R2 is significantly cheaper at any
catalog size. Storage scales linearly with content duration;
egress doesn't scale with viewer count.

### No breaking changes

The manifest endpoint resolves all four schemes (`vimeo:`,
`url:`, `stream:`, `r2:`) — a row mid-migration plays through
whichever scheme its current `data_ref` references. The SPA's
HLS player handles both Vimeo-proxy HLS and R2-served HLS via
the same `hlsService.ts` code path. No frontend changes.

### Rollback

Per-row rollback via `terraviz rollback-r2-hls`:

```sh
npm run terraviz -- rollback-r2-hls <dataset_id> --to-vimeo=<original_id>
```

PATCHes data_ref back to `vimeo:` first (commit point), then
deletes the R2 bundle. If the DELETE fails the row is still
correctly back on `vimeo:`; orphan R2 prefix stays for manual
cleanup.

### Out of scope (deferred)

- **Server-side encoding pipeline.** Workers can't run FFmpeg;
  Cloudflare's Media Transformations binding only downscales.
  Phase 3 stays operator-side. If catalog growth makes one-shot
  operator runs painful, a Phase 3b can add a transcoding
  service (AWS MediaConvert, GCP Transcoder, or a dedicated
  VM with FFmpeg).
- **Signed URLs / access control.** R2 public-bucket serves
  everything publicly. Fine for the SOS catalog (all public
  datasets). For future private content, swap in a Worker
  in front of R2.
- **Live streaming.** Phase 3 is VOD-only.
- **Image r2: migration.** Phase 1d's import lands images as
  `url:` data_refs pointing at external CDNs. Migrating those
  to R2 is a separate phase.
- **Auxiliary asset migration (thumbnails, legends, SRT captions).**
  Phase 3 touches only the video `data_ref`. The thumbnail /
  legend / caption fields on each catalog row still point at
  NOAA-hosted URLs. Migrating those to
  `datasets/{id}/{thumbnail,legend,caption}.*` in the same R2
  bucket is a Phase 3b-shaped follow-up — needed before
  `/publish` can serve every dataset from a single origin and
  before federation peers can mirror without reaching back to
  noaa.gov. Shape sketched in
  [`docs/CATALOG_ASSETS_PIPELINE.md`](docs/CATALOG_ASSETS_PIPELINE.md)
  §"Legacy auxiliary-asset migration".
- **Vimeo proxy retirement.** Stays running until the migration
  is 100% complete AND has been observed for ≥1 month.
- **4K renditions of already-migrated rows.** The rendition
  decision is at encode time. Re-encoding a row requires
  `rollback-r2-hls` + re-running `migrate-r2-hls`.

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
