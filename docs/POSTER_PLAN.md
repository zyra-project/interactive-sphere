# Terraviz Poster — Plan

A web-based presentation poster covering the Terraviz application,
its visualization stack, immersive (XR) mode, the Orbit AI docent,
the multi-platform delivery story (web + Tauri desktop), and the
emerging federated catalog backend on Cloudflare. Companion to the
existing series:

- [`zyra` poster](https://noaa-gsl.github.io/zyra/poster/) — source at
  [`NOAA-GSL/zyra/poster`](https://github.com/NOAA-GSL/zyra/tree/main/poster)
- [`depot-explorer` poster](https://noaa-gsl.github.io/depot-explorer/) —
  source at
  [`NOAA-GSL/depot-explorer/poster`](https://github.com/NOAA-GSL/depot-explorer/tree/main/poster)
- [`zyra-editor` poster](https://zyra-project.github.io/zyra-editor/) —
  source at
  [`zyra-project/zyra-editor/poster`](https://github.com/zyra-project/zyra-editor/tree/main/poster)

Status: **draft for review.** Nothing has been built yet; this
document is the agreed-upon outline before any HTML/CSS lands.
The deliverable is a single static site at `/poster/` that
deploys alongside the application.

---

## Goals

- Tell the Terraviz story end-to-end in a format that works as
  both a conference poster (scrollable, projector-friendly) and a
  standalone web page that can be linked or QR-scanned.
- Match the construction technique and visual language of the
  three companion posters so the series reads as a coherent set.
- Embed the live application — not just screenshots — so anyone
  walking up to the poster can drive Terraviz themselves.
- Cover the parts of the system that the existing READMEs do
  *not* foreground: the WebGL custom layer compositing the photoreal
  Earth, the multi-globe lockstep, the WebXR two-renderer
  architecture, the Tauri desktop *and mobile* (iOS + Android)
  adaptations, and the federated catalog backend on Cloudflare.

## Non-goals

- A new design system. The poster reuses the series' design tokens
  (Source Sans 3 / Source Code Pro, navy + ocean-blue + seafoam +
  amber accents) plus the Terraviz `#4da6ff` accent for "live"
  elements. No new branding.
- Print fidelity. The poster is web-first; an A0 print pass is a
  follow-up if requested.
- A second build pipeline. The poster is hand-authored static
  HTML/CSS/JS — no Vite, no framework, no bundler. Same as the
  rest of the series.
- Documentation rewrite. Where the poster needs depth, it links
  out to the canonical doc (`MISSION.md`, `STYLE_GUIDE.md`,
  `CATALOG_BACKEND_PLAN.md`, `VR_INVESTIGATION_PLAN.md`,
  `ANALYTICS.md`, `DESKTOP_APP_PLAN.md`).

---

## Construction technique (carried from the series)

| Element | Pattern |
|---|---|
| Authoring | Section partials in `poster/sections/sec-NN-name.html` + four shared templates (`_head.html`, `_styles.css`, `_body-open.html`, `_footer.html`); `scripts/build_poster.py` concatenates them into `poster/index.html`. Both the partials and the rendered output are committed |
| Layout | Single-column `max-width: 1200px` container, alternating `section` / `section--alt` backgrounds |
| Typography | Source Sans 3 (body 300–800) + Source Code Pro (mono 400–600) via Google Fonts |
| Animation | Scroll-triggered fade-in via `IntersectionObserver`; gated on `prefers-reduced-motion` |
| Timer | Sticky top-right presentation timer — play / pause / reset, warning at 4 min, overtime at 5 min, minimize-to-tab |
| Demo iframe | `/health`-probe with screenshot fallback; sandboxed `allow-scripts allow-same-origin allow-forms allow-popups`; fullscreen toggle |
| Responsive | Single-column stack at ≤900 px |
| Accessibility | Focus-visible outline, ARIA labels on emoji-only buttons, contrast meeting WCAG 2.1 AA |

## Color palette (proposed)

Reuse the series tokens for chrome (navy, ocean-blue, seafoam,
amber, the neutral ramp) and adopt Terraviz's `#4da6ff` accent
for live/interactive call-outs (the demo frame border, the
"open in app" CTAs, the federation diagram's active path).
This keeps the poster recognizably part of the family while
giving Terraviz's globe-first identity a distinct hue.

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#00172D` | Footer, timer, hero gradient base |
| `--ocean-blue` | `#1A5A69` | Section accents, links |
| `--cable-blue` | `#00529E` | CTA buttons, primary links |
| `--seafoam` | `#5F9DAE` | Secondary accents, dividers |
| `--mist` | `#9AB2B1` | Muted text on dark |
| `--amber` | `#FFC107` | Warning states (timer) |
| `--terra-accent` | `#4da6ff` | Live-element borders, "open in app" |
| `--surface-glass` | `rgba(13, 13, 18, 0.88)` | Demo frame chrome |

## File layout

The series builds the rendered HTML from section partials via a
small Python script (`scripts/build_poster.py`), then commits
the rendered output alongside the partials so GitHub Pages or
Cloudflare Pages can serve the file directly without a build
step. Confirmed by reading the actual `zyra` and `zyra-editor`
poster sources — same partial-file naming convention
(`_head.html`, `_styles.css`, `_body-open.html`, `_footer.html`,
`sec-NN-name.html`) and the same `scripts/build_poster.py`
entry point in both. Adopting that pattern verbatim:

```
poster/
├── README.md                        # Build/deploy notes
├── index.html                       # RENDERED output — committed
├── sections/                        # AUTHORING SURFACE
│   ├── _head.html                   #   <head>, link rels, meta
│   ├── _styles.css                  #   :root tokens + global CSS
│   ├── _body-open.html              #   opening <body>, sticky timer
│   ├── _footer.html                 #   closing scripts + </body></html>
│   ├── sec-01-hero.html
│   ├── sec-02-mission.html
│   ├── sec-03-features.html
│   ├── sec-04-globe.html
│   ├── sec-05-multiglobe.html
│   ├── sec-06-tours.html
│   ├── sec-07-orbit.html
│   ├── sec-08-immersive.html
│   ├── sec-09-platforms.html
│   ├── sec-10-federation.html
│   ├── sec-11-analytics.html
│   ├── sec-12-techstack.html
│   ├── sec-13-cta.html
│   └── sec-14-footer-block.html
├── scripts/
│   └── build_poster.py              # Concatenate partials → index.html
└── assets/
    ├── logos/                       # NOAA, Zyra, Terraviz
    ├── qr/                          # QR codes (4 destinations)
    ├── screenshots/                 # 2D globe, multi-globe, browse
    ├── xr/                          # Quest captures (AR + VR)
    │   └── models/                  # terraviz-earth.glb / .usdz
    ├── diagrams/                    # SVG: tile pipeline, XR loop, federation
    └── demo-fallback.png            # Iframe /health-probe fallback
```

### Build script

Mirrors the proven shape of `zyra/poster/scripts/build_poster.py`
and `zyra-editor/poster/scripts/build_poster.py`:

- Discovers `sections/sec-*.html` in numeric order.
- Reads the four templates (`_head.html`, `_styles.css`,
  `_body-open.html`, `_footer.html`).
- Inlines the CSS into a `<style>` block in the head (so the
  rendered file is single-file and works from `file://`).
- Concatenates: `_head.html` + `<style>{_styles.css}</style>` +
  `</head>` + `_body-open.html` + every `sec-NN-*.html` in
  order + `_footer.html`.
- Writes `poster/index.html`.
- Prints byte count and line count for the result.

Run it from anywhere: `python3 poster/scripts/build_poster.py`.
No third-party Python deps — stdlib only. Same as the upstream
references.

### Author / publish workflow

1. Edit a partial in `poster/sections/` (this is where all
   poster work happens; `index.html` is never hand-edited).
2. Run `python3 poster/scripts/build_poster.py`.
3. `git diff poster/index.html` to confirm the rendered output
   changed the way the partial implies.
4. Commit both the partial and `poster/index.html` together so
   Pages can serve the rendered file with no build step. This
   also means PR reviewers see both the source diff and the
   rendered diff in one place.

### Drift guard (optional, P11)

A small CI check runs the build script and `git diff --exit-code
poster/index.html` to fail the build if a contributor edited a
partial without re-running the script. Same idea as the
existing `npm run check:privacy-page` check in this repo.

## Deployment

**Decided: Cloudflare Pages — separate project.** A new Pages
project (working name `terraviz-poster`) is pointed at the
`poster/` subdirectory of this repo. Domain is
`terraviz-poster.pages.dev` initially, with a custom subdomain
under `zyra-project.org` to follow once the content is final.

Why a separate project rather than a sub-route of the main SPA:

- **Isolation.** A poster commit can never break the app build.
  The main `terraviz.zyra-project.org` SPA continues to deploy
  from the existing project untouched.
- **Deploys flow through GitHub Actions, not Cloudflare's
  Git integration.** A dedicated workflow at
  `.github/workflows/poster.yml` runs `wrangler pages deploy
  poster/ --project-name terraviz-poster` on every push that
  touches `poster/**`. Same auth model and same secrets
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) as the
  SPA's existing `ci.yml`. We tried Cloudflare's "Connect to
  Git" path first; it didn't reliably pick up commits on
  this project even after reconnecting and confirming the
  GitHub App had repo access. The wrangler-based pattern is
  already proven in this repo for the SPA, so we use it
  here too.
- **No build step at deploy time.** The rendered
  `poster/index.html` is committed alongside the section
  partials, so the wrangler step just uploads the static
  contents of `poster/` — no Vite, no `npm install`, no
  Python on CI. The Python build script runs locally
  before commit.
- **Path-filtered trigger.** The workflow only fires when
  `poster/**` or the workflow file itself changes. SPA-only
  commits never invoke it; poster commits never invoke the
  SPA pipeline.
- **Independent caching headers.** We can set long-cache headers
  on `poster/assets/` without touching the SPA's `_headers`.
- **Independent rollback.** If a poster change has to be
  reverted live, the rollback is in the Pages project's history
  and doesn't entangle SPA deploy history.

Pages project configuration (set up in the dashboard; the
"Connect to Git" parts are no-ops because deploys come from
the GitHub Actions workflow rather than Cloudflare's webhook):

| Field | Value |
|---|---|
| Project name | `terraviz-poster` |
| Production branch | `main` |
| Deploy mechanism | `wrangler pages deploy` from `.github/workflows/poster.yml` |
| Path filter | `poster/**` and the workflow file itself |
| Preview deploys | every push to a non-`main` branch with poster changes gets a `<branch>.terraviz-poster.pages.dev` URL |

Preview URLs from PRs are the review surface for everything from
P3 onward — reviewers can scroll the actual poster instead of
reading HTML diffs. The PR's "Checks" tab gains a
`Deploy poster to Cloudflare Pages` entry whose `View
deployment` link points at the preview.

Alternative considered and rejected: GitHub Pages from a
`gh-pages` branch (the pattern used by `noaa-gsl.github.io/zyra`
and `zyra-project.github.io/zyra-editor`). Simpler in some ways,
but loses Cloudflare's preview-per-PR and forces a second
deploy mechanism into the repo. We already use Cloudflare Pages
for the SPA; staying on one platform is the smaller change.

---

## Section outline

The poster is a vertical scroll, fourteen sections plus the
sticky timer. Section numbers below correspond to anchor IDs
in the final `index.html` and to filenames under
`poster/sections/sec-NN-*.html`.

### 0. Sticky presentation timer

Carried from the series. Top-right, glass surface, blur,
play / pause / reset. Warns amber at 4:00, red at 5:00.

**Default state: minimized.** The poster has to read as a
poster on first scroll (museum kiosk, walk-up at a conference
hall) without any timer chrome dominating the hero. The timer
collapses to its tab on load and only expands when the
presenter taps it — at which point it behaves identically to
the rest of the series. Persisting the expanded/collapsed
choice in `localStorage` keeps a presenter's preference across
talk rehearsals.

### 1. Hero

- Title: **Terraviz — Streaming Earth's Data to Every Device**
- Subtitle: one sentence from `MISSION.md` ("Science On a Sphere
  lives in museums. Terraviz brings it everywhere.")
- Three-column layout: NOAA + Zyra logos (left) | center title +
  author block | QR codes for live app + GitHub (right).
- Author block (matches the `zyra` poster's single-author
  attribution exactly):

  > **Eric Hackathorn**
  > NOAA Global Systems Laboratory
  > <span title="ORCID">iD</span> 0000-0002-9693-2093

  Render the ORCID identifier as a link to
  `https://orcid.org/0000-0002-9693-2093` with the standard
  ORCID green-leaf glyph next to it (same treatment as the zyra
  poster). Easy to extend if collaborators want billing later.
- Background: navy gradient with a subtle SVG texture (matching
  the series). Optional CSS-only animated "starfield" for visual
  interest — gated on `prefers-reduced-motion`.

**Interactive:** none. Hero is the static establishing shot.

### 2. The mission

Why this exists. Two-column layout:

- Left: prose from `MISSION.md` — SOS in museums vs. SOS on a phone.
- Right: side-by-side photo of an SOS installation with a
  Terraviz screenshot on a phone, captioned "Same data, no
  museum required."

Light reading, ~120 words. Sets up the rest.

### 3. What you can do — feature gallery

Seven-card responsive grid (3 across on desktop, wrapping to 2
then 1 on narrower viewports). Each card = icon + title +
1–2-line description. Cards link to deeper sections below.
Tours sits between Multi-globe and Orbit because it is the
piece that ties them together — see §6.

| Card | Anchor |
|---|---|
| Photoreal globe | §4 |
| Multi-globe comparison | §5 |
| **Tours — data-driven storytelling** (today: AI-authored, human-reviewed; soon: Orbit-authored on demand) | **§6** |
| Orbit AI docent | §7 |
| Immersive AR/VR | §8 |
| Multi-platform (web + desktop + mobile) | §9 |
| Federated catalog backend | §10 |

**Interactive:** clicking a card scrolls to its section. The grid
itself uses scroll-fade reveal.

### 4. The globe under the hood

The first deep-dive section. Covers `mapRenderer.ts` +
`earthTileLayer.ts`:

- MapLibre GL JS with globe projection — the base.
- NASA GIBS tile sources — Blue Marble (day) and Black Marble
  (night lights with progressive zoom).
- A `CustomLayerInterface` does multi-pass WebGL2 compositing:
  day/night blend gated on real UTC sun position, framebuffer-
  captured city lights, specular sun glint, real-time clouds,
  starfield skybox.
- Terrain via 3D elevation tiles.
- Tile preloader fetches low-zoom tiles eagerly on startup.

**Interactive elements:**

- **Live demo iframe** anchored here. Default URL:
  `https://terraviz.zyra-project.org`. `/health` probe at load;
  fallback image if it fails.
- **Effect-toggle buttons** below the iframe that deep-link to
  app states demonstrating each effect (terrain on, labels on,
  borders on, auto-rotate on). Clicking a button reloads the
  iframe `src` with a query param. Requires the app to honor
  these params — flag in §"Open questions" below.
- **Diagram (SVG):** Tile sources → CustomLayerInterface →
  multi-pass shader → frame.

### 5. Multi-globe comparison

Cover `viewportManager.ts`:

- 1 / 2 / 4 synchronised MapRenderer instances in a CSS grid.
- Camera lockstep across panels — drag panel A, panels B/C/D
  follow.
- Time-series animations sync by real-world date — each panel
  may run its own dataset on its own clock; a hurricane in
  September 2024 lines up across all panels regardless of
  per-dataset framerate.
- Layout switching (`setEnvView` task in §6 tours) hot-swaps
  between 1-globe, 2-globe, and 4-globe grids without
  reloading the app.

**Interactive elements:**

- Annotated still showing the lockstep camera matrix flowing
  from panel A to panels B/C/D.
- Layout-toggle buttons that change the iframe `src` to
  `?layout=1`, `?layout=2`, `?layout=4`. (Tour-launcher
  buttons live in §6, not here — they're how the layout
  switch is *used*, not the mechanic itself.)

### 6. Tours — data-driven storytelling

The educational scaffolding that turns Terraviz from a video
player into a guided tour of the planet. Cover
`tourEngine.ts`, `tourUI.ts`, and the SOS-format tour JSON.

**The pitch.** A tour is a small JSON document describing a
sequence of tasks: "fly the camera to the Gulf of Mexico, load
the SSP5 sea-surface-temperature dataset, switch to a 4-globe
layout, show this caption, pause for the user." The engine
executes them one at a time, awaiting promises so each task
finishes before the next begins. The result is a curated
walkthrough — the same affordance an SOS docent gives a
museum audience, available to anyone with a browser.

**Why it matters in the poster.** Tours are what make
Terraviz more than a globe with a play button:

- **Data-driven storytelling.** The Climate Futures tour
  compares SSP1, SSP2, and SSP5 climate scenarios across air
  temperature, precipitation, sea-surface temperature, and
  sea-ice concentration. The narrative is in the JSON; the
  app is the player.
- **Educational scaffolding.** `pauseForInput`,
  `pauseSeconds`, and text-overlay tasks (`showRect` /
  `hideRect`) build pacing into a tour the way a lesson plan
  paces a class. Captions support `<color=X>` and `<i>`
  markup; the SOS tour-builder ecosystem already produces
  this format.
- **Orbit drives the app via tours.** This is the bit that
  turns Orbit from a chat surface into an agent. Tours are
  loaded by Orbit the same way regular datasets are — the
  LLM emits `<<LOAD:TOUR_ID>>` markers and the docent
  context already instructs it to recommend tours when "the
  user seems new, asks for an overview, or wants to learn
  about a broad topic" (`docentContext.ts:235`). Saying
  "show me how the climate is going to change by 2100" can
  fly the camera, swap to a 4-globe layout, load four
  datasets across the panels, and start the narration —
  all from chat.

**The task surface.** A representative subset of what
`tourEngine.ts` already supports today (Phases 1 + 2 shipped):

| Task | Effect |
|---|---|
| `flyTo` | Camera to lat/lon at altitude (returns on `moveend`) |
| `loadDataset` | Loads a dataset; `worldIndex` routes it to a specific panel |
| `unloadDataset` / `unloadAllDatasets` | Clears the globe |
| `setEnvView` | Switches 1g / 2g / 4g layout |
| `datasetAnimation` | Toggles play/pause on the current video |
| `showRect` / `hideRect` | Text overlay panels (DOM, glass-styled) |
| `pauseForInput` | Wait for user to tap play |
| `pauseSeconds` | Timed pause |
| `setGlobeRotationRate` | Auto-rotate speed |
| `envShowDayNightLighting` / `envShowClouds` | Earth-stack toggles |

**Architecture callout.** The engine receives a
`TourCallbacks` interface — it never imports
`InteractiveSphere`. That decoupling is what lets Orbit, the
URL-param handlers, and the tour player all drive the same
tour through the same engine.

**The sample tours were AI-authored.** Small but worth
admitting on the poster: the Climate Futures tour and the
other sample tours under `public/assets/*-tour.json` were
drafted by an LLM from prompts that named the relevant
datasets and the story to tell, then human-reviewed and
adjusted. The SOS tour JSON format is small, declarative,
and the task surface is documented — which makes it a
plausible target for LLM authoring even with today's models.

**Where this is going: Orbit as tour author, not just tour
player.** This is the forward-looking thread that ties the
poster together. Right now Orbit *recommends* tours from the
catalog and *loads* them through the existing
`<<LOAD:TOUR_ID>>` marker. Closing the loop — having Orbit
*generate* a tour on the fly from a question like *"walk me
through how Atlantic hurricane seasons have changed since
2000"* — turns the docent into an educational-scaffolding
generator instead of a chat surface that happens to know the
catalog. The pieces are mostly already in place:

- Orbit already has the catalog in its system prompt (turn 0
  full, subsequent turns compact).
- The tour-task surface is small, declarative, and already
  reachable from `TourCallbacks`.
- The streaming-marker pattern (`<<LOAD:…>>`) is already the
  vehicle for structured action chunks; an analogous
  `<<TOUR:…>>` marker carrying inline JSON, or a
  function-calling tool that returns a tour document, is a
  credible next deliverable rather than a research project.

Honest framing on the poster: **this is the forward direction,
not a shipped feature.** It deserves naming because it's the
difference between "smart chat on a globe" and "an AI that
produces lessons about the planet, on demand" — but the
poster has to mark it clearly as next-up, not as something
visitors can poke at the kiosk.

**Interactive elements:**

- **Tour-launcher buttons** under the demo iframe that
  deep-link to specific tours: Climate Futures (1g intro →
  2g compare → 4g full), plus a "general overview" tour for
  first-time visitors. Wired via the `?tour={id}` param
  (P11).
- **"Ask Orbit to take you on a tour" button** that scrolls
  to the iframe and posts `?orbit=open&prompt=tour` so
  Orbit launches with a tour-recommendation prompt
  pre-seeded.
- **Annotated tour-task strip:** a horizontal SVG ribbon
  showing the Climate Futures tour as a sequence of icons
  (flyTo → setEnvView → loadDataset×4 → showRect →
  pauseForInput …) so the audience can see the
  storytelling unit on the poster without watching the
  whole thing play.
- **Cross-link** to `docs/TOURS_IMPLEMENTATION_PLAN.md` for
  contributors who want to author their own tour.

### 7. Orbit — the digital docent

The AI chat surface. Cover `docentService.ts`,
`docentContext.ts`, `docentEngine.ts`, `llmProvider.ts`:

- Hybrid architecture — local keyword engine (instant, offline)
  runs concurrently with an LLM stream over any
  OpenAI-compatible endpoint.
- Stream chunk types: `delta`, `action`, `auto-load`, `done`.
- The LLM is prompted to embed `<<LOAD:DATASET_ID>>` markers
  inline; the service parses these into action chunks; chatUI
  renders each as an inline load button. Tours load through
  the same marker — see §6.
- Function-calling tool `load_dataset` supported as fallback for
  providers that prefer tool calls.
- System prompt is turn-aware: full catalog on turn 0, compact
  catalog on subsequent turns; older history summarised.
- Provider-agnostic: OpenAI, Ollama, LM Studio, Cloudflare AI
  Gateway, llama.cpp, vLLM. Desktop stores keys in OS keychain.

**Where Orbit is going.** A short forward-looking pull-quote
calling out the same idea as §6: today Orbit recommends and
loads tours; the natural next step is having Orbit *write*
them on demand from a user question. The pieces are in place
(catalog in the system prompt, declarative task surface,
streaming-marker action chunks). Framed honestly as the
forward direction, not a shipped capability — full
explanation lives in §6 to avoid duplication.

**Interactive elements:**

- Annotated chat-bubble mockup showing a real Orbit response
  with `<<LOAD:...>>` resolved into an inline button.
- Sequence diagram (SVG) of `processMessage()` racing the local
  engine and the LLM stream.
- "Ask Orbit" CTA that scrolls to the iframe and deep-links
  the app with the chat panel pre-opened.

### 8. Immersive — AR & VR via WebXR

The most visually striking section. Cover the whole `vr*` module
family per `VR_INVESTIGATION_PLAN.md`:

- **Two renderers, one DOM.** MapLibre's canvas keeps running
  unchanged; a parallel Three.js renderer is created on first
  Enter AR/VR tap, takes over the XR session, and yields back on
  session-end.
- **Lazy-loaded Three.js.** ~183 KB gzipped chunk loaded only
  when the user enters XR — non-XR browsers never pay the cost.
- **AR-first button.** `vrButton.ts` prefers `immersive-ar`
  where supported (Quest 2/3/Pro), falls back to `immersive-vr`
  on PCVR, hides on non-XR browsers.
- **Dataset texture reuse.** Video datasets reuse the existing
  `<video>` element via `THREE.VideoTexture`; image datasets
  reuse the decoded `HTMLImageElement`. Zero re-fetches.
- **Earth-as-planet vs. data-as-surface.** With no dataset,
  `photorealEarth.ts` renders the full diffuse + night lights +
  specular + atmosphere + clouds + sun + ground-shadow stack
  with day/night shading gated on real UTC sun position. With a
  dataset, the Earth decoration is hidden so the data reads
  uniformly across the sphere.
- **AR placement.** WebXR hit-test + reticle + Place button +
  Quest persistent anchors (`vrPersistence.ts`) for cross-
  session stability.
- **HUD.** In-VR floating panel (CanvasTexture) with title +
  play/pause + exit-VR; UV hit regions for raycast.

**Interactive elements:**

- **AR/VR screenshot carousel** — captured from a real Quest
  headset. The user is capturing source media; until those land
  the carousel ships with annotated placeholder boxes and a
  follow-up swap commit.
- **Short muted MP4 loop** of an AR session anchored on a real
  surface, with a clear "captured on Quest 3" caption.
- **Per-frame loop diagram (SVG)** showing the 9-step ordering
  documented in `CLAUDE.md`.
- **"Try AR on your phone" tile** — see expansion below.

**Expanding XR reach beyond Quest (proposal).** The user asked
whether a phone can stand in for a headset, so a passerby with
no Quest can still get an immersive moment from the poster.
Short answer: **yes, but not via the existing WebXR code path.**

The Terraviz immersive mode is built on the WebXR Device API
(`navigator.xr.requestSession('immersive-ar' | 'immersive-vr')`).
That API:

- ✅ **Works** on Meta Quest browsers, Pico, and Android Chrome
  on most Pixel and recent Samsung devices (ARCore-backed).
- ❌ **Does not work** on iOS Safari. Apple has not shipped a
  WebXR implementation; `navigator.xr` is undefined in mobile
  Safari and in the iOS Chrome / Firefox variants (which are
  WebKit under the hood). This has been the state of play since
  WebXR shipped in 2019 and there is no public Apple commitment
  to change it.

To reach iPhone visitors in a browser, the practical path is
**`<model-viewer>` + AR Quick Look + Scene Viewer**:

| Platform | Technology | Format |
|---|---|---|
| iOS Safari | AR Quick Look (built-in) | `.usdz` |
| Android Chrome | Scene Viewer (built-in) | `.glb` |
| Desktop browsers | `<model-viewer>` 3D preview only | `.glb` |

`<model-viewer>` is a Google-maintained web component that
abstracts both flows: tag a 3D model with `ar`-attribute and
the same component renders an interactive 3D preview on
desktop, opens AR Quick Look on iOS, and opens Scene Viewer on
Android — no app install, no permission prompt beyond what the
OS already shows for AR launches.

This buys the poster a **"tap to place Earth on your desk"**
demo that works on iPhone, Android phone, and tablet — turning
the §8 story from "Quest only" into "anyone with a phone."
What it does *not* do:

- It is a **separate code path** from WebXR. The interactive
  surface-pinned drag, controller raycasting, and dataset
  texture reuse from `vrInteraction.ts` / `vrSession.ts` are
  not available in AR Quick Look. The on-phone AR experience
  is "view a 3D Earth model"; it is not the full Terraviz XR
  app.
- It needs **two new asset files** — a `terraviz-earth.glb` for
  Scene Viewer + desktop preview, and a `terraviz-earth.usdz`
  for AR Quick Look. We can generate these once from the
  existing `photorealEarth.ts` Three.js scene by exporting a
  baked sphere with diffuse + clouds + (optionally) night
  lights, plus a USDZ converted via Apple's `usdpython` tools or
  Reality Composer. Static models, ~2–10 MB each, committed
  under `poster/assets/xr/models/`.
- It does **not** stream live datasets onto the model. The data
  story stays in the live demo iframe and the Quest captures.
  This is a "what XR feels like" demo for visitors who can't
  put on a headset, not a feature port.

A more ambitious option — full in-browser camera AR via
WebXR-polyfill / MindAR / AR.js / 8th Wall — was considered and
rejected for this poster. They either require a commercial SDK
(8th Wall), only do marker-based tracking (AR.js, MindAR), or
ship a deprecated Mozilla codepath (WebXR-polyfill / WebXR
Viewer, last meaningfully maintained ~2020). For a poster
expected to last months at a kiosk, `<model-viewer>` + the
two OS-native AR launchers is the right scope.

**Build sequencing:** the model-viewer tile is added in P7
alongside the Quest carousel. If exporting the GLB/USDZ pair
turns out to be more than a single-commit task, the tile ships
in a follow-up phase (P11.5) and we'll surface that in the
§"Build phases" table. The Quest section itself does not block
on it.

### 9. One codebase, every platform

The Tauri story across desktop *and* mobile. Covers `src-tauri/`,
`DESKTOP_APP_PLAN.md`, `MOBILE_APP_PLAN.md`, and the lazy
`IS_TAURI` pattern:

- 100 % shared TypeScript source across web, desktop, iOS, and
  Android. Platform-specific behaviour gated at runtime.
- **Desktop (Windows / macOS / Linux):**
  - Tile cache (SHA-256 flat-file) for offline GIBS tiles.
  - Offline dataset downloads — videos resolved via Vimeo proxy,
    images via HEAD probes (4096 → 2048 → original); served to
    the webview through `convertFileSrc()`.
  - OS keychain for LLM API keys (Windows Credential Manager /
    macOS Keychain / Linux secret service).
  - HTTP plugin with allowlist for local-LLM endpoints (Ollama
    11434, LM Studio 1234, llama.cpp/vLLM 8080) — bypasses
    webview CORS so users can hit local models.
  - Auto-update via Tauri updater key + signed `latest.json`.
  - CI/CD: `desktop.yml` (PR builds), `release.yml`
    (tag-triggered multi-platform with draft GitHub Release).
- **Mobile (iOS + Android) — landing now (PR #33):**
  - Same Tauri v2 source tree; `src-tauri/gen/apple/` and
    `src-tauri/gen/android/` are generated by the Tauri CLI and
    committed.
  - Mobile-specific capability set (`capabilities/mobile.json`)
    restricts to HTTPS — no localhost LLM allowlist on phones.
  - Release pipeline (`.github/workflows/release-mobile.yml`):
    iOS → TestFlight via signed IPA + `xcrun altool`; Android →
    Play Console Internal Testing via signed AAB. Twelve
    signing secrets total (seven Apple, five Google), documented
    in `RELEASE_MOBILE.md`.
  - **On-device Orbit (forthcoming, MOBILE_APP_PLAN Phase 7).**
    The interesting design question for mobile is what Orbit
    looks like when the OS itself ships an LLM:
    - **iOS:** a Swift Tauri plugin
      (`src-tauri/plugins/apple-intelligence/`) bridges to the
      Foundation Models framework. Orbit becomes free, private,
      and offline-by-default on Apple Intelligence-eligible
      devices.
    - **Android:** Gemini Nano via AICore, same shape, same
      bridge pattern.
    - Falls back to the existing OpenAI-compatible LLM path on
      older phones — the `llmProvider.ts` swap is a single
      runtime gate.

**Interactive elements:**

- Platform matrix table — Web (any browser), Windows MSI, macOS
  DMG, Linux AppImage, iOS (TestFlight), Android (Play Internal
  Testing) — with badges that link to the live URL, the latest
  desktop GitHub release, and the in-flight mobile PR.
- Architecture diagram (SVG): one TypeScript SPA at the top,
  branching at the `IS_TAURI` runtime gate into web vs. native;
  the native branch then forks into desktop (`src-tauri/src/`)
  vs. mobile (`src-tauri/gen/{apple,android}/` + plugins) at
  the Tauri target axis.
- Honest framing: mobile is **shipping** (release scaffolding
  in PR #33) but **on-device LLM is upcoming** (Phase 7).

### 10. Federated catalog & custom backend

The newest piece, and the one that's least covered in existing
external-facing material. Cover `CATALOG_BACKEND_PLAN.md`,
`CATALOG_DATA_MODEL.md`, `CATALOG_FEDERATION_PROTOCOL.md`,
`CATALOG_PUBLISHING_TOOLS.md`, `CATALOG_ASSETS_PIPELINE.md`,
`CATALOG_BACKEND_DEVELOPMENT.md`:

- The SPA can read its catalog from the SOS S3 source *or* from
  a self-hosted node-backend on Cloudflare Pages Functions.
- Backend stack: Pages Functions + D1 (catalog DB) + R2 (assets)
  + Workers Analytics Engine + KV + Cloudflare Access.
- Each node has a signed identity (Ed25519) generated locally
  via `npm run gen:node-key`; identities anchor federation
  requests across peers.
- Publishing CLI (`bin/`) builds catalog rows from a manifest,
  validates against the data model, and uploads.
- Phase 1a is shipped (D1 seed, dev bypass via `.dev.vars`,
  ~20-row seed). Federation protocol is drafted; live federation
  across peer nodes is the upcoming phase — present this honestly
  rather than overstating.
- Self-hosting walkthrough lives in `docs/SELF_HOSTING.md`.

**Interactive elements:**

- **Architecture diagram (SVG):** SPA → `/api/v1/catalog` →
  D1 + R2 + AE → federation peers, with a CSS keyframe that
  animates a request fanning out across federated nodes.
- **Code snippet block** showing the local-dev quickstart from
  the README (`gen:node-key`, `db:reset`, `dev:functions`,
  curl-and-jq smoke test).
- Cross-links to all six catalog docs.

### 11. Privacy-first analytics

A short, honest section. Cover `src/analytics/`,
`functions/api/ingest.ts`, and `ANALYTICS.md`:

- Two-tier consent model — Essential (default on) and Research
  (opt-in). User-controlled in Tools → Privacy.
- Server-side stamping of `event_type`, `environment`, `country`
  (from `CF-IPCountry`), and `internal` flag.
- Storage: Workers Analytics Engine; dashboards in
  `grafana/dashboards/`.
- Privacy invariants (called out as a list):
  - No IP storage, only country.
  - No User-Agent storage, only bucketed enums.
  - Search queries hashed before emit; error messages sanitized.
  - Lat/lon rounded to 3 decimals before emit.
  - Session id is in-memory, rotates every launch, never
    persisted.
  - `KILL_TELEMETRY=1` returns 410, client cools down.

**Interactive elements:**

- Event-flow diagram (SVG) — emit → batch → beacon → ingest
  → AE → Grafana — with each hop labeled.
- Optional: small Grafana dashboard screenshot.

### 12. Tech stack

Logo wall + one-line rationale per pick. Grouped in three rows:

- **Front-end:** TypeScript, Vite, MapLibre GL JS, HLS.js,
  Three.js.
- **Desktop:** Tauri v2, Rust, keyring, reqwest.
- **Mobile:** Tauri v2 mobile (iOS / Android), Swift +
  Foundation Models bridge (Apple Intelligence), Kotlin +
  AICore bridge (Gemini Nano).
- **Cloud:** Cloudflare Pages, D1, R2, Workers Analytics
  Engine, KV, Cloudflare Access.
- **AI:** OpenAI-compatible LLM (any provider), Ollama, LM
  Studio, on-device Apple Intelligence, on-device Gemini Nano.

### 13. Try it / get involved

The CTA section. Three columns:

- **Try it now:** live web app QR + URL; desktop download
  badges (Windows / macOS / Linux).
- **Read more:** GitHub repo, `MISSION.md`, `SELF_HOSTING.md`,
  `ANALYTICS.md`, `VR_INVESTIGATION_PLAN.md`.
- ~~**Tell us what you think:** survey link.~~ Skipped for
  this round — a new survey is on the way and the link will be
  added once it's live. The CTA section ships with two columns
  for now (Try it now / Read more); when the survey lands we
  add the third column and the gradient survey banner used by
  the rest of the series.

### 14. Footer

Authors, NOAA + Zyra attribution, license, build hash, current
date. Static.

---

## Interactive element inventory

Pulled together so we can confirm scope:

| # | Element | Where | Dependency |
|---|---|---|---|
| 1 | Sticky presentation timer | All sections | None — pure CSS/JS |
| 2 | Live demo iframe (default globe) | §4 | Live app reachable |
| 3 | Iframe `/health` probe + screenshot fallback | §4 | App's `/health` route or static `/index.html` HEAD |
| 4 | Effect-toggle deep-link buttons (terrain, labels, borders, auto-rotate) | §4 | App must honour query params for these toggles |
| 5 | Layout-toggle deep-link buttons (`?layout=1`, `?layout=2`, `?layout=4`) | §5 | App must honour `?layout=` param |
| 5b | Tour-launcher deep-link buttons (Climate Futures, general overview) | §6 | App must honour `?tour=` param |
| 5c | "Ask Orbit to take you on a tour" button | §6 | App must honour `?orbit=open&prompt=tour` |
| 5d | Annotated tour-task strip (icon ribbon: flyTo → setEnvView → loadDataset×4 → showRect …) | §6 | Inline SVG |
| 6 | "Ask Orbit" deep-link button (general chat) | §7 | App must honour `?orbit=open` |
| 7 | AR/VR screenshot carousel | §8 | Captured Quest screenshots |
| 8 | AR session MP4 loop | §8 | Captured Quest recording |
| 8a | "Tap to place Earth" tile (`<model-viewer>` + AR Quick Look on iOS / Scene Viewer on Android) | §8 | `terraviz-earth.glb` + `terraviz-earth.usdz` exported from `photorealEarth.ts` |
| 9 | Federation diagram with animated request fan-out | §10 | Inline SVG + CSS keyframes |
| 10 | Download badges linked to latest GitHub release | §9, §13 | Stable release URLs (already in `README.md`) |
| 11 | QR codes (live app, GitHub, desktop downloads, self-hosting) | Hero, §13 | Generated once, committed under `assets/qr/` |
| 12 | Iframe fullscreen toggle | §4 | Pure JS |
| 13 | Scroll-triggered fade-in | All sections | `IntersectionObserver` |
| 14 | `prefers-reduced-motion` honoured | All animations | Media query |

Items 4, 5, 5b, 5c, and 6 require small additions to the SPA
(URL-param handlers — terrain/labels/borders/auto-rotate
toggles, `?layout=`, `?tour=`, `?orbit=open` and the
`&prompt=tour` variant). **Confirmed in scope** — they ship as
P12 in the build phases below. P3–P7 still need a graceful
fallback for the brief window between poster deploy and SPA
param-handler deploy; each launcher button shows a static
screenshot if the iframe `/health` probe fails or if the SPA
param hasn't taken effect after a 2 s grace period.

## Build phases

Each phase is a single commit (DCO-signed) on
`claude/create-presentation-poster-4sqyF`. We commit each phase
before starting the next to keep edits bounded — same rule the
catalog plan files follow.

| Phase | Deliverable |
|---|---|
| **P1** | Scaffold: `poster/sections/{_head,_styles.css,_body-open,_footer}.html`, `poster/sections/sec-01-hero.html`, empty placeholder partials for sec-02..sec-13, `poster/scripts/build_poster.py`, `poster/README.md`, design tokens, Source Sans 3 + Source Code Pro fonts, sticky timer (minimized by default). First run of the build script produces `poster/index.html` with the hero rendered and remaining sections as empty anchored placeholders — committed alongside the partials. |
| **P2** | §2 Mission + §3 feature gallery (links to anchors only). |
| **P3** | §4 globe section, including live demo iframe + `/health` probe + fallback. |
| **P4** | §5 multi-globe section — lockstep mechanics, layout-toggle buttons (with screenshot fallback if `?layout=` isn't live yet). |
| **P5** | §6 tours section — pitch, task table, "Orbit drives the app" architecture callout, tour-launcher buttons, "Ask Orbit for a tour" button, annotated tour-task strip SVG. |
| **P6** | §7 Orbit section, sequence diagram SVG, mock chat bubble (with the tours forward-link wired). |
| **P7** | §8 immersive section. Placeholder image boxes if Quest captures aren't ready; swap-in commit later. |
| **P8** | §9 multi-platform section + download badges. |
| **P9** | §10 federation section + architecture diagram SVG + CSS keyframe. |
| **P10** | §11 analytics + §12 tech stack + §13 CTA + §14 footer. |
| **P11** | Polish pass: a11y audit (axe), reduced-motion check, mobile breakpoint, link audit, Lighthouse run, plus the optional CI drift guard that re-runs `build_poster.py` and fails on any uncommitted diff in `poster/index.html`. |
| **P12** | SPA URL-param handlers for poster deep-links: terrain / labels / borders / auto-rotate toggles, `?layout={1,2,4}`, `?tour={id}`, `?orbit=open` (and the `&prompt=tour` variant), `?dataset={id}` (already supported). Lands as a regular SPA PR off `main`, not on the poster branch. |
| **P12.5** | "Tap to place Earth" model-viewer tile: export `terraviz-earth.glb` + `terraviz-earth.usdz` from `photorealEarth.ts`, commit under `poster/assets/xr/models/`, wire up the `<model-viewer>` tag in §8. Optional — ships in a follow-up commit if asset export turns out to be more than one commit's worth. |
| **P13** | Deploy: create the `terraviz-poster` Cloudflare Pages project (build command empty, output dir `poster/`, production branch `main`, preview deploys on), point a `zyra-project.org` subdomain at it once content is final, and update `poster/README.md` + the main repo `README.md` with the live URL. |

## Risks & tradeoffs

- **Live iframe brittleness.** If the SPA changes a route or
  removes a query param, the deep-link buttons silently break.
  Mitigation: each button has a static screenshot fallback shown
  under a "demo unreachable" banner from the `/health` probe.
- **Quest captures bottleneck.** §8 is the visual centerpiece;
  without real headset captures it falls flat. Mitigation: ship
  with annotated mockups, add a follow-up commit when captures
  arrive.
- **Federation is partially shipped.** Phase 1a is live; live
  federation across peer nodes is upcoming. The poster must say
  this clearly — overstating it would be dishonest and would also
  set up disappointment when readers click through to the docs.
- **Mobile is mid-flight.** PR #33 lands the iOS + Android
  release scaffolding; the on-device-LLM Phase 7 is design-only
  in `MOBILE_APP_PLAN.md`. By the time the poster goes live,
  PR #33 may be merged but TestFlight / Play Internal builds may
  not yet be public. Mitigation: §9 frames mobile as "shipping
  via PR #33" and on-device LLM as "upcoming Phase 7," with the
  mobile-platform badges linking to the PR until store builds
  exist, then swapping to invite links.
- **Bundle drift.** Three other posters in the series live in
  separate repos. If a token ever changes upstream, this poster
  can diverge silently. Mitigation: the design-tokens block is a
  single CSS `:root` rule with comments pointing at the source.
- **Render drift.** Because `poster/index.html` is committed
  alongside the partials, a contributor can edit a partial,
  forget to run `build_poster.py`, and ship a stale rendered
  file. Mitigation: the optional P10 CI drift guard
  (`build_poster.py` + `git diff --exit-code`) catches this in
  every PR — same shape as the existing
  `npm run check:privacy-page` check.
- **Print fallback.** The poster is web-first. A
  conference-ready A0 export would need a separate pass with
  print stylesheets and a different layout grid. Out of scope
  for this round.

## Open questions

Resolved before P1, captured here for the review record:

1. ~~**Venue / audience.**~~ **Resolved:** all of the above
   (conference poster session, stage talk, museum kiosk). Timer
   ships **minimized by default** with a tap-to-expand tab; see
   §0.
2. ~~**Author block & attribution.**~~ **Resolved:** single
   author — Eric Hackathorn, NOAA Global Systems Laboratory,
   ORCID 0000-0002-9693-2093 — rendered with the ORCID glyph
   exactly as the `zyra` poster does it.
3. ~~**Color palette.**~~ **Resolved:** hybrid — series tokens
   for chrome, `#4da6ff` for live/interactive call-outs.
4. ~~**Live demo URL & deep-links.**~~ **Resolved:** live deep
   links using `https://terraviz.zyra-project.org`. SPA
   URL-param handlers are **in scope as P11**.
5. ~~**VR/AR captures.**~~ **Resolved:** user is capturing
   Quest screenshots and video. P6 ships with annotated
   placeholders; a follow-up swap commit lands real captures.
   **New sub-question raised and answered in §8:** can a phone
   stand in for a headset for visitors without a Quest? Yes,
   via `<model-viewer>` + AR Quick Look (iOS) + Scene Viewer
   (Android). Tracked as **P11.5**. WebXR on iOS Safari is not
   available and is not expected to ship.
6. ~~**Catalog backend status framing.**~~ **Resolved:**
   federation framed as "drafted, with live cross-node
   operation coming next."
7. ~~**Survey URL.**~~ **Resolved:** skipped this round; a new
   survey is incoming and §13 will gain a third column + the
   series' gradient survey banner once the URL is final.
8. ~~**QR-code destinations.**~~ **Resolved:** all four —
   live web app, GitHub repo, desktop downloads page,
   self-hosting guide.
9. ~~**Hosting target.**~~ **Resolved:** Cloudflare Pages,
   separate project (`terraviz-poster`). See Deployment above.
10. ~~**Branch & commit cadence.**~~ **Resolved:**
    `claude/create-presentation-poster-4sqyF`, DCO sign-off,
    one phase per commit.

Still open:

11. **Mobile-platform badges in §9.** Confirm what to link from
    the iOS / Android badges before P7 lands. Options:
    TestFlight invite link, Play Internal Testing URL, or PR
    #33 as a placeholder until store builds exist. Default if
    not specified by P7: PR #33 link with a "join the test
    flight" tooltip, swapped to invite URLs once the store
    builds are live.

---

*Open questions 1–10 are resolved. Question 11 (mobile-platform
badge targets) has a sensible default and does not block P1.
P1 lands as the next commit.*
