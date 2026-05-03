# Federation On-Ramp Scoping — Self-Hosted Fork vs. Install Package

**Status: draft for review.** Scopes the question of how a partner
organisation joins a federated Terraviz network: by forking the
repo (Path A), by installing a versioned runtime artifact (Path B),
or by a hybrid. Evidence is drawn from the repository as of branch
`claude/scope-federation-architecture-pSsvy`, commit `3cff1c4` on
`main`. Companion to
[`../CATALOG_BACKEND_PLAN.md`](../CATALOG_BACKEND_PLAN.md) and
[`../CATALOG_FEDERATION_PROTOCOL.md`](../CATALOG_FEDERATION_PROTOCOL.md).

---

## Reframing — fork-vs-package is the wrong first question

Before getting to the comparison: the framing in the original brief
deserves pushback.

Federation is **fully designed in markdown but not in code.** The
plan documents in `docs/CATALOG_*.md` lay out a 6-phase backend
roadmap with the federation protocol as Phase 4. What ships today
in `functions/api/v1/**` is Phase 1a–1d: the catalog read API,
publisher write API, asset uploads, and a docent search index. The
single line of "federation code" that exists is the well-known
discovery document at `functions/.well-known/terraviz.json.ts:88-92`
which advertises `feed` and `handshake` endpoints that **do not yet
exist** as routes (`grep "federation/feed\|federation/handshake"`
returns three hits, all comments and the well-known doc itself). No
`federation_peers`, `federation_subscribers`, `federated_datasets`,
or `federated_tours` tables exist in `migrations/catalog/` (verified
— the latest migration is `0008_legacy_id.sql`, none mention these).

So the operative question is **not** "which packaging path do we
ship Terraviz nodes through" — it is "what does a Terraviz node
have to be before the packaging question is answerable?" The answer
shapes A and B differently:

- If a node is "a Cloudflare Pages deployment with our specific
  bindings" — which is what it is today — then Path A is the only
  realistic path. Path B is a 6-phase port that doesn't exist.
- If a node is "anything that speaks the federation protocol on
  HTTP" — which is what `CATALOG_FEDERATION_PROTOCOL.md` describes —
  then Path B is plausible, **and so is "any partner can write a
  node in any language."** That changes the question.

This document treats the second framing as load-bearing and
addresses fork-vs-package within it. Section 5 — Hybrid Options —
is where the most likely answer lives.

---

## 1. Current State Assessment

### What Terraviz actually is, today

A TypeScript single-page app (Vite + MapLibre GL JS, vanilla TS, no
framework) that visualises NOAA Science On a Sphere datasets on a
3D globe. Two distribution targets exist today:

1. **Web app on Cloudflare Pages.** Source at `src/**`, Pages
   Functions at `functions/**`, deployed at
   `terraviz.zyra-project.org`. This is the "production" deployment.
2. **Tauri v2 desktop app** for Windows / macOS / Linux. Source at
   `src-tauri/**`, signed and shipped via GitHub Releases by
   `.github/workflows/release.yml`. Adds offline dataset cache,
   local LLM support, and OS-keychain API key storage.

A third channel — a publisher CLI (`bin/terraviz.cjs`,
`cli/terraviz.ts`) — exists for headless dataset publish/update/
retract against the catalog API (`package.json:6` declares
`"bin": { "terraviz": "./bin/terraviz.cjs" }`). It speaks
HTTP+Cloudflare Access service tokens to whichever node is its
target. It is not yet released to npm (no `@zyra/terraviz-cli` on
the registry; the publishing model is documented but unimplemented
in `docs/CATALOG_PUBLISHING_TOOLS.md:328-389`).

There is no Python, no Helm chart, no container image targeting
production deploys. `Dockerfile` at the repo root is a
**developer-environment** image (sets up Node + Rust + Tauri
prereqs and runs `npm run dev`) — not a runtime artifact. There is
no `pyproject.toml`, no `setup.py`, no `Chart.yaml`, no `values.yaml`
(`find . -name 'pyproject.toml' -o -name 'Chart.yaml'` returns
nothing).

### What "self-hosting" means today

[`docs/SELF_HOSTING.md`](../SELF_HOSTING.md) is the canonical
operator path. It describes:

1. Forking the GitHub repo.
2. Connecting the fork to Cloudflare Pages via the dashboard.
3. Manually wiring six bindings in the Cloudflare dashboard
   (D1×2, KV×2, R2, Vectorize, Workers AI, Analytics Engine).
4. Setting Cloudflare Access policies for staff endpoints.
5. Setting build-time `VITE_*` env vars in the Pages dashboard.
6. Running migrations against the production D1.

That is Path A in flight already. It works — `terraviz.zyra-project.org`
is one such instance. But it has three properties that matter
here:

- **It is Cloudflare-only.** Every binding above is a Cloudflare
  primitive. The `wrangler.toml` is documentation; Pages reads
  bindings from the dashboard, not the file (`wrangler.toml:60-63`,
  `docs/SELF_HOSTING.md:83-88` both call this out explicitly).
- **It requires editing source for some operator decisions.**
  `src/services/hlsService.ts:27` and
  `src/services/downloadService.ts:13` hardcode
  `VIDEO_PROXY_BASE = 'https://video-proxy.zyra-project.org/video'`
  — a fork operator using their own video proxy edits source.
  Same with `EARTH_TEXTURE_BASE` (`src/services/photorealEarth.ts:90`)
  and `METADATA_URL` (`src/services/dataService.ts:12`, only
  reachable on the legacy `VITE_CATALOG_SOURCE=legacy` path).
- **It expects the operator to read 6800+ lines of plan markdown.**
  `docs/CATALOG_BACKEND_PLAN.md` (2965 lines), companion docs
  (3844 more lines), plus `SELF_HOSTING.md` (411 lines) and
  `CATALOG_BACKEND_DEVELOPMENT.md` (1199 lines). A domain
  scientist at NOAA won't read this. A platform engineer at a
  partner science museum might.

### What federation looks like in the codebase right now

| Artifact | Status | Evidence |
|---|---|---|
| Federation protocol design | **Complete** (399 lines of spec) | `docs/CATALOG_FEDERATION_PROTOCOL.md` |
| `/.well-known/terraviz.json` route | **Live** | `functions/.well-known/terraviz.json.ts` |
| `node_identity` D1 table | **Live** | `migrations/catalog/0001_init.sql:22-30` |
| `npm run gen:node-key` (Ed25519 keypair) | **Live** | `scripts/gen-node-key.ts` |
| `visibility` column on `datasets` | **Live** (`'public'\|'federated'\|'restricted'\|'private'`) | `migrations/catalog/0001_init.sql:57-58` |
| `data_ref` supports `peer:<node>/<id>` scheme | **Schema-ready, code rejects it** | `migrations/catalog/0001_init.sql:40` lists it; `functions/api/v1/datasets/[id]/manifest.ts:320` says "Phase 4". |
| `/api/v1/federation/feed` route | **Missing** | No file exists. |
| `/api/v1/federation/handshake` route | **Missing** | No file exists. |
| `federation_peers` table | **Missing** | Not in `migrations/catalog-schema.sql`. |
| `federated_datasets` mirror table | **Missing** | Not in `migrations/catalog-schema.sql`. |
| Catalog signing (Ed25519 over response body) | **Missing** | `NODE_ID_PRIVATE_KEY_PEM` is wired through `CatalogEnv` but unused (`functions/api/v1/_lib/env.ts:36`). |
| Frontend "origin badge" / peer filter chip | **Missing** | `src/ui/browseUI.ts` has no peer-aware code. |
| STAC alignment (the wire shape would need to be a STAC Item profile per the plan) | **Missing** | `grep -n "stac\|STAC" functions/api/v1/_lib/dataset-serializer.ts` returns nothing. |

The single architectural piece that does exist for federation —
`/.well-known/terraviz.json` — works as a forward-compatible
placeholder. Federation subscribers can probe a node and read its
identity; the placeholder advertises endpoints that will exist in
Phase 4 (`functions/.well-known/terraviz.json.ts:88-99`, including
the comment "federation goes live in Phase 4").

### Architecture diagram (current and planned)

```
┌──────────────────────── TODAY ────────────────────────┐
│                                                       │
│  Cloudflare Pages deployment                          │
│  ├── /api/v1/catalog       (D1 + KV snapshot)         │
│  ├── /api/v1/datasets/{id}/manifest                   │
│  ├── /api/v1/publish/**    (Cloudflare Access)        │
│  ├── /api/v1/search        (Vectorize)                │
│  └── /.well-known/terraviz.json   ← only "federation" │
│         (advertises feed + handshake endpoints that   │
│          do not exist as routes yet)                  │
│                                                       │
│  Operator path: fork → Cloudflare Pages dashboard →   │
│  six bindings → Access policies → npm run gen:node-key│
└───────────────────────────────────────────────────────┘

┌──────────────────── PLANNED (Phase 4+) ───────────────┐
│                                                       │
│  Node A ──── /.well-known/terraviz.json ────► Node B  │
│                                                       │
│  Node A ──── POST /api/v1/federation/handshake ────►  │
│                                                       │
│  Node A ◄─── GET /api/v1/federation/feed ───── Node B │
│              (signed STAC-like Collection,            │
│               cursor-driven pull, polite cadence)     │
│                                                       │
│  Tables added: federation_peers, federated_datasets,  │
│  federated_tours, dataset_grants                      │
│                                                       │
│  Frontend: origin badge per browse card, peer filter  │
│  chip, "temporarily unavailable" dimming              │
└───────────────────────────────────────────────────────┘
```

### The actual seams in the codebase

- **Wire Dataset shape:** declared in
  `functions/api/v1/_lib/dataset-serializer.ts` (the `WireDataset`
  interface). One source of truth, additive evolution. Already
  carries `origin_node`, `visibility`, `schema_version` columns.
  This is the seam a federation feed would serialise through.
- **Catalog read path:** `functions/api/v1/_lib/catalog-store.ts`
  exposes `listPublicDatasets()` with comments calling out that the
  federation-feed visibility predicate is the same code with one
  line different (`functions/api/v1/_lib/catalog-store.ts:96-109`).
- **Cloud-portability layer:** *planned* under
  `functions/api/v1/_lib/{storage,catalog,kv,video,auth,queue}/`
  per `CATALOG_BACKEND_PLAN.md:2125-2168`, but **not extracted
  today.** Code today calls D1/R2/Stream/KV bindings directly
  through `CatalogEnv`. A future port to Postgres/S3 is bounded
  but not free.
- **CLI:** the `cli/` tree is the most portable thing in the repo.
  Speaks plain HTTP+JSON, depends on no Cloudflare primitives,
  authenticates via Cloudflare Access service tokens (which a
  non-CF node could replace with bearer tokens or OIDC). Already
  shipped end-to-end.

### Mission/roadmap mismatch

[`MISSION.md`](../../MISSION.md) defines the audience as students,
educators, communities, "anyone who wants to understand the planet"
— end-users, not operators or partners. [`ROADMAP.md`](../../ROADMAP.md)
is structured around "reach more people / keep them engaged / code
health" and does not mention federation, catalog backend, or
publishers anywhere (`grep -i "federation\|catalog\|publisher"
ROADMAP.md` returns nothing).

The federation work is documented in `docs/CATALOG_*.md` as a
planning artifact — substantively sized, drafted with care, marked
"Status: draft for review" — but it has not been adopted into the
public roadmap. **This is worth surfacing to Eric explicitly: who
is federation for, and why is it not in `ROADMAP.md`?** The answer
shapes everything below.

---

## 2. Documentation Gap Inventory

| Doc that should exist for federation to be operable | Currently exists? | Location or "missing" | Priority |
|---|---|---|---|
| Federation protocol spec (wire format, signing, handshake, sync) | **Yes — comprehensive** | `docs/CATALOG_FEDERATION_PROTOCOL.md` (399 lines) | P0 done |
| Node operator guide (Cloudflare path) | Partial — covers feedback + telemetry, not catalog or federation | `docs/SELF_HOSTING.md` covers Phases 1–7 of the *original* SPA deploy; the catalog backend's operator section is split into `docs/CATALOG_BACKEND_DEVELOPMENT.md:520-689` ("Production deployment checklist"). | P0 — merge or cross-link |
| Node operator guide (non-Cloudflare path) | **Missing** | Cloud-portability layer is planned in `CATALOG_BACKEND_PLAN.md:2125-2215` as Phase 6 work | P1 if Path B is committed |
| Contributor / development guide | **Yes** | `docs/CATALOG_BACKEND_DEVELOPMENT.md` (1199 lines, walkthrough + CI) | P0 done |
| OpenAPI / JSON Schema for the wire `Dataset` and federation feed | **Missing** | No `*.openapi.*` / `*.schema.json` files. Wire shape lives in TypeScript at `functions/api/v1/_lib/dataset-serializer.ts:WireDataset` and prose in `docs/CATALOG_DATA_MODEL.md`. | P0 — required for any non-TS node |
| Schema reference for `Dataset` / `Tour` | **Yes** | `docs/CATALOG_DATA_MODEL.md` (682 lines) | P0 done |
| STAC mapping document (the plan commits to STAC Item profile) | **Missing** | Promised in `CATALOG_BACKEND_PLAN.md:264-309`; no concrete mapping exists in code or docs | P1 |
| Security & threat model | **Yes** | `CATALOG_BACKEND_PLAN.md:1942-2123` ("Threat model & secrets management") | P0 done |
| Asset pipeline / integrity (`content_digest`) | **Yes** | `docs/CATALOG_ASSETS_PIPELINE.md` (882 lines) | P0 done |
| Publisher CLI reference | **Yes** | `docs/CATALOG_PUBLISHING_TOOLS.md:169-425` | P0 done |
| Upgrade / migration guide between catalog versions | Partial — schema-version evolution is described, but there's no operator-facing "how do I upgrade my fork" doc | `CATALOG_FEDERATION_PROTOCOL.md:326-399`, `CATALOG_DATA_MODEL.md:429-520` ("Schema migration tooling") | P1 |
| Conformance test suite for third-party node implementations | Designed, not built | `CATALOG_BACKEND_DEVELOPMENT.md` references `npm run test:federation` but the script is not in `package.json` | P0 if we want third-party nodes |
| Public CHANGELOG for protocol bumps | **Missing** | Promised at `docs/protocol/CHANGELOG.md` (`CATALOG_FEDERATION_PROTOCOL.md:387-390`); does not exist | P1 |
| `/.well-known/terraviz.json` schema doc | Partial — described in plan, not formalised | `CATALOG_FEDERATION_PROTOCOL.md:15-44`; no JSON Schema file | P1 |

The plan documents are unusually thorough. The gaps are
predominantly around **machine-consumable** specs (OpenAPI, JSON
Schema, STAC mapping, conformance suite) rather than around
prose. That gap is the one Path B has to close to be more than
aspirational.

---

## 3. Path A — Self-Hosted Fork: Scoped Plan

### Required documentation changes

| Change | File | Effort |
|---|---|---|
| Promote federation to the public roadmap or explicitly defer it | `ROADMAP.md` | S |
| Split `SELF_HOSTING.md` into "operator" (run a node) and "fork contributor" (modify and submit upstream) sections; cross-link `CATALOG_BACKEND_DEVELOPMENT.md` for the catalog half | `docs/SELF_HOSTING.md`, `docs/CATALOG_BACKEND_DEVELOPMENT.md` | M |
| Write a `docs/UPSTREAM_MERGE.md` that documents how an operator pulls upstream without losing local config | new doc | M |
| Document the "what to change in your fork" surface explicitly — every hardcoded URL, every dashboard binding, every Access policy. Today the operator finds these by grepping. | new doc, e.g. `docs/FORK_CONFIG.md` | M |
| Federation operator section: `gen:node-key`, well-known doc, future handshake flow when Phase 4 ships | `docs/SELF_HOSTING.md` extension | S |

### Required code changes to make forking sustainable

| Change | File | Effort | Why |
|---|---|---|---|
| Lift hardcoded `VIDEO_PROXY_BASE` into a build-time env var (e.g. `VITE_VIDEO_PROXY_BASE`) with the current default | `src/services/hlsService.ts:27`, `src/services/downloadService.ts:13`, `src/ui/playbackController.ts:241` | S | Today every fork that points at its own proxy must edit source. Same problem as `CATALOG_BACKEND_PLAN.md` constraint #1. |
| Lift `EARTH_TEXTURE_BASE` likewise | `src/services/photorealEarth.ts:90` | S | Same reasoning. |
| Lift `METADATA_URL` (legacy path) likewise or document it as deprecated | `src/services/dataService.ts:12` | S | Mostly dead code post-1d, but a fork operator on `VITE_CATALOG_SOURCE=legacy` still inherits the SOS S3 URL. |
| Surface every binding name as a documented constant or env var with a single grep-able prefix (`TERRAVIZ_*` / `VITE_TERRAVIZ_*`) | various | M | Right now binding names are scattered; an operator who renames `CATALOG_DB` has to grep across `functions/`, `scripts/`, and tests. |
| Wrap the "default upstream" identifiers in `package.json` (`name`, `bin`) so a fork running `npm pack` doesn't accidentally ship as `terraviz` | `package.json` | S | A fork that publishes a CLI package needs its own scope; today there's no story for this. |
| Add `npm run check:fork-config` that fails CI if any of the above defaults are still set on a non-zyra-project deployment | new script | M | Catches "operator forgot to flip a switch" before prod. |

### Estimated effort summary (Path A, doc + code)

| Item | Effort |
|---|---|
| Doc reshuffles (operator vs contributor split, fork-config doc) | M |
| Hardcoded-URL lift to env vars | S |
| Binding-name consolidation | M |
| Fork-config CI check | M |
| Federation operator section (when Phase 4 is implemented) | M |

Total: ~one engineer-fortnight of doc + small refactor work, not
counting Phase 4 federation implementation itself.

### Failure modes for Path A

- **Drift.** A partner forks at `v0.3.1`, customises, then the
  upstream catalog backend ships Phase 1d cutover, Phase 4 federation,
  Phase 5 grants. Each merge gets harder. Partners with shallow
  TypeScript skill abandon their fork at the first conflict.
- **Security patch propagation.** A vuln in `dataService.ts` or in
  the publish middleware is fixed upstream. Forks that haven't
  pulled in three months are exposed. There is no "phone home"
  mechanism — `terraviz.zyra-project.org` does not get a list of
  who is running which fork at which commit, and we wouldn't want
  it to.
- **Schema drift.** A fork that runs Phase 1a + Phase 4-fork-of-the-week
  but missed the migration sequence breaks the conformance test in
  ways its operator cannot diagnose.
- **Cloudflare lock-in.** Forking helps a partner who is
  Cloudflare-friendly. A partner whose IT will not approve a
  Cloudflare account at all (US Federal compliance, EU data residency
  requirements, internal-only deployment) cannot use a fork without
  also doing the entire Phase 6 cloud-portability port. That is
  many person-months of work.
- **Operational expertise required.** Wiring six dashboard bindings,
  setting up Cloudflare Access policies in the right order
  (`SELF_HOSTING.md:241-260` is non-trivial), running D1 migrations
  — this is platform-engineer work. A domain scientist at a partner
  agency cannot do it without staff support.

### Honest assessment of who Path A serves

| Partner type | Path A fit? |
|---|---|
| Zyra Project / first-party operators | **Excellent** — they wrote the plan, they're already on Cloudflare, they want full control. |
| A partner science museum with a software engineer on staff who is comfortable on Cloudflare | **Good** — the SELF_HOSTING.md walkthrough works for them. |
| A NASA / NOAA / academic partner whose IT mandates a non-Cloudflare cloud | **Bad** — they cannot. Phase 6 portability is the prerequisite. |
| A partner who wants to run a node but does not want to maintain code | **Bad** — they can't. Forking *is* the operator path; "no code maintenance" is not on offer. |
| A partner who only wants to *publish* (not host a node) | **Excellent — but via the CLI, not a fork.** The publisher CLI is already the right shape for this audience. |

The last row is significant. The CLI in `cli/terraviz.ts` already
provides the publishing-without-hosting path for partners who want
their data in the catalog but don't care about running a node.
Federation is for partners who want both.

---

## 4. Path B — Install Package: Scoped Plan

### Recommended packaging strategy

The repo today has no Python and no Helm chart. The realistic
artifacts are:

1. **A signed container image** of the Pages Functions runtime,
   targeting a node operator who runs `docker compose up` against
   a Postgres/MinIO/Mux backend. This is the `aws-mediaconvert.ts`
   /  `postgres.ts` / `s3.ts` reference deploy contemplated in
   `CATALOG_BACKEND_PLAN.md:2188-2199`.
2. **An npm package** (`@zyra/terraviz-cli`) for the publisher CLI,
   already designed in `CATALOG_PUBLISHING_TOOLS.md:328-389`. This
   is shippable now with modest effort and **decouples publishing
   from hosting** — a strictly smaller problem than full federation.
3. **A "Cloudflare template"** — a one-click GitHub-template fork
   that a partner can use to provision a Cloudflare deployment from
   a wizard. Bridges Path A and Path B for the Cloudflare-friendly
   case.

Helm/pip are not the right answer because there is nothing Pythonic
in the codebase and the only "process" that needs Helm is the
hypothetical containerised node. A container image alone is enough;
Helm is value-add only for partners who already run Kubernetes.

### Required code refactors to expose a stable surface

| Refactor | Where | Effort |
|---|---|---|
| Extract storage / catalog / kv / video / auth / queue interfaces under `functions/api/v1/_lib/{storage,catalog,kv,video,auth,queue}/` per `CATALOG_BACKEND_PLAN.md:2125-2168` | new | **L** |
| Implement Postgres + S3 + (Mux or self-hosted ffmpeg) reference adapters | new | **L** |
| Replace the Cloudflare Access dependency with an interface (`auth/authProvider.ts`) so a non-CF node can plug in OIDC or bearer tokens | new | M |
| Make every URL a configurable env var (covers Path A's code changes too) | various | S |
| Replace Workers Analytics Engine writes with a portable analytics adapter — or document AE-portability as a non-goal for non-CF nodes | `functions/api/ingest.ts` and call sites | M |
| Rewrite `wrangler.toml`-bound entry points as a runtime-agnostic Hono / Fastify server, then provide a Pages Functions wrapper | new entry point, retain `functions/` for CF | **L** |
| Provide a `docker-compose.yml` that brings up Postgres + MinIO + the new entry point against a seeded catalog | new | M |
| Pin the wire `Dataset` shape in JSON Schema, generated from the TypeScript types (`json-schema-to-typescript`/`zod`) | new build step | M |
| Pin the federation feed shape in JSON Schema | new | M |
| Generate an OpenAPI 3.1 spec from the route handlers | new build step | M |

### Required protocol/spec work

| Item | Effort | Note |
|---|---|---|
| Implement Phase 4 federation (handshake / feed / webhook routes, `federation_peers`/`federated_datasets` migrations, signing) | **L** | This is the prerequisite — no federation = no nodes to package. |
| Land STAC Item profile mapping in `dataset-serializer.ts` | M | Promised in `CATALOG_BACKEND_PLAN.md:279-309`; not done. |
| Build the conformance test harness (`npm run test:federation`) | M | Two-Wrangler-instance handshake test described in `CATALOG_BACKEND_DEVELOPMENT.md`. |
| Publish JSON Schema + OpenAPI to a versioned URL (e.g. `https://terraviz.org/schema/v1/`) so independent implementers can write a node in any language | M | The "anyone in any language" win that makes Path B genuinely federation-shaped. |
| Create `docs/protocol/CHANGELOG.md` and the version-bump discipline | S | Promised in `CATALOG_FEDERATION_PROTOCOL.md:387-390`. |

### Required release infrastructure

- **Container image build & sign in CI.** Probably reuse the
  existing `release.yml` pattern (Tauri release uses signed
  artifacts; same model fits OCI signing via cosign).
- **Container registry choice.** GHCR is the obvious default — the
  desktop release already uses GitHub Releases. Alternative is
  Docker Hub, but GHCR keeps the trust root in the same place.
- **Versioning + deprecation policy.** Already specified in
  `CATALOG_BACKEND_PLAN.md:744-862` ("Versioning & deprecation").
  Discipline, not new code.
- **Release notes per migration.** Required because operators
  upgrading a node will need to know which migrations apply.

### Effort summary (Path B)

| Item | Effort |
|---|---|
| Phase 4 federation implementation | L |
| Cloud-portability layer extraction | L |
| Postgres / S3 / Mux reference adapters | L |
| Auth provider interface + OIDC / bearer adapter | M |
| Portable analytics adapter (or scoped non-goal) | M |
| Container image + compose file + reference deploy | M |
| OpenAPI / JSON Schema generation + publication | M |
| STAC profile mapping | M |
| Conformance test harness | M |
| npm package for the publisher CLI | S |

Total: many person-months. The plan implicitly acknowledges this —
"Cloud-portability layer" is *Phase 6*, after federation, after
auth, after publisher portal. The portable container image is not
an early shippable.

### Minimum viable node config example

What an operator's `terraviz-node.yaml` might look like under Path B.
The shape below is *unverified* — it does not match anything in the
current repo (today's config surface is `.dev.vars`/wrangler bindings,
not a single YAML). I'm sketching what it *should* be if Path B is
serious, derived from `CatalogEnv` (`functions/api/v1/_lib/env.ts`)
+ the federation protocol's well-known doc:

```yaml
# terraviz-node.yaml — operator config for a self-installed node
node:
  display_name: "Mars Climate Center"
  base_url:     https://terraviz.marsclimate.org
  contact:      ops@marsclimate.org
  abuse_contact: abuse@marsclimate.org

# Generated once via `terraviz node init`. Stored as a single
# base64-DER PKCS8 line — the gen-node-key tool already produces
# this shape (scripts/gen-node-key.ts).
identity:
  ed25519_private_key_file: /etc/terraviz/node-private.key

# Storage — concrete adapters chosen per-deployment.
catalog:
  driver:   postgres
  url:      postgres://terraviz@db:5432/catalog
storage:
  driver:   s3
  endpoint: https://minio.internal
  bucket:   terraviz-assets
  access_key_id_file:     /run/secrets/s3_access_key
  secret_access_key_file: /run/secrets/s3_secret_key
video:
  driver:   mux                 # or stream | self-hosted-ffmpeg
  api_token_file: /run/secrets/mux_token
auth:
  driver:   oidc                # or cf-access | bearer
  issuer:   https://sso.marsclimate.org
  audience: terraviz-node

# Federation — fully optional. A node with no peers is just a
# self-hosted catalog.
federation:
  enabled: true
  peers:
    - base_url:  https://sos.noaa.example
      cadence_minutes: 30
      asset_proxy_policy: proxy_lazy
```

That is **31 lines** including blanks and comments — flagging,
per the brief, that 20 was the suggested cap. The drivers
(`catalog.driver`, `storage.driver`, `video.driver`, `auth.driver`)
are what makes it longer than 20. I think those four lines are
load-bearing and I would not collapse them. If a single node is
constrained to one driver per role and the driver is implicit in
the container image, the YAML drops to ~22 lines. Either way, the
shape is **flat, non-nested-deeply, and grep-able**, which is the
property that matters.

---

## 5. Hybrid Options

### Hybrid 1 — Container reference + open protocol spec

**The idea.** Ship the Cloudflare deployment as the canonical
implementation (Path A for first-party + Cloudflare-friendly
partners). Ship the federation protocol as a versioned, conformance-
tested open spec (`/schema/v1/`, `docs/protocol/CHANGELOG.md`,
JSON Schema + OpenAPI). Anyone — partner, third party, future fork —
can implement a node in any language as long as they pass the
conformance suite. We do not commit to building a container image
ourselves; we commit to making it *possible* for someone else to.

**Win.** Decouples "who builds nodes" from "who maintains the
canonical implementation." The hard work is the spec + conformance
suite, both of which are already partially designed in
`CATALOG_FEDERATION_PROTOCOL.md` and `CATALOG_BACKEND_DEVELOPMENT.md`.
Partners with non-Cloudflare constraints can write their own node
without us porting.

**Cost.** A spec is a contract. Once published, breaking it costs
more than today, and the protocol-versioning discipline in
`CATALOG_FEDERATION_PROTOCOL.md:326-399` becomes load-bearing.
Conformance suite has to be maintained. We are explicitly
not promising a container image — partners with no engineering
capacity at all are still left out.

### Hybrid 2 — Publisher decoupling, defer hosting decision

**The idea.** Ship the publisher CLI to npm and as signed binaries
*now* (`@zyra/terraviz-cli`, plus the per-platform standalone
binaries already designed in `CATALOG_PUBLISHING_TOOLS.md:353-389`).
Decouple "publish to a Terraviz catalog" from "host a Terraviz
catalog." A partner agency that just wants their data visible
publishes via the CLI against the canonical
`terraviz.zyra-project.org` node; they don't run a node at all.

**Win.** Solves the most common partner case (a partner agency with
data) without solving federation. Ships in weeks, not quarters.
Tests one piece of the API surface — the publisher API — under
real third-party load before federation. Most partners *will* turn
out to want this, not federation.

**Cost.** Doesn't solve the federation case at all — partners who
do need to run a node, for sovereignty or audience reasons, still
wait for Path B. Centralises moderation responsibility on the Zyra
operator until proper federation lands.

### Hybrid 3 — Fork-the-monorepo + opt-in container reference

A third option to keep on the table: keep Path A as the primary
operator path, but ship a *minimal* containerised version of the
catalog backend (no Stream, no Vectorize — just the `/api/v1/catalog`
read API, federation feed, and well-known doc) as a "lightweight
peer" appliance. Partners who only need to *serve* a small catalog
and *consume* federated data, without running their own publisher
portal or asset pipeline, get a small box. Partners who need the
full thing fork.

This trades scope for shippability. The full Cloudflare deployment
remains canonical; the container is a federation-only peer.

---

## 6. Recommendation

**Adopt Hybrid 2 first, then Hybrid 1, never adopt Path B as
designed.**

### Why

1. **Federation is not yet code.** Path B as a packaging decision
   ahead of Phase 4 is sequenced wrong. There is no node to
   package.
2. **Most partners are publishers, not operators.** The MISSION
   audience is end-users; the partner audience that the
   `CATALOG_*` plans actually contemplate (NOAA / Zyra pipelines,
   partner research orgs running scheduled visualisation jobs) is
   *publisher-shaped*, not operator-shaped. The CLI already exists
   for this. Shipping the CLI to npm + signed binaries solves the
   partner-on-ramp question for the largest realistic cohort.
3. **The federation protocol design is good enough to publish as a
   spec, but not yet implemented.** The right next step for the
   federation question is to finish Phase 4 against the
   *Cloudflare reference implementation* and **publish the
   protocol with conformance tests**. That is Hybrid 1. Anyone
   who needs to run a non-Cloudflare node can then implement
   against the spec; we don't have to port to Postgres ourselves
   ahead of demand.
4. **Path B-as-designed (Cloud-portability layer + reference
   adapters) is Phase 6 work.** That is honest in the existing
   plan. Promoting it ahead of where it is is many person-months
   for no proven partner request.
5. **Path A is what we have.** Self-hosting a fork on Cloudflare
   already works. Putting effort into making Path A *cleaner*
   (lift hardcoded URLs to env vars, split operator vs contributor
   docs, add a fork-config CI check) is the cheap win that retires
   most of the "fork is awkward" complaints without committing to
   Path B.

### The smallest first step — what could ship in two weeks

1. Pick **one real partner** that wants to publish data to
   Terraviz but does not want to host a node. Internal pilot is
   fine — Zyra-internal pipeline counts.
2. Ship the publisher CLI to npm as `@zyra/terraviz-cli` with
   signed releases per `CATALOG_PUBLISHING_TOOLS.md:328-389`.
   The CLI works against the canonical
   `terraviz.zyra-project.org` node today.
3. Have that partner's pipeline run `terraviz publish dataset.yaml`
   on a schedule. Treat the resulting friction (auth ergonomics,
   schema validation errors, asset upload edge cases) as the
   feature work that gates the next decision.
4. **Decide** whether to invest further in federation (Phase 4)
   or in publisher portal polish (Phase 3) based on what that one
   partner actually asks for next.

This validates "publisher" is the right partner cohort without
committing to anything heavier. If the pilot partner asks for
their own node, that's the federation green light. If they don't,
Path A + the published CLI is the delivery vehicle for years.

---

## 7. Open Questions for Eric

These items couldn't be resolved from the repo alone.

1. **Who is federation actually for?** `MISSION.md` and
   `ROADMAP.md` describe an end-user product. `docs/CATALOG_*.md`
   describe a publisher-and-operator platform. Federation appears
   in the platform doc, not the public roadmap. **Is there a real
   partner asking to run a Terraviz node, or is federation a
   capability we want to *be ready for* but not lead with?** The
   answer changes everything below.
2. **Is "fork the monorepo" still acceptable for Phase 1d
   operators?** The current SELF_HOSTING.md path works for
   Cloudflare-friendly partners with platform engineers. If we
   are seeing partners bounce off it, that's signal Path A needs
   investment. If not, Hybrid 2 + Hybrid 1 is enough.
3. **Cloudflare lock-in tolerance.** Are we comfortable telling
   partners "Terraviz nodes run on Cloudflare; if you can't run
   on Cloudflare, you can't run a node — but you can still
   publish to ours via the CLI"? That's the honest position
   today. Confirming or rejecting it sets the priority of the
   cloud-portability layer.
4. **Is the publisher CLI really shippable today?** The CLI is in
   `cli/terraviz.ts`, has tests, and is documented as Phase 1a.
   But it auths via Cloudflare Access service tokens, which mean
   a partner publishing to our node needs *us* to mint them a
   service token. Does that flow work today, or is there an
   onboarding gap before the CLI becomes a real on-ramp?
5. **STAC alignment status.** The plan commits to a STAC Item
   profile (`CATALOG_BACKEND_PLAN.md:264-309`). The serializer
   does not implement it. Is that pending Phase 4, or has it
   slipped? The answer affects how third-party tools (Google
   Dataset Search, scientific catalogs) consume our data.
6. **Headcount for Phase 4 federation.** The plan does not
   commit to timelines, but Path B's recommendation depends on
   federation actually shipping. What is the realistic ETA?
   Quarters or years?
7. **What's the "directory" story?** The federation protocol
   contemplates an opt-in directory (`CATALOG_FEDERATION_PROTOCOL.md:255-294`)
   without committing to running one. If we ship Hybrid 1, do we
   stand up a reference directory, or wait for one to emerge?
8. **Trademark and identity.** A fork ships as "Terraviz" by
   default (`package.json:2`, `bin/terraviz.cjs`, the desktop app
   bundle). At what point does a partner running their fork as
   their own brand need a renaming story? `package.json` has no
   guidance for this today.
9. **"Restricted" and "private" visibility states are in the
   schema** (`migrations/catalog/0001_init.sql:57-58`) **but
   gated behind grants that are Phase 5 work.** Are partner
   agencies likely to need restricted federation (sharing with
   specific peers only) before Phase 5? If so, that's a higher
   priority than Path B-as-designed.

---

## Appendix — Evidence Index

Files cited or read for this scoping:

- `package.json` — distribution manifest, scripts, deps
- `wrangler.toml` — Cloudflare bindings (documentation only)
- `Dockerfile`, `docker-compose.yml` — dev-environment image, not runtime
- `bin/terraviz.cjs`, `cli/terraviz.ts`, `cli/commands.ts`, `cli/lib/*` — publisher CLI
- `functions/.well-known/terraviz.json.ts` — federation discovery (only fed code that exists)
- `functions/api/v1/catalog.ts`, `functions/api/v1/_lib/env.ts`, `_lib/dataset-serializer.ts`, `_lib/catalog-store.ts` — catalog read API
- `functions/api/v1/datasets/[id]/manifest.ts` — manifest endpoint, hardcodes Phase 4 deferrals
- `functions/api/v1/publish/**` — publisher API
- `migrations/catalog/0001_init.sql`–`0008_legacy_id.sql`, `migrations/catalog-schema.sql` — schema as actually applied
- `scripts/gen-node-key.ts`, `scripts/seed-catalog.ts` — node setup tooling
- `src/services/dataService.ts:12`, `hlsService.ts:27`, `downloadService.ts:13`, `photorealEarth.ts:90` — hardcoded URL surfaces
- `src/services/catalogSource.ts` — `VITE_CATALOG_SOURCE` switch
- `.env.example`, `.dev.vars.example` — current operator config surface
- `docs/CATALOG_BACKEND_PLAN.md` (2965 lines), `CATALOG_FEDERATION_PROTOCOL.md` (399), `CATALOG_DATA_MODEL.md` (682), `CATALOG_ASSETS_PIPELINE.md` (882), `CATALOG_PUBLISHING_TOOLS.md` (682), `CATALOG_BACKEND_DEVELOPMENT.md` (1199)
- `docs/SELF_HOSTING.md` (411 lines) — current operator path
- `MISSION.md`, `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`
- `.github/workflows/ci.yml`, `release.yml` — CI/CD (no container build step exists)
