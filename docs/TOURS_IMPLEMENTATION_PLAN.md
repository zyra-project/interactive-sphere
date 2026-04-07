# Tours Implementation Plan

SOS Explorer tours are sequential JSON task lists that orchestrate the globe: fly the camera, load datasets, show text overlays, pause for user input, control animation, etc. This plan covers adding tour playback support to the Interactive Sphere web app.

**Reference**: [Tour Task Reference Guide](https://sos.noaa.gov/support/sosx/manuals/tour-builder-guide-complete/tour-task-reference-guide/)

---

## Phase 1 — Core Engine (MVP) ✅

**Status: Implemented** — committed on branch `claude/implement-tours-feature-QUGHl`

### New files

| File | Responsibility |
|---|---|
| `src/services/tourEngine.ts` | Parse tour JSON, execute tasks sequentially, manage playback state |
| `src/ui/tourUI.ts` | Tour overlay — text boxes, progress indicator, playback controls |

### Supported tasks

| Task | Maps to existing API |
|---|---|
| `flyTo` | `renderer.flyTo(lat, lon, altMi * 1.60934)` — returns a Promise |
| `showRect` / `hideRect` | DOM overlay positioned via `xPct`/`yPct`/`widthPct`/`heightPct` |
| `pauseForInput` | Pause engine; resume on play button or spacebar |
| `pauseSeconds` | `setTimeout` for the given duration |
| `loadDataset` | Calls `InteractiveSphere.loadDataset(id)` via callback |
| `unloadAllDatasets` | Calls `goHome()` via callback |
| `datasetAnimation` | Toggle play/pause on current video |
| `envShowDayNightLighting` | `renderer.enableSunLighting()` / `disableSunLighting()` |
| `envShowClouds` | `renderer.loadCloudOverlay()` / `removeCloudOverlay()` |
| `setGlobeRotationRate` | `renderer.setRotationRate(rate)` (new method) |

### Architecture

```
tour.json
   │
   ▼
TourEngine                          TourUI
┌─────────────────────┐       ┌──────────────────────┐
│ tasks: TourTask[]   │──────▶│ Tour overlay panel    │
│ currentIndex: number│       │ - Text boxes (showRect)│
│ state: 'playing'    │       │ - Progress bar        │
│       | 'paused'    │       │ - Play/Pause/Next/Prev│
│       | 'stopped'   │       │ - Step counter        │
│                     │       └──────────────────────┘
│ execute(task) ──────┤
│   ├─ flyTo ─────────┼──▶ renderer.flyTo()
│   ├─ loadDataset ───┼──▶ callbacks.loadDataset()
│   ├─ showRect ──────┼──▶ tourUI.showTextBox()
│   ├─ pauseForInput ─┼──▶ engine.pause() → awaits resume
│   └─ ...            │
└─────────────────────┘
```

### Key design decisions

1. **Task execution is async/await** — each task executor returns a `Promise` that resolves when the task completes (e.g., `flyTo` resolves on `moveend`, `pauseSeconds` resolves after timeout, `pauseForInput` resolves when user clicks play).

2. **Callbacks interface** — the engine doesn't import `InteractiveSphere` directly. Instead it receives a `TourCallbacks` object:
   ```typescript
   interface TourCallbacks {
     loadDataset(id: string): Promise<void>
     unloadAllDatasets(): Promise<void>
     getRenderer(): GlobeRenderer
     togglePlayPause(): void
     isPlaying(): boolean
     onTourEnd(): void
     announce(message: string): void
   }
   ```

3. **Tour state lives on `InteractiveSphere`** — similar to `playbackState`, a `tourEngine: TourEngine | null` field. When a `tour/json` dataset is loaded, it fetches the JSON and creates a `TourEngine` instead of loading an image/video.

4. **Text boxes are DOM overlays** — not WebGL. Positioned with CSS as percentages of the viewport. Styled with the existing glass-surface aesthetic. Support SOS `caption`, `fontSize`, `fontColor`, `isClosable` properties. `<color=X>` and `<i>` markup in captions is parsed into HTML.

5. **Altitude conversion** — SOS uses miles (`altmi`), the renderer uses km. `altKm = altMi * 1.60934`.

6. **SOS coordinate system** — Origin at bottom-left, values 0–100. Converted to CSS `left`/`bottom` positioning.

### Modified existing files

| File | Change |
|---|---|
| `src/types/index.ts` | Tour type definitions (`TourFile`, `TourTaskDef`, `TourCallbacks`, etc.) |
| `src/main.ts` | Tour loading branch in `displayDataset`, `startTour`/`endTour`/`stopTour` methods |
| `src/services/mapRenderer.ts` | `setRotationRate()` method with configurable speed |
| `src/index.html` | Tour controls HTML + CSS |
| `src/ui/browseUI.ts` | Removed `catSet.delete('Tours')` filter |

---

## Phase 2 — Extended Tasks

Each task is an independent executor — add incrementally with no architectural changes.

| Task | Complexity | Notes |
|---|---|---|
| `question` | Medium | Image-based multiple-choice Q&A UI with answer checking |
| `pauseSeconds` | ✅ Done | Already implemented in Phase 1 |
| `playAudio` / `stopAudio` | Low | HTML5 `<audio>` element, supports async (continue) or sync (wait) |
| `playVideo` / `hideVideo` | Medium | Positioned `<video>` overlay with optional controls |
| `showImage` / `hideImage` | Low | Positioned `<img>` overlay, supports draggable/closable/resizable |
| `addPlacemark` / `hidePlacemark` | Low | Reuse `renderer.addMarker()` with custom icons |
| `loopToBeginning` | Trivial | Reset `currentIndex = 0` |
| `loadTour` (subtour) | Medium | Recursive engine or task splicing |
| `tiltRotateCamera` | Low | New renderer method for pitch/bearing animation |
| `showPopupHtml` / `hidePopupHtml` | Medium | iframe or innerHTML overlay |
| `addGroundOverlay` / `hideGroundOverlay` | Hard | New MapLibre image source + layer with lat/lon bounding box |
| `add360Media` / `hide360Media` | Hard | 360-degree image/video bubble viewer |
| `showInfoButton` / `hideInfoButton` | Low | Floating action button overlay |
| `resetCameraZoomOut` | Trivial | Fly to default center/zoom |
| `worldBorder` | Trivial | `renderer.toggleBoundaries()` |
| `stars` / `sun` / `earth` | Low–Medium | Environment toggles (some may need new renderer APIs) |
| `enableTourPlayer` | Trivial | Show/hide the tour controls bar |

---

## Phase 3 — Tour Discovery & Authoring

- **Tour browse section** — tours appear in the browse panel as a category (already enabled)
- **`runTourOnLoad` support** — auto-start a tour when a specific dataset loads (field already exists on `Dataset`)
- **Tour builder UI** — visual editor for creating/editing tour JSON files
- **Orbit integration** — LLM can suggest and start tours contextually
- **Tour asset bundling** — download tours + their referenced datasets for offline use (Tauri)

---

## Sample tour.json format

```json
{
  "tourTasks": [
    { "envShowDayNightLighting": "on" },
    { "envShowClouds": "on" },
    { "flyTo": { "lat": 31.0, "lon": -86.0, "altmi": 6000.0, "animated": true } },
    { "showRect": {
        "rectID": "textbox1",
        "caption": "Welcome to SOS Explorer!",
        "captionPos": "center",
        "fontSize": 20,
        "fontColor": "white",
        "isClosable": true,
        "xPct": 50.0, "yPct": 50.0,
        "widthPct": 50.0, "heightPct": 50.0,
        "showBorder": false
    }},
    { "pauseForInput": "" },
    { "hideRect": "textbox1" },
    { "loadDataset": { "id": "INTERNAL_SOS_55" } },
    { "datasetAnimation": { "animation": "on", "frameRate": "15 fps" } },
    { "pauseForInput": "" },
    { "unloadAllDatasets": "" },
    { "setGlobeRotationRate": 0.05 }
  ]
}
```

Each object in `tourTasks` has exactly one key identifying the task type, with the value being the task parameters (or an empty string for parameterless tasks like `pauseForInput`).
