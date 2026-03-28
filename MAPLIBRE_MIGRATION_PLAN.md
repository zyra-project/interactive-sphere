# MapLibre GL JS Globe Migration Plan

## Executive Summary

Replace the custom Three.js sphere renderer with MapLibre GL JS v5+ as the primary globe engine, while retaining Three.js for advanced visual effects (night lights, clouds, sun) via MapLibre's `CustomLayerInterface`. This gives us real geographic infrastructure (tiles, labels, coordinates, terrain) without sacrificing the current visual quality.

---

## Motivation & Gains

### What we gain

| Capability | Current (Three.js) | With MapLibre GL JS |
|---|---|---|
| Base map | Single 6K equirectangular texture | Vector/raster tiles with infinite zoom detail |
| Geographic awareness | Manual raycasting for lat/lng | Native coordinate system, built-in geocoding |
| Projections | Sphere geometry only | Globe ↔ Mercator seamless transition (~zoom 12) |
| Atmosphere | Custom dual-layer shaders | Built-in `atmosphere-blend` + custom layers |
| Raster overlays | Full sphere texture replacement | Layered raster sources with opacity/compositing |
| Video overlays | Full sphere texture replacement | `VideoSource` with geographic bounds |
| Labels & boundaries | None | Vector tile labels, borders, cities, POIs |
| 3D terrain | Flat sphere | DEM-based terrain elevation |
| Navigation | Custom fly-to (2.5s lerp) | Built-in `flyTo()`, `easeTo()`, `fitBounds()` |
| Markers & popups | None | Native markers, popups, GeoJSON layers |
| Touch/mobile | Custom touch handler | Battle-tested gesture handling |
| Accessibility | Manual ARIA attributes | Built-in keyboard navigation, ARIA support |

### New LLM tool opportunities

- **`fit_bounds(bbox)`** — navigate to bounding boxes ("show me the Amazon basin")
- **`add_overlay(geojson)`** — LLM can highlight regions, draw paths, place markers
- **`toggle_layer(id)`** — show/hide labels, boundaries, terrain alongside datasets
- **`geocode(place_name)`** — resolve place names to coordinates natively
- **`get_visible_features()`** — query what geographic features are in the current view for richer context

---

## Architecture: Hybrid Approach

```
┌──────────────────────────────────────────────────┐
│                   MapLibre GL JS                  │
│                 (Primary Map Engine)              │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │ Vector Tiles │  │ Raster Tiles│  │  Labels  │ │
│  │ (base map)   │  │ (datasets)  │  │ Borders  │ │
│  └─────────────┘  └─────────────┘  └──────────┘ │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │     CustomLayerInterface (Three.js)         │  │
│  │  ┌──────────┐ ┌────────┐ ┌──────────────┐ │  │
│  │  │Night Glow│ │ Clouds │ │ Sun + Atmos.  │ │  │
│  │  └──────────┘ └────────┘ └──────────────┘ │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │     ImageSource / VideoSource               │  │
│  │     (equirectangular dataset overlays)      │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Key principle**: MapLibre owns the WebGL context, camera, and input. Three.js runs inside MapLibre's custom layer system for effects that MapLibre can't do natively.

---

## Phase Breakdown

### Phase 0: Foundation & Proof of Concept

**Goal**: Get MapLibre rendering a globe with atmosphere, confirm it works alongside the existing build system.

**Tasks**:
1. Add `maplibre-gl` dependency (v5+)
2. Create `src/services/mapRenderer.ts` — new renderer wrapping MapLibre
   - Initialize map with `projection: { type: 'globe' }`
   - Configure atmosphere via style spec (`sky` layer, `atmosphere-blend`)
   - Dark/space style for the base (to match current starfield aesthetic)
   - Wire to existing container element
3. Create minimal dark globe style JSON (no labels initially, dark ocean/land fill)
4. Verify Vite build works, bundle size is acceptable
5. Side-by-side comparison: current Three.js vs MapLibre globe rendering

**Deliverable**: MapLibre globe renders in the app with atmosphere, dark styling, basic interaction.

**Risk assessment**:
- MapLibre v5 globe is relatively new (Jan 2025) — may have edge cases
- Bundle size increase (~300-500KB gzipped for maplibre-gl)
- Style spec learning curve

---

### Phase 1: Input & Navigation Migration

**Goal**: Replace `inputHandler.ts` with MapLibre's native controls.

**Tasks**:
1. Map current controls to MapLibre equivalents:
   - Auto-rotation → `map.rotateTo()` in `requestAnimationFrame` loop or plugin
   - Inertia/damping → MapLibre has built-in inertia
   - Zoom limits → `map.setMinZoom()` / `map.setMaxZoom()`
   - Double-click reset → `map.on('dblclick', () => map.flyTo(defaultView))`
   - Fly-to animation → `map.flyTo({ center, zoom, duration })`
2. Lat/lng tracking: replace raycaster with `map.on('mousemove', e => e.lngLat)`
3. Port `fly-to` action handler to use `map.flyTo()` with `center: [lon, lat]`
4. Expose camera state (center, zoom, bearing, pitch) for LLM vision context
5. Deprecate `inputHandler.ts` once parity is confirmed

**Deliverable**: All user interactions work through MapLibre. Fly-to actions from LLM work.

---

### Phase 2: Dataset Overlay System

**Goal**: Display equirectangular image and video datasets on the MapLibre globe.

**Tasks**:
1. **Image datasets**: Use MapLibre `ImageSource` with world bounds `[[-180,85],[180,85],[180,-85],[-180,-85]]`
   - Test with current SOS equirectangular images
   - Handle resolution fallback chain (4096 → 2048 → 1024)
   - Layer ordering: dataset above base map, below labels
2. **Video datasets**: Use MapLibre `VideoSource` with same world bounds
   - Wire HLS.js → `<video>` element → VideoSource
   - Verify frame updates render correctly on globe projection
   - Port playback controls (play/pause/seek/rate)
3. **Layer management**:
   - `addSource()` / `removeSource()` for dataset swapping
   - Opacity control for dataset layers
   - Generation counter pattern to prevent race conditions (port from current code)
4. **Fallback**: If `ImageSource` on globe has quality issues at edges/poles, implement a custom raster tile layer that slices the equirectangular image into tiles client-side

**Deliverable**: All existing image and video datasets render on the MapLibre globe.

**Key risk**: MapLibre's `ImageSource` is designed for bounded regions on flat projections. Full-globe equirectangular coverage on the globe projection needs testing. If it distorts at poles, we may need:
- Option A: Custom `RasterTileSource` with client-side tile slicing
- Option B: Three.js custom layer rendering the equirectangular texture on a sphere mesh (closest to current approach)
- Option C: Pre-tile datasets server-side (best long-term, higher effort)

---

### Phase 3: Visual Effects via Custom Layers

**Goal**: Restore day/night lighting, clouds, sun, and enhanced atmosphere.

**Tasks**:
1. **Three.js custom layer bridge**:
   - Create `src/services/customEffectsLayer.ts` implementing `CustomLayerInterface`
   - Share MapLibre's WebGL context with Three.js
   - Sync Three.js camera matrix with MapLibre's projection matrix each frame
2. **Night lights layer**:
   - Port night-lights emissive shader from `earthMaterials.ts`
   - Render as a slightly-above-surface sphere in custom layer
   - Use `sunDir` uniform for terminator calculation
   - Only visible when default earth view is active (not during dataset display)
3. **Cloud overlay layer**:
   - Port cloud texture loading and alpha processing
   - Render as custom layer sphere at radius slightly above surface
   - Sync rotation with globe
   - Night-side darkening shader
4. **Sun & atmosphere enhancements**:
   - Port sun sprite (core + glow) as custom layer billboard
   - Evaluate if MapLibre's built-in atmosphere is sufficient or if custom Rayleigh/Mie shaders are needed
   - If custom needed: port inner/outer atmosphere as custom layer
5. **Sun position API**:
   - Port `enableSunLighting(lat, lng)` to update custom layer uniforms
   - Integrate with MapLibre's light source for consistent shadow direction

**Deliverable**: Default Earth view matches current visual quality with day/night, clouds, atmosphere.

**Complexity note**: This is the hardest phase. The `CustomLayerInterface` requires careful matrix synchronization between MapLibre's internal projection and Three.js's camera. The `maplibre-three-plugin` or `maplibre-gl-shader-layer` packages may help, but globe projection adds complexity.

---

### Phase 4: Enhanced Geographic Features

**Goal**: Leverage MapLibre's native capabilities that Three.js couldn't provide.

**Tasks**:
1. **Labels & boundaries layer**: Add optional vector tile layers for:
   - Country/state boundaries
   - City labels
   - Ocean/sea labels
   - Toggle-able from UI and LLM
2. **Markers & popups**: Enable the LLM to place geographic markers
   - Render `<<MARKER:lat,lon,label>>` actions as MapLibre markers
   - Click markers to show popup with info
3. **GeoJSON overlay**: Enable the LLM to highlight regions
   - New action: `<<REGION:geojson_or_id>>` for feature highlighting
   - Support common regions (countries, continents) by name
4. **Terrain**: Optional 3D terrain toggle
   - DEM tile source for elevation
   - Useful for topography/geology datasets
5. **Enhanced fly-to**:
   - `fitBounds()` for bounding-box navigation
   - Pitch/bearing control for cinematic views
   - LLM action: `<<VIEW:lat,lon,zoom,pitch,bearing>>`

**Deliverable**: Geographic context layers available for LLM and user interaction.

---

### Phase 5: LLM Context Enrichment

**Goal**: Use MapLibre's geographic awareness to give the LLM richer context.

**Tasks**:
1. **Visible features query**: On each LLM turn, include what countries/regions are visible in the current view via `map.queryRenderedFeatures()`
2. **Bounding box context**: Report current viewport bounds to LLM system prompt
3. **New tools**:
   - `fit_bounds` — navigate to named region or bbox
   - `add_marker` — place labeled marker on globe
   - `highlight_region` — highlight a GeoJSON feature
   - `toggle_labels` — show/hide geographic labels
   - `get_view_context` — return what's visible
4. **Geocoding integration**: Resolve place names in fly-to commands
5. **Update system prompt**: Document new capabilities in `docentContext.ts`

**Deliverable**: LLM has significantly richer geographic context and new interactive tools.

---

### Phase 6: Cleanup & Optimization

**Goal**: Remove legacy code, optimize bundle, ensure performance parity.

**Tasks**:
1. Remove `sphereRenderer.ts` (replaced by `mapRenderer.ts`)
2. Remove `inputHandler.ts` (replaced by MapLibre controls)
3. Refactor `earthMaterials.ts` → `customEffectsLayer.ts` (only custom layer code remains)
4. Update `three` dependency — may be able to use a lighter build (only what custom layers need)
5. Performance profiling:
   - Compare FPS on mobile (target: 60fps on mid-range phones)
   - Compare memory usage (tile cache vs single texture)
   - Compare initial load time
6. Bundle analysis — ensure maplibre-gl tree-shakes properly with Vite
7. Update all tests
8. Update CLAUDE.md module map

**Deliverable**: Clean codebase, no legacy code, performance parity or better.

---

## File Impact Map

| Current File | Migration Impact |
|---|---|
| `src/services/sphereRenderer.ts` | **Replace** → `src/services/mapRenderer.ts` |
| `src/services/earthMaterials.ts` | **Refactor** → `src/services/customEffectsLayer.ts` |
| `src/services/inputHandler.ts` | **Remove** — MapLibre handles all input |
| `src/services/datasetLoader.ts` | **Modify** — use MapLibre sources instead of Three.js textures |
| `src/services/hlsService.ts` | **Keep** — still needed for HLS streaming to `<video>` element |
| `src/services/docentContext.ts` | **Modify** — add new tools, update view context |
| `src/services/docentService.ts` | **Modify** — handle new action types |
| `src/ui/chatUI.ts` | **Minor** — render new action button types |
| `src/ui/playbackController.ts` | **Minor** — adapt positioning to MapLibre container |
| `src/main.ts` | **Modify** — boot MapLibre instead of Three.js |
| `src/types/index.ts` | **Modify** — add new action types, map config types |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Equirectangular images distort on globe projection | Medium | High | Test early in Phase 2; fallback to custom layer sphere rendering |
| MapLibre v5 globe bugs/limitations | Low-Medium | Medium | Pin version, monitor GitHub issues, custom layer fallbacks |
| Custom layer matrix sync issues | Medium | High | Use `maplibre-three-plugin`; test with simple geometry first |
| Bundle size increase | Low | Low | MapLibre is ~200KB gzipped; tree-shake Three.js to custom layer needs |
| Mobile performance regression | Medium | Medium | Profile early; MapLibre's tile LOD may actually improve mobile perf |
| Video texture on globe projection | Medium | Medium | Test `VideoSource` early; fallback to custom layer if needed |
| Night lights shader complexity in custom layer | Medium | Medium | Start with simpler day/night toggle; iterate to full shader quality |

---

## Suggested Implementation Order

```
Phase 0 (Foundation)          ~2-3 days
  ↓
Phase 1 (Navigation)          ~1-2 days
  ↓
Phase 2 (Dataset Overlays)    ~3-4 days  ← highest risk, test early
  ↓
Phase 3 (Visual Effects)      ~4-5 days  ← highest complexity
  ↓
Phase 4 (Geographic Features) ~2-3 days
  ↓
Phase 5 (LLM Enrichment)     ~2-3 days
  ↓
Phase 6 (Cleanup)             ~2-3 days
```

**Total estimated effort**: ~17-23 days of focused work.

**Critical path**: Phase 2 (dataset overlay) is the make-or-break validation. If equirectangular images don't work well with MapLibre's sources on globe projection, Phase 3's custom layer approach becomes the primary rendering path, which changes the architecture significantly.

**Recommendation**: Start Phase 0 and immediately spike on Phase 2's `ImageSource` globe test in parallel, before committing to the full migration.

---

## Open Questions

1. **Tile server**: Should we invest in server-side tiling of SOS datasets for optimal MapLibre rendering, or keep client-side equirectangular overlay?
2. **Style hosting**: Self-host the dark globe style + vector tiles, or use a tile provider?
3. **Skybox**: MapLibre's globe has a sky/atmosphere but no starfield cubemap. Add stars as a custom layer or accept the simpler look?
4. **Feature flags**: Should the migration be behind a feature flag for gradual rollout?
5. **Offline/fallback**: MapLibre requires tile server access. Should we keep a Three.js fallback for offline/degraded scenarios?
