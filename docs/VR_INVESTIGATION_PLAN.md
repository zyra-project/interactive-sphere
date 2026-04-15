# VR Investigation Plan — Meta Quest / WebXR

Feasibility investigation for running Interactive Sphere as an immersive
web experience on Meta Quest (and other WebXR-capable) headsets.

Status: **scaffolding landed**. A feature-gated "Enter VR" button opens
a minimal immersive session with a placeholder textured globe. Nothing
in the 2D experience changes when WebXR is absent.

---

## Goal

Let a visitor on a Meta Quest browser tap **Enter VR** and stand in
front of the globe in room-scale, then scrub through NOAA SOS datasets
with head + hand tracking. The existing 2D experience is untouched.

## Constraints found during exploration

### 1. MapLibre's canvas cannot be reused in WebXR

MapLibre GL JS owns its WebGL context, its render loop, its projection
matrices, and its viewport. WebXR requires a context that has been made
XR-compatible and a draw loop driven by `XRSession.requestAnimationFrame`
reading per-eye `XRView`s from an `XRFrame`. None of those hook points
are exposed by MapLibre, and MapLibre's globe projection is a Mercator
derivative that does not map cleanly onto a unit sphere in world space.

**Implication:** VR mode renders in a *separate* WebGL canvas with its
own scene graph. The 2D MapLibre canvas is hidden while in VR and
restored on exit.

### 2. No 3D engine dependency exists today

`package.json` currently lists four runtime deps — `maplibre-gl`,
`hls.js`, `axios`, `html2canvas`. Adding Three.js (~600 KB gzipped)
would nearly double the shipped JS. The investigation deliberately
avoids it: the scaffold is ~250 lines of vanilla WebGL2, which keeps
the bundle delta small and lets us reuse patterns from
`src/services/earthTileLayer.ts` (which already does raw WebGL inside
MapLibre's `CustomLayerInterface`).

If the VR scene grows beyond a textured sphere + video overlay + basic
hand interaction, we should revisit Three.js. Until then, vanilla WebGL
keeps the dependency surface honest.

### 3. Texture sources are reusable, projection is not

- **GIBS raster tiles** (zoom 0–8, Mercator) — used by MapLibre today.
  Loadable into vanilla WebGL as a `TEXTURE_2D` pyramid, but Mercator
  distorts near the poles. For VR we want equirectangular samples;
  either (a) stitch a single 4K equirectangular PNG per dataset server-
  side, or (b) sample Mercator tiles with a UV-space reprojection in
  the fragment shader. The scaffold ships with a placeholder
  (`/assets/Earth_Specular_2K.jpg`) while this decision is deferred.
- **HLS video textures** — `HLSService` produces a plain
  `HTMLVideoElement`. Vanilla WebGL can sample it via `texImage2D` each
  frame exactly as `earthTileLayer` already does.
- **Clouds / night lights / specular** — same story as tiles, just a
  multi-pass shader. Directly portable.

### 4. Security / sandbox

- No CSP header blocks `navigator.xr`. The Cloudflare Function at
  `functions/api/[[route]].ts` only proxies API calls, so it has no
  effect on WebXR.
- Tauri desktop has `"csp": null` and no capability entry gates
  `navigator.xr` (the API is navigator-level, not a plugin). The
  desktop app will silently decline VR because the wry webview has no
  XR device; this is handled by the feature detector returning `false`.
- Service worker (`sw.js`) caches tile fetches and does not interfere
  with WebXR session setup.

---

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  2D experience (today)   │         │  VR experience (new)     │
│                          │         │                          │
│  MapLibre GL JS canvas   │         │  Dedicated WebGL2 canvas │
│  ├─ GIBS raster tiles    │         │  ├─ Textured UV-sphere   │
│  ├─ earthTileLayer.ts    │ ◀── → ─▶│  ├─ XRSession render loop│
│  ├─ HLS video texture    │ (share  │  ├─ HLS video texture    │
│  └─ DOM UI overlays      │ assets) │  └─ In-scene UI (TBD)    │
└──────────────────────────┘         └──────────────────────────┘
         ▲                                         ▲
         │                                         │
         └───── vrUI.ts: Enter VR / Exit VR ───────┘
```

### New modules

| File | Responsibility |
|---|---|
| `src/utils/vrCapability.ts` | Feature detect `navigator.xr` + `immersive-vr` |
| `src/services/vrSession.ts` | WebXR lifecycle: request session, bind WebGL layer, drive frame loop, end cleanly |
| `src/services/vrGlobe.ts` | Minimal WebGL2 textured UV-sphere — geometry, shaders, per-frame draw |
| `src/ui/vrUI.ts` | Enter VR button, gated on capability, talks to vrSession |
| `src/styles/vr.css` | Button + canvas host styles (matches tokens.css glass surface) |

### Modified modules

| File | Change |
|---|---|
| `src/index.html` | Add `#vr-button` + `#vr-canvas-host` elements |
| `src/main.ts` | Call `initVrUI()` during boot |
| `src/styles/index.css` | `@import './vr.css'` |

### Rendering pipeline (scaffold)

1. `vrUI.initVrUI()` runs during boot. It feature-detects `navigator.xr`
   and `isSessionSupported('immersive-vr')`. If unsupported, the button
   stays hidden — zero impact on the 2D app.
2. On click, `vrSession.enterVr()` requests `immersive-vr` with
   `local-floor` reference space. It creates a WebGL2 canvas, calls
   `gl.makeXRCompatible()`, and sets `XRWebGLLayer` as the session's
   base layer.
3. Per frame, the session callback receives an `XRFrame`. We get the
   viewer pose in the reference space, then iterate views (one per
   eye). Each view provides a viewport, a projection matrix, and the
   eye's transform. We bind the viewport, pass matrices into
   `vrGlobe.render()`, and draw.
4. On exit (user presses the Quest button or the Exit VR UI), the
   session's `end` event fires; we restore the 2D DOM and release the
   WebGL resources.

---

## Scaffold scope (this PR)

What works:

- Feature-gated Enter VR button (hidden on non-XR browsers)
- `immersive-vr` session start + exit
- Stereo rendering at the headset's native resolution
- Textured UV-sphere placed at `[0, 1.3, -1.5]` in local-floor space
  (about arm's length in front of and at head height of a seated user)
- Placeholder texture = `Earth_Specular_2K.jpg`
- Clean resource teardown on session end

What is deliberately out of scope for this first cut:

- No GIBS tile loading in VR (placeholder texture only)
- No HLS video textures in VR
- No hand controllers / ray picking
- No in-VR UI (browse panel, playback transport) — exit to 2D first
- No camera sync with the 2D MapLibre view

Those become Phase 2+.

---

## Roadmap after the scaffold

### Phase 2 — real Earth textures
- Port `earthTileLayer.ts`'s day/night/cloud/specular compositing into
  `vrGlobe.ts` shaders. Either UV-reproject Mercator tiles in-shader
  or add a server-side equirectangular export.
- Share the cloud texture, night-lights, and specular via the existing
  asset URLs.

### Phase 3 — datasets in VR
- Wire `HLSService` video textures into `vrGlobe` so dataset playback
  works immersively.
- Reuse `playbackController` state — no duplicate scrubber.

### Phase 4 — interaction
- Controller ray picking for fly-to
- Pinch-to-zoom on hand controllers
- Orbit chat ("Ask Orbit") as a floating in-VR panel, rendered into a
  texture from a hidden DOM node

### Phase 5 — camera sync
- Entering VR inherits the current MapLibre view (lat/lng/zoom)
- Exiting VR writes the last VR camera pose back to MapLibre

---

## Open questions

1. **Projection**: UV-reproject Mercator in-shader (adds pole
   distortion handling) vs. ship a pre-stitched equirectangular per
   dataset (doubles storage but simpler runtime). Pre-stitch is
   probably the right call for static datasets; UV-reproject for live
   ones. Answer this before Phase 2.
2. **Performance**: 72 Hz stereo on Quest 2 means 144 draw calls/sec
   per layer. MapLibre's tile pyramid walking is not a great fit —
   simpler to rasterize a single equirectangular texture per frame.
3. **Accessibility**: Seated vs. standing default? Motion sickness
   mitigation (fixed comfort grid, vignette on rotation)?
4. **Non-Quest headsets**: PCVR via SteamVR browser, PSVR2, Vision
   Pro's Safari. All support WebXR; the scaffold should work there
   unmodified but has not been tested.

---

## Testing notes

- **Local dev**: `npm run dev`, open Chrome with the
  [WebXR API Emulator](https://chrome.google.com/webstore/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje)
  extension. Click Enter VR, use the emulator panel to move the
  headset.
- **On-device**: `npm run build && npm run preview`, expose the host
  over the LAN, open the URL in the Quest browser (needs HTTPS or
  `localhost` — the Quest browser accepts self-signed certs with a
  warning). WebXR requires a secure context.
- **CI**: no automated VR tests yet. `vrCapability` is unit-testable
  against a mocked `navigator.xr`.
