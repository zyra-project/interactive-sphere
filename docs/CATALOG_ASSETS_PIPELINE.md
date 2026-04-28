# Catalog Asset & Video Pipeline

How catalog datasets resolve to playable assets — the `data_ref`
scheme, video transcoding, image variants, sphere thumbnails, and
the manifest response that ties them together. Companion to
[`CATALOG_BACKEND_PLAN.md`](CATALOG_BACKEND_PLAN.md); schema
referenced from
[`CATALOG_DATA_MODEL.md`](CATALOG_DATA_MODEL.md).

The catalog stores *references*, not bytes. A `data_ref` value is one
of:

| Scheme | Example | Resolved by `/manifest` to |
|---|---|---|
| `stream:` | `stream:abcdef0123` | Cloudflare Stream HLS URL (signed if non-public) |
| `r2:` | `r2:datasets/01HX.../map.png` | Cloudflare Images variant URL or signed R2 URL |
| `vimeo:` | `vimeo:123456789` | Existing video-proxy.zyra-project.org URL (cutover bridge only) |
| `url:` | `url:https://noaa.example/...` | Pass-through to external URL (legacy NOAA imagery) |
| `peer:` | `peer:01HW.../01HX...` | Federated. Resolves via the peer's `/api/v1/federation/feed/manifest/{id}` |

The reference scheme keeps the catalog row stable while assets move
between backends. A dataset uploaded as a Vimeo link, later
re-encoded into Stream, swaps `data_ref` from `vimeo:...` to
`stream:...` without any client-visible change.

## Video pipeline (Cloudflare Stream)

Stream replaces every Vimeo responsibility we currently rely on:

| Need | Vimeo today | Stream replacement |
|---|---|---|
| Upload | Manual via Vimeo UI | `POST /api/v1/publish/datasets/{id}/asset` returns a Stream direct-upload URL; browser uploads straight to Stream. |
| Transcoding | Vimeo internal | Stream auto-transcodes to HLS + DASH ladder. |
| Playback URL | Vimeo proxy | `https://customer-<id>.cloudflarestream.com/<uid>/manifest/video.m3u8` for public; signed JWT for restricted. |
| ABR bitrate ladder | Vimeo presets | Stream presets (matches our existing 360p/720p/1080p tiers). |
| Captions | Existing `closedCaptionLink` | Stream native VTT track upload, or keep external VTT in R2 (the `caption_ref` column accepts either). |
| Thumbnails | Manual | Stream auto-thumbnail at 0s; publisher can override via UI. |

`hlsService.ts` is unchanged — it still consumes an HLS manifest URL
and an optional MP4 fallback. `datasetLoader.ts` swaps its current
`fetch('https://video-proxy.zyra-project.org/...')` for
`fetch('/api/v1/datasets/{id}/manifest')`. Same JSON shape minus
`dash` (we don't use it) and minus `files[]` for restricted videos
where signed-URL semantics make a long-lived MP4 link a leak.

### Cutover bridge

For Phase 1 a `vimeo:` `data_ref` resolves through the existing
proxy unchanged, so cutover is a one-line frontend change with no
asset re-uploads. Phase 2 ships the publisher-portal upload path
and a backfill job that pulls each Vimeo source into Stream and
flips the `data_ref`.
