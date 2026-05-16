# Catalog Image-Sequence Upload Plan

How publishers upload a stack of individual frames (PNG / JPEG / WebP)
as the source for a video dataset, instead of having to first assemble
them into an MP4 file. Companion to
[`CATALOG_ASSETS_PIPELINE.md`](CATALOG_ASSETS_PIPELINE.md) (which
documents the MP4-input video pipeline) and
[`CATALOG_PUBLISHING_TOOLS.md`](CATALOG_PUBLISHING_TOOLS.md) (which
documents the publisher portal); UX conventions inherited from both.

> **Status: draft for review.** Design sketched in response to a
> Phase 3pd review thread; no implementation work has started. The
> implementation lands in a separate PR after PR #112 (Phase 3pd)
> merges. Tracking issue:
> [zyra-project/terraviz#114](https://github.com/zyra-project/terraviz/issues/114).

---

## Motivation

The Phase 3pd asset uploader covers two upload shapes today:

| Shape | Path | Pipeline |
|---|---|---|
| Single image (PNG/JPEG/WebP) | `r2:datasets/{id}/by-digest/sha256/{hex}/asset.{ext}` | Direct `data_ref` write at `/complete` time. No transcode. |
| Single video (MP4) | `r2:uploads/{id}/{upload_id}/source.mp4` → ffmpeg → `r2:videos/{id}/{upload_id}/master.m3u8` | `repository_dispatch` → GHA workflow → 4K/1080p/720p HLS ladder → `/transcode-complete`. |

Many real catalog datasets originate as numbered frames, not as a
single MP4 file. Model output dumps one PNG per simulation step;
real-time observation pipelines write one image per hour; rendered
animations from external tools land as `frame_*.png` directories.
Publishers today have to first stitch those frames into an MP4 (with
ffmpeg, locally, getting the frame rate / pixel format / colour space
right) before they can upload — a step that turns a 30-second portal
interaction into an afternoon's work and frequently produces sources
the catalog's transcoder then has to re-encode anyway.

The catalog already runs ffmpeg in GitHub Actions for every video
upload. ffmpeg accepts numbered image sequences as input just as
readily as a single MP4 file (the same `encodeHls` ladder applies),
so the pipeline-side change is small: branch the runner on the
dispatch payload, point ffmpeg at a numbered glob, leave the rest of
the encoding pipeline alone. The bulk of the work is on the
publisher-portal upload UX.

## Goals

1. A publisher with a directory of `frame_00001.png … frame_00240.png`
   on their disk can drag them all into the uploader, see them encoded
   into the same HLS ladder the MP4 path produces, and end up with a
   playable video dataset — no local ffmpeg step.
2. The pipeline reuses the existing per-upload R2 key versioning,
   `active_transcode_upload_id` binding (migration 0012), and
   `/transcode-complete` callback — image-sequence uploads inherit
   every concurrency / safety property the MP4 flow already has.
3. The MP4 upload flow is unchanged. Publishers with an existing MP4
   keep using the current single-file picker.
4. **Frames are first-class data, not transcoder scratch.** The
   source frames are kept in R2 permanently for the transcode
   pipeline's own purposes (per-upload versioning protects an
   already-published row from re-upload races). The same bytes
   are surfaced through the public manifest API, the Orbit chat
   assistant, and the search index so consumers can fetch
   individual frames for display, download, or analysis — not
   just play the HLS bundle. See [§Frames as data](#frames-as-data)
   below.

## Non-goals

- **Real-time append** (adding a single new frame to an existing
  dataset without re-uploading the rest). Sketched in
  [§Phase 2](#phase-2--real-time-append-deferred) below for the
  record, deliberately not scheduled. Publishers with hourly model
  output use the batch flow and re-upload the growing frame set —
  R2 storage and re-encode cost are both cheap enough that this is
  acceptable for v1, and the actual real-time UX needs more design
  room than we have here.
- **Audio.** Image sequences are silent. Publishers wanting audio
  use the MP4 path.
- **Mixed inputs in a single dataset.** A row is either an MP4-source
  video or an image-sequence-source video; switching between them is
  a re-upload.
- **Drag-to-reorder.** v1 sorts the picked files lexicographically
  with a "Frame order" text field for publishers whose filenames
  don't naturally sort. Manual reordering of 240 thumbnails is a UX
  rabbit hole worth deferring.

---

## Phase 1 — Batch image-sequence upload

The initial slice. Everything below ships in one PR; estimate is 6–8
focused commits, mirroring the 3pa–3pd sub-phase letter convention.

### User story

> A NOAA / GFDL publisher has run a 10-day ocean model. Output is one
> 4096×2048 PNG per timestep, 240 frames, in a single directory on
> their laptop. They open the publisher portal, click the new
> "Upload frames" button on the dataset's edit page, multi-select
> the 240 files, watch a progress bar tick up, navigate away. Five
> minutes later they come back to a playable HLS video at 24 fps,
> served from the catalog like any other video dataset.

### UX sketch

A new picker mode in `src/ui/publisher/components/asset-uploader.ts`,
mounted alongside the existing single-file picker as a tabbed
choice — "Upload MP4" vs. "Upload frames". The frame picker shows:

- File-picker accepting `image/png`, `image/jpeg`, `image/webp` with
  the `multiple` attribute on the `<input type="file">`.
- A small thumbnail strip rendering the first ~20 picked files (lazy,
  via object URLs) so the publisher sees what they're about to
  encode. The strip is read-only in v1.
- A "Frame rate" select with 1, 5, 10, 12, 24, 30 fps options.
  Defaults to 24. Real-time data typically wants ≤ 5; animations
  want 24/30. The runner forwards this to ffmpeg.
- A "Frame order" select: **Lexicographic by filename** (default) or
  **Manual** (a textarea where the publisher pastes a newline-
  separated filename list in encode order).
- A **"Filename mask"** text input — optional. Strftime-style
  pattern that describes how to construct each frame's display
  name from its index + the dataset's `start_time` / `period`.
  Examples:
  - `sst_anomaly_%Y%m%d.png` — daily, date-stamped
  - `precip_%Y-%m-%dT%H:%MZ.png` — hourly, datetime-stamped
  - `model_run20260101_step_%i.png` — pure sequence, no time component (`%i` is the zero-padded index)
  - (blank) — fall back to `frame_%05d.{ext}` for display

  The mask is for **discovery** and **display** — the actual R2
  bytes always live at the sequential `frames/{NNNNN}.{ext}` key.
  The publisher form auto-suggests a mask by inspecting the first
  picked filename for `\d{8}` / `\d{4}-\d{2}-\d{2}` patterns and
  asking "does this date format describe every frame?"
- The existing per-file progress / status line surface, scaled to a
  single aggregate progress bar that ticks as each frame finishes
  PUT-ing.

### Browser-side flow

Mostly the same shape as the MP4 flow, just batched:

1. **Hash each frame.** Reuse `hashFileSha256()` from
   `asset-uploader.ts` — it already chunks the input via
   `@noble/hashes`, so 240 calls in a loop costs roughly what a
   single 5 GB MP4 hash costs today. ~30 s on a typical laptop for
   240 × 4K PNG. Surface as a "Hashing 47/240…" status while it
   runs.
2. **`POST /asset` once with the frame manifest.** Body shape:
   ```json
   {
     "kind": "data",
     "mime": "image-sequence/png",
     "size": <sum of all frame sizes in bytes>,
     "frames": [
       { "filename": "frame_00001.png", "digest": "sha256:…", "size": 4123456 },
       { "filename": "frame_00002.png", "digest": "sha256:…", "size": 4119872 },
       …
     ],
     "frame_rate": 24
   }
   ```
   The server validates the shape (≤ 10 GB sum, every digest valid,
   every mime consistent with the declared sequence mime, max ~10000
   frames as a sanity cap), mints an `asset_uploads` row with
   `kind='data'` + a new column `frame_count`, and returns:
   ```json
   {
     "upload_id": "01HX…",
     "target": "r2",
     "frames": [
       { "filename": "frame_00001.png",
         "url": "<presigned>",
         "key": "uploads/{dataset_id}/{upload_id}/frames/00001.png",
         "headers": {…} },
       …
     ],
     "expires_at": "…",
     "mock": false
   }
   ```
   The server-assigned position (the `00001.png` index in the R2
   key) is what ffmpeg will use as the encode order — derived from
   the publisher's chosen sort. The original filenames are
   preserved on the asset_uploads row for the audit trail.
3. **Direct upload, parallel-but-bounded.** A small in-browser worker
   queue (target: 5 concurrent PUTs at a time) walks the `frames`
   array. Each frame's progress feeds an aggregate counter rather
   than its own bar — 240 progress bars would be unusable. Stage
   string reads "Uploading 47/240…".
4. **`POST .../{upload_id}/complete`.** Same endpoint as the MP4
   flow — no body — fires after the last frame PUT resolves 200.
   The server HEAD-checks every frame key in R2 (parallel, well
   under the CPU cap for the typical few-hundred-frame case),
   trusts the per-frame digest claims (same trade as the MP4 flow:
   the runner re-hashes streaming before encoding), stamps
   `transcoding=1` + `active_transcode_upload_id = uploadId`, and
   fires the dispatch with a different payload shape:
   ```json
   {
     "dataset_id": "…",
     "upload_id":  "…",
     "frame_count": 240,
     "frame_rate": 24,
     "source_kind": "frames",
     "source_digest": "sha256:…"
   }
   ```
   No `source_key` (it's a directory now, not a file). The runner
   reconstructs the key prefix from the route id + upload id, same
   way `/transcode-complete` reconstructs `data_ref`.

### Server-side changes

| File | Change |
|---|---|
| `migrations/catalog/0013_asset_uploads_frame_count.sql` | New migration. `ALTER TABLE asset_uploads ADD COLUMN frame_count INTEGER`. NULL for non-sequence uploads. |
| `migrations/catalog/0014_datasets_frame_metadata.sql` | New migration. Adds `frame_count INTEGER` (mirror of asset_uploads.frame_count, persisted on the dataset row so the manifest serializer doesn't have to join), `file_name_mask TEXT` (the publisher-supplied strftime pattern), and `frame_source_filenames_ref TEXT` (R2 key of an auxiliary JSON blob listing the original picked filenames in encode order, for the audit trail and the "what was this frame called on disk?" debug case). NULL on every non-sequence row. |
| `functions/api/v1/_lib/asset-uploads.ts` | `validateAssetInit` learns the `image-sequence/*` mime family; new helper `validateImageSequenceInit` returns `{ frames: ValidatedFrame[], frame_rate, frame_count, file_name_mask }`. New `insertAssetUploadWithFrames` persists `frame_count` alongside the existing row. The mask validator rejects unsafe substitution tokens (no `%n`, no shell metacharacters) and caps the rendered length at 255 chars. |
| `functions/api/v1/_lib/r2-store.ts` | `buildFrameKey(datasetId, uploadId, index)` → `uploads/{ULID}/{ULID}/frames/{NNNNN}.{ext}`. `isFrameSequencePrefix(key)` tells the `/complete` handler "this upload is a sequence, HEAD every frame, fire the `frames` dispatch shape". `buildFrameSourceFilenamesKey(datasetId, uploadId)` → `uploads/{ULID}/{ULID}/source_filenames.json`. |
| `functions/api/v1/_lib/github-dispatch.ts` | `TranscodeDispatchPayload` becomes a union: `{ kind: 'video', source_key, source_digest }` or `{ kind: 'frames', frame_count, frame_rate, source_digest, file_name_mask }`. The runner branches on `kind`. |
| `functions/api/v1/publish/datasets/[id]/asset.ts` | Returns the `frames: [...]` array of presigned URLs when the body declares an image-sequence mime. Also returns a presigned PUT for the source-filenames JSON blob. |
| `functions/api/v1/publish/datasets/[id]/asset/[upload_id]/complete.ts` | Branches on the upload's `frame_count` column: video-source uses the existing HEAD-on-`source.mp4` path; frame-sequence parallel-HEADs every frame key, then writes `datasets.frame_count` + `datasets.file_name_mask` + `datasets.frame_source_filenames_ref` in the same batch as `transcoding=1`. Same `transcoding_in_progress` 409 from migration 0012 covers overlapping dispatches; same compensating revert on dispatch failure. |
| `functions/api/v1/publish/datasets/[id]/transcode-complete.ts` | Unchanged. The callback contract is "the workflow finished writing the HLS bundle"; the runner branch decides how the bytes got there. The frame-metadata columns are already on the row by the time the callback fires. |

### GHA runner changes

The runner gains an image-sequence input branch in
`cli/transcode-from-dispatch.ts`:

1. New flags: `--frame-count`, `--frame-rate`, `--source-kind`. The
   `--source-key` flag becomes optional and is replaced by a
   reconstructed prefix when `--source-kind=frames`.
2. Download all N frames from R2 (concurrent with a small queue —
   ~10 parallel S3 GETs is comfortable on the runner; same shape
   as the browser upload queue), validating each frame's SHA-256
   against the manifest as it lands.
3. Invoke ffmpeg with:
   ```
   ffmpeg \
     -framerate <fps> \
     -i 'frames/%05d.png' \
     -c:v libx264 -preset slow -crf 22 \
     -pix_fmt yuv420p \
     -hls_time 6 -hls_playlist_type vod \
     …
   ```
   instead of `-i source.mp4`. The rest of the ladder
   (`encodeHls`, `uploadHlsBundle`) is unchanged.
4. Post back to `/transcode-complete` exactly as today.

Exit codes pick up one more: `6 — frame fetch failed` (per-frame
download or per-frame digest mismatch).

### R2 layout

```
r2:uploads/{dataset_id}/{upload_id}/frames/00001.png
r2:uploads/{dataset_id}/{upload_id}/frames/00002.png
…
r2:uploads/{dataset_id}/{upload_id}/frames/00240.png
r2:videos/{dataset_id}/{upload_id}/master.m3u8        # produced by ffmpeg, same as MP4 path
r2:videos/{dataset_id}/{upload_id}/4k/index.m3u8
…
```

Per-upload-id versioning keeps a re-upload from clobbering frames
the prior workflow may still be reading — same property the MP4
flow shipped in 3pd-review3/A. The `frames/` subdirectory keeps
the source frames distinguishable from any future per-upload
auxiliary asset (the catalog doesn't currently use any, but the
layout leaves room).

### Sub-phase breakdown — Phase 1 ingest

The breakdown follows the 3p`<letter>` convention 3pa–3pd used; sub-
phase letters consume the next free slot under Phase 3.

| Sub-phase | Demoable result | Notes |
|---|---|---|
| **3pe/A** — Migrations 0013 + 0014 + asset-uploads helpers | `frame_count` column lands on asset_uploads; `frame_count`, `file_name_mask`, `frame_source_filenames_ref` land on datasets. `validateImageSequenceInit` rejects malformed manifests + unsafe masks. `buildFrameKey` / `isFrameSequencePrefix` / `buildFrameSourceFilenamesKey` exported and unit-tested. No portal UI yet; exercised via `curl` + manual presigned-PUT. | Worker-side scaffolding; nothing user-visible yet. |
| **3pe/B** — `/asset` + `/complete` image-sequence branches | Multi-frame mint + HEAD-all + dispatch. Writes the dataset-row frame-metadata columns in the same batch as `transcoding=1`. Reuses 0012's `transcoding_in_progress` guard automatically. Tested wire-level with the same fixture style 3pd used. | Server-side complete; tested against a synthetic 5-frame fixture. |
| **3pe/C** — GHA runner branch + new dispatch payload union | `transcode-from-dispatch.ts` learns `--source-kind=frames`, downloads + verifies frames, runs the image-sequence ffmpeg command, posts the unchanged `/transcode-complete`. Stage-specific exit codes extend to 6. | Runs end-to-end against a real R2 + GHA. The integration test that 3pd deferred to the GHA runner stays GHA-only. |
| **3pe/D** — Portal multi-file uploader | Tabbed picker in `asset-uploader.ts`, parallel-bounded XHR queue, aggregate progress, frame-rate + ordering controls, **filename-mask input with auto-suggest**. Lexicographic sort by default; "Manual order" textarea fallback. | Bulk of the UX work. New locale keys under `publisher.assetUploader.frames.*`. |
| **3pe/E** — Operator docs | CHANGELOG entry, `SELF_HOSTING.md` walkthrough for the new locale strings + the `image-sequence/*` mime allow-list, `CATALOG_ASSETS_PIPELINE.md` + `CATALOG_PUBLISHING_TOOLS.md` cross-references promoted from this plan doc into the canonical surface. | Pattern from 3pd/F — operator-facing doc sweep at the end of the chain. |

3pe/A–E close out the upload half. The frame-as-data half lives in
its own sub-phase letter slot (`3pf/A`–`3pf/F` below).

### Cost model

- R2 storage: dominated by the bundle, not the source frames. A 240-frame
  4K PNG stack averages ~30 MB/frame for diverse content, ~7 GB total;
  the produced HLS ladder lands at ~25 Mbps × 10 s = ~31 MB master
  rendition plus the lower-bitrate variants, ~50 MB total. The source
  frames stay in R2 indefinitely under the same prefix (no lifecycle
  rule today; future cleanup is a Phase 4 concern same as MP4 sources).
- GHA runtime: roughly the same as the MP4 flow at the same output
  duration — ffmpeg's image-sequence input isn't measurably slower
  than file input. The download step grows from 1 ~5 GB GET to 240
  ~30 MB GETs, which the AWS S3 client parallelises to roughly the
  same wall-clock time.
- Browser memory: 240 PNG hashes via `hashFileSha256` chunks at
  8 MB → peak ~10 MB while hashing; the picked `File` objects stay
  in the picker but aren't decoded into memory unless they appear
  in the visible thumbnail strip (cap that strip at ~20 thumbs).

---

## Frames as data

Per-upload prefix versioning already keeps the source frames in R2
permanently — that's what protects a still-transcoding row from a
clobbering re-upload. The frames are sitting there anyway. The
question this section answers is *what else do we want to do with
them*.

Three consumer surfaces:

1. **Public manifest API** — clients (the SPA, federated peer
   appliances, the `terraviz` CLI) can enumerate the frames of
   any image-sequence dataset they have visibility on and fetch
   a specific frame by index or by time.
2. **Orbit (the AI docent)** — Orbit can answer "show me the SST
   anomaly for May 16" by computing the frame index from the
   dataset's `start_time` + `period` and emitting a load marker
   the chat UI renders as an inline button.
3. **Search** — the textual `file_name_mask` joins the search
   corpus so a phrase like "daily SST anomaly" surfaces the
   dataset; a structured `?time_range=` filter walks the
   timeline so "datasets with frames in May 2026" works without
   indexing every single frame.

The marginal storage cost is zero (frames already permanent), the
marginal R2 egress cost is consumer-driven (Restricted-visibility
rows mint short-lived presigned GETs to keep that bounded), and
the marginal complexity is mostly serializer + LLM-prompt work.

### Wire shape

The manifest serializer (`serializeDataset` in
`functions/api/v1/_lib/dataset-serializer.ts`) gains a `frames`
field on the wire dataset, populated only when
`row.frame_count != null`:

```ts
interface WireDatasetFrames {
  /** Total frame count after the most recent transcode. */
  count: number
  /** Strftime-style display pattern. Optional — when absent,
   *  consumers should display `frame_{index:05d}` as the
   *  fallback filename. */
  fileNameMask?: string
  /** Resolver pattern. Substitute `{index}` for the zero-padded
   *  frame number (5 digits today; widen later if frame_count
   *  caps grow past 99999). Pre-resolved to the bucket's public
   *  base URL by `resolveAssetRef` so the SPA can fetch the
   *  bytes directly without going through a Worker. For
   *  Restricted rows the manifest endpoint returns a signed
   *  prefix instead and the consumer rebuilds per-frame URLs
   *  by index substitution. */
  urlTemplate: string
  /** ISO8601 timestamp of frame 0. Mirrors the existing
   *  `startTime` field but always present for sequence rows
   *  (the existing field is optional). */
  startTime: string
  /** ISO8601 duration between frames. Mirrors the existing
   *  `period` field but always present for sequence rows. */
  period: string
  /** Hash of the canonical frame list (the source_filenames
   *  JSON blob). Lets a consumer cache the frame enumeration
   *  and noticed when a re-upload has changed it. */
  framesDigest?: string
}
```

`startTime` + `period` are deliberately reused from the existing
dataset metadata: every catalog dataset already has them and the
publisher form already collects them. A sequence row is just a row
where both are required (the existing free-form values become
canonical).

### New endpoints

Three new routes under the public API. All scoped by the same
visibility rule the manifest already enforces.

| Method + path | Returns | Notes |
|---|---|---|
| `GET /api/v1/datasets/{id}/frames` | JSON: `{ count, fileNameMask, frames: [{index, displayName, timestamp, contentDigest, url}, ...], cursor }` | Paginated; default 100 per page. `?from=ISO&to=ISO` filters by time window. `?at=ISO` returns the single closest frame (computed from `start_time + period × index`). |
| `GET /api/v1/datasets/{id}/frames/{index}` | 302 to the per-frame R2 URL | Stable consumer-facing URL even if the bucket layout changes later. Restricted rows mint a short-lived presigned GET in the 302 response. |
| `HEAD /api/v1/datasets/{id}/frames/{index}` | Last-Modified + Content-Length + Content-Digest | Cheap exists-check for tooling that doesn't want to follow the redirect. |

The `?at=ISO` query is the load-bearing one for time-series UX:
the SPA's "jump to time" affordance, Orbit's "show me the frame
for May 16" tool call, and the federation feed's "fresh content
since timestamp X" all reduce to it.

### Orbit integration

Two pieces:

1. **Inline load marker.** `docentContext.buildSystemPromptForTurn`
   describes sequence datasets with their mask + `startTime` +
   `period` + `frameCount` so the LLM understands what a frame
   request means. The existing `<<LOAD:DATASET_ID>>` marker is
   joined by a new `<<LOAD_FRAME:DATASET_ID:{at|index}>>` marker
   the chat parser turns into an inline-button stream chunk.
   Examples the LLM should emit:
   - `<<LOAD_FRAME:01HX...:2026-05-16T12:00Z>>`
   - `<<LOAD_FRAME:01HX...:index=47>>`
   - `<<LOAD_FRAME:01HX...:latest>>` (resolved server-side to
     `frame_count - 1`)
2. **Function tool.** For providers that prefer function-calling
   over inline markers, the existing `load_dataset` tool gains
   a sibling `load_frame(dataset_id, query)` with `query` as
   `{ at: ISO } | { index: number } | { relative: 'latest' | 'first' }`.

The SPA's stream-chunk handler in `chatUI.ts` renders frame loads
as buttons labelled with the *mask-rendered display name* (not
the raw index), so the publisher's choice of mask shows up in
the chat surface. Clicking the button calls into
`datasetLoader.ts`'s new `loadFrameAt(datasetId, query)` path,
which resolves to a single-image render against the globe (same
underlying renderer the existing image-dataset path uses).

### Search integration

Two pieces of search work, both incremental:

1. **Textual corpus.** `file_name_mask` joins the per-dataset
   text the Vectorize index already embeds (alongside title,
   abstract, organization, tags). No new index; the dataset
   re-embed pass happens whenever the row is updated. Phrase
   queries like "daily precipitation" or "hourly model output"
   start matching mask-bearing datasets for free.
2. **Structured time-range filter.** A new
   `?time_range=ISO/ISO` query parameter on the search
   endpoint filters to datasets whose
   `[start_time, start_time + period × frame_count]` window
   overlaps the requested range. Implementation is cheap (a
   single SQL `WHERE` on the snapshot table, no new index for
   the dataset counts we're at). For non-sequence rows it
   degrades to the existing `[start_time, end_time]` rectangle.

The browse UI gains a date scrubber on sequence-row results — a
narrow horizontal track showing the frame timeline with the
"closest to now" marker highlighted. That's UI scaffolding
mostly; the underlying API is already in place once `?at=`
ships.

### Restricted-visibility considerations

Frames inherit their dataset's visibility:

- **Public**: per-frame R2 URLs resolve to the bucket's public
  base URL (same path `resolveAssetRef` already takes for the
  `r2:` asset scheme). Cacheable for ~1 year (the per-upload
  prefix makes each frame's URL effectively immutable).
- **Restricted**: per-frame URLs returned by
  `/api/v1/datasets/{id}/frames` and the 302 from
  `/api/v1/datasets/{id}/frames/{index}` mint short-lived
  presigned GETs (15-minute TTL — same window the asset PUT
  uploads use). The Vectorize text corpus excludes restricted
  rows from the public search index, so the structured
  time-range filter only surfaces frames a caller already has
  visibility on.
- **Private / draft**: frame access requires the publisher's
  Cloudflare Access session, same as the existing draft
  manifest.

### Sub-phase breakdown — Phase 1 exposure

These ship in a separate PR after the ingest half (3pe/A–E)
lands and bakes for a release cycle. The schema work is already
done by 3pe/A; the rest is API + LLM + search.

| Sub-phase | Demoable result | Notes |
|---|---|---|
| **3pf/A** — Manifest exposure | `serializeDataset` returns the new `frames` envelope for sequence rows; tests pin the wire shape; `dataService.ts` on the SPA side reads it. No UI changes yet. | Smallest piece; backwards-compatible — existing consumers ignore the new field. |
| **3pf/B** — `/api/v1/datasets/{id}/frames` + `/frames/{index}` routes | Paginated list, time-window filter, single-frame 302 (with presigned URL for restricted rows). HEAD support for tooling exists-checks. | Two new files under `functions/api/v1/datasets/{id}/`. Reuses the existing visibility middleware. |
| **3pf/C** — Orbit load-frame marker + tool | `<<LOAD_FRAME:...>>` parsed in `docentService.extractActionsFromText`; system prompt describes sequence datasets; chat-UI renders frame buttons with mask-rendered display names. | Mirrors the existing `<<LOAD:DATASET_ID>>` work. New `load_frame` function tool for providers that prefer tool calls. |
| **3pf/D** — Time-range search filter | `?time_range=ISO/ISO` on the public search endpoint; SQL `WHERE` on the snapshot. Browse UI date-scrubber renders the timeline + "closest to now" marker for sequence-row results. | The SQL piece is small; the date-scrubber is the UX work. |
| **3pf/E** — `terraviz` CLI commands | `terraviz frames list <dataset> [--from ... --to ...]` and `terraviz frames get <dataset> <index>` for operator + federated-peer workflows. Streams a manifest JSON the caller can pipe into `xargs curl` for bulk fetch. | Mirrors the existing `terraviz dataset <id>` shape; reuses the new `/frames` endpoints. |
| **3pf/F** — Operator docs | Wire-shape additions documented in `CATALOG_DATA_MODEL.md` and `CATALOG_FEDERATION_PROTOCOL.md` (federation peers consume the same frames endpoints). CHANGELOG entry. | The federation doc is the one that catches the most readers; the frames endpoint is what federated mirrors will fetch. |

### Sequencing — one PR or two?

Two PRs is the recommended split:

- **PR 3pe** (3pe/A–E): ingest. Lands the schema + uploader +
  runner branch + transcode path. Publishers can upload frames;
  consumers see them as a regular video dataset (HLS playback).
  The frame metadata is on the row but the public API doesn't
  expose individual frames yet.
- **PR 3pf** (3pf/A–F): exposure. Adds the manifest envelope,
  the `/frames` endpoints, the Orbit tool, the search filter,
  the CLI commands.

The split keeps each PR scope-bounded (~6–8 commits each), lets
3pe ship as soon as it's ready without blocking on the LLM /
search work, and gives a release cycle of real publisher upload
traffic to inform any 3pf design adjustments. The schema work
in 3pe/A includes the `file_name_mask` column so the data is
captured from day one even though no public surface reads it
yet — back-fill-free when 3pf lands.

Single-PR sequencing would also work — same total commit count,
no schema migration ordering surprises — but the ingest /
exposure split mirrors how the rest of the catalog backend has
been delivered (data-model first, then exposure), and each PR
ends at a coherent demoable state.

---

## Phase 2 — Real-time append (deferred)

Sketched here for the record. Not scheduled. The decision to defer is
that publishers' actual usage patterns will tell us which of the three
approaches below is worth the carrying cost — and "just re-upload the
growing frame set" is a viable workaround until that signal arrives.

### Three options for "add a frame, re-render"

| Approach | What it does | CPU cost | Client compat | Carrying complexity |
|---|---|---|---|---|
| **A. Full re-transcode** | Keep all source frames in R2; on append, run the same Phase 1 pipeline against the now-larger set. New master at a new `upload_id` prefix; the existing `/transcode-complete` swap covers it. | Linear in total frame count. ~3 min per 240 frames. | Identical to Phase 1. | Zero — pipeline is unchanged. |
| **B. VOD segment append** | Re-encode only the new frames into one new HLS segment; append to the variant playlists; bump the master's segment list. | O(new frames). Tens of seconds per append. | VOD-spec HLS doesn't mandate immutable playlists, but some players cache them aggressively. Needs careful `EXT-X-VERSION` + cache-busting. | Medium — a new "append" code path in the runner + a partial-update endpoint on the publisher API. |
| **C. HLS Live profile** | Switch the dataset's output format to live HLS with sliding window. Frames appended to a live playlist consumed by clients that follow the spec. | O(new frames). | Live HLS has wider quirks across players; loses the seekable-VOD UX. | High — distinct delivery path, new client behaviour, breaks the `hls.js` config the SPA already ships. |

Option A is the de-facto v0 today: a publisher re-uploads the growing
frame set whenever they want a refresh. v1 of Phase 2 would either
formalise that (a "Re-encode with new frames" button on the detail
page that copies the prior frame set into a new `upload_id` prefix +
prompts for the additions) or commit to option B with a
carefully-scoped append endpoint.

The plan is to revisit this decision after Phase 1 ships and there's
real publisher feedback on (a) how often they actually want to
append vs. re-upload, (b) how big their typical frame sets get, and
(c) whether the publishers who care most about real-time refresh are
on infrastructure that produces frames-as-they-go or that produces
a growing-MP4-as-they-go.

---

## Open questions

1. **Mime registration.** `image-sequence/png` isn't a registered IANA
   mime type. We invent it for the request body and reject anything
   else for the new path. Alternative: use the per-frame mime
   (`image/png`) plus a `frames: [...]` envelope marker. The
   per-frame mime is more standard but the request-shape branch is
   then driven entirely by the presence of `frames`, which is a
   little less explicit. **Tentative decision:** use the per-frame
   mime + `frames` array as the discriminator.
2. **Mixed-mime sequences.** Can a publisher mix PNG and JPEG frames
   in one upload? ffmpeg can handle it but the output quality
   becomes unpredictable. **Tentative decision:** reject mixed-mime
   sequences server-side; a single rejection is friendlier than a
   surprise after the 30-second hash.
3. **Resolution consistency.** ffmpeg image-sequence input requires
   every frame to be the same dimensions. Reject mid-sequence
   resolution changes at `/asset` time? That requires the client to
   probe each frame's dimensions before hashing — workable with
   `createImageBitmap`. **Tentative decision:** client-side probe
   on the first frame only, server-side trust (the runner will fail
   the encode if it's wrong, surfacing as a stuck `transcoding=1`).
4. **Frame count cap.** The plan suggests 10000 as a sanity cap.
   Real-time datasets refreshing every hour for a year hit ~8700
   frames; 10 minutes of 24 fps content is ~14400. Should the cap be
   higher? **Tentative decision:** 50000, which covers ~8 weeks of
   hourly data or 35 minutes of 24 fps content.
5. **Thumbnail strip lazy loading.** 240 object URLs decoded into a
   strip is memory-heavy. Lazy-render via `IntersectionObserver` or
   cap at the first 20 + "240 frames total"? **Tentative decision:**
   first 20 + a count label.
6. **Mask token vocabulary.** Strftime covers time-stamped frames
   well (`%Y%m%d`, `%H%M`, etc.) but not the "ensemble member N"
   or "model run index" patterns some publishers use
   (`run20260101_ens03_step_%i.png`). The plan punts on a richer
   token set — `%i` for sequence index + strftime is enough for
   v1, and the original filenames are stored in
   `frame_source_filenames_ref` so consumers that need the
   non-strftime detail can fetch the source-filenames JSON.
   **Tentative decision:** strftime + `%i` only in v1; revisit
   when a real publisher use case shows up.
7. **Frame count growth via re-upload.** A publisher who appends a
   frame today re-uploads the entire sequence. The new upload
   gets a new `upload_id`, so the per-frame URLs in the previous
   manifest become 404 the moment `/transcode-complete` swaps
   `data_ref` and the frame-count column. Consumers caching
   frame URLs should refresh on `framesDigest` change.
   **Tentative decision:** document the staleness as a known
   property; a Phase 2 append flow (deferred) would address it
   structurally.
8. **Bulk-download UX.** The `/frames` JSON-list endpoint is
   discoverable; an explicit "download all" affordance is not.
   Reasonable for v1 — the publisher already has the local
   copies, and a federated peer would use the `terraviz frames`
   CLI. **Tentative decision:** skip the UI button; the JSON
   manifest is sufficient for the tooling cases that actually
   need bulk fetch.

---

## Sequencing relative to existing roadmap

The ingest half (3pe/A–E) lands after Phase 3pd (PR #112) merges —
the MP4 flow it extends needs to be on `main` first. The
active-transcode-upload-id binding from migration 0012
(`3pd-followup/C` on this review branch) is a hard prerequisite:
it's what gives the new image-sequence path its concurrency safety
for free.

The exposure half (3pf/A–F — manifest envelope, `/frames` endpoints,
Orbit tool, search filter, CLI) ships after 3pe has baked for a
release cycle. The schema work in 3pe/A includes the
`file_name_mask` and `frame_count` columns so 3pf doesn't need a
back-fill.

After both: the broader Phase 3 portal work (tour creator, bulk
import, webhook + verify-deploy) continues from where 3pd left off.
Image-sequence upload + exposure consumes letters **3pe** and
**3pf**, which means the previously-planned 3pe (tour creator),
3pf (bulk import), 3pg (webhook + verify-deploy) shift to 3pg /
3ph / 3pi when this lands. `CATALOG_BACKEND_PLAN.md` §"Phase 3
sub-phase split table" will need a small renumbering pass in the
same PR that lands 3pe/A.

Phase 2 (real-time append) is unscheduled. If it ever gets picked up,
it shares a namespace with the existing Phase 4 federation work
already documented in
[`architecture/federation-scoping.md`](architecture/federation-scoping.md)
— real-time append datasets are precisely the kind of "freshness
matters more than completeness" content federation peers would want a
streaming consumer for.
