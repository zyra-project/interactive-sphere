/**
 * Credits panel — Tools → Credits.
 *
 * Single canonical surface for every attribution TerraViz needs to
 * display: basemap providers (NASA GIBS, OpenMapTiles, OSM,
 * terrain) and per-dataset developer / source / license credits.
 *
 * STATUS · STUB. This file currently holds the design only. The
 * implementation lands in follow-up commits to this PR after the
 * design is reviewed.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why a panel
 * ─────────────────────────────────────────────────────────────────
 *
 * Today each MapRenderer instance carries a stock MapLibre
 * AttributionControl in compact mode, which renders as an "i" pill
 * with the basemap attributions. In multi-globe layouts that pill
 * appears once per panel, eating layout in the small-viewport /
 * embedded-iframe contexts that the §1 globe demo lives in.
 *
 * The stock control also has no way to surface dataset-level
 * credits — a dataset's `developers` / `organization` /
 * `source_url` / `license` fields stay buried in the Dataset info
 * panel. That contradicts the publisher-side framing in
 * MISSION.md ("research groups sharing visualizations") — if
 * publishers' work appears on screen, their credits should too.
 *
 * Tools → Credits replaces the per-panel pills with a single
 * discoverable entry shared across all panels. Mirrors Mapbox's
 * "i" attribution dialog, Apple Maps' "Legal", and Google Maps'
 * Settings → Credits patterns — accepted as legally compliant
 * with OSM ODbL ("attribution in a manner reasonable to the
 * medium").
 *
 * ─────────────────────────────────────────────────────────────────
 * Data flow — phantom sources
 * ─────────────────────────────────────────────────────────────────
 *
 * Both kinds of credit ride the same MapLibre channel: source
 * `attribution` strings, read at render time from
 * `map.getStyle().sources[…].attribution`.
 *
 * Basemap sources (Blue Marble, Black Marble, OpenMapTiles, etc.)
 * already declare `attribution` in mapRenderer.ts's style spec —
 * no change needed there.
 *
 * Dataset loads add a phantom GeoJSON source per dataset:
 *
 *     map.addSource(`__dataset-credits-${id}`, {
 *       type: 'geojson',
 *       data: { type: 'FeatureCollection', features: [] },
 *       attribution: composeDatasetAttribution(dataset),
 *     })
 *
 * The source carries no features and no layers reference it; it
 * exists only to feed its attribution string into MapLibre's
 * source-attribution pipeline. Unload removes the source; the
 * attribution disappears with it.
 *
 * Result: this panel never tracks a "loaded datasets" set or
 * subscribes to viewportManager state. It walks
 * `map.getStyle().sources` for each viewport at render time and
 * de-dupes. Single source of truth = MapLibre's source map.
 *
 * Operator forks that swap basemap providers or wire in custom
 * overlays just set `attribution` on their source the same way —
 * the panel reflects the change automatically. No panel-side code
 * touches dataset or basemap specifics.
 *
 * ─────────────────────────────────────────────────────────────────
 * Layout
 * ─────────────────────────────────────────────────────────────────
 *
 *     ┌─ Credits ──────────────────────────────────┐
 *     │                                            │
 *     │ Basemap                                    │
 *     │ • NASA Blue Marble · Black Marble — public │
 *     │   domain                                   │
 *     │ • © OpenMapTiles · © OpenStreetMap         │
 *     │   contributors — ODbL                      │
 *     │ • Mapzen Terrain — open-data               │
 *     │                                            │
 *     │ Loaded — Panel 1                           │
 *     │ Sea-Surface Temperature (1981–2023)        │
 *     │ • Data: NOAA NCEI                          │
 *     │ • Visualization: Eric Hackathorn (NOAA GSL)│
 *     │ • License: CC BY 4.0                       │
 *     │                                            │
 *     │ Loaded — Panel 2                           │
 *     │ ...                                        │
 *     └────────────────────────────────────────────┘
 *
 * Reactive — sections appear / disappear as datasets load /
 * unload across panels.
 *
 * Visual / interaction shape mirrors the existing privacyUI panel:
 * dark glass surface, escape-to-close, focus-trap, click-out-to-
 * close, ARIA labelled. The Credits panel reuses the privacy
 * dialog's CSS skeleton (`.privacy-ui-panel` etc.) with a Credits-
 * specific class hierarchy on top.
 *
 * ─────────────────────────────────────────────────────────────────
 * Multi-globe
 * ─────────────────────────────────────────────────────────────────
 *
 * Each MapRenderer owns its own style + sources. The panel
 * iterates viewportManager's panels, walks each map's sources,
 * and groups dataset credits under per-panel headings (Loaded —
 * Panel 1 / Loaded — Panel 2 / ...). Basemap sources merge
 * across panels (they're the same on every panel today; if a
 * future feature lets a panel show a different basemap, the
 * Basemap section grows accordingly).
 *
 * ─────────────────────────────────────────────────────────────────
 * Removal of stock AttributionControl
 * ─────────────────────────────────────────────────────────────────
 *
 * mapRenderer.ts currently constructs the map with
 * `attributionControl: { compact: true }`. This PR sets it to
 * `false` and adds a Tools → Credits entry instead. The
 * `attribution` strings on each source stay — they're still the
 * data source for the new panel. An operator who forks TerraViz
 * and wants the stock control back just sets the option back to
 * `{ compact: true }` and skips the Credits menu entry; one-line
 * revert.
 *
 * ─────────────────────────────────────────────────────────────────
 * Legal posture
 * ─────────────────────────────────────────────────────────────────
 *
 *   - OSM ODbL: "© OpenStreetMap contributors" remains visible
 *     in a credit dialog discoverable from the menu, the same
 *     standard Mapbox / Apple / Google use.
 *   - NASA: "appreciated" credit stays visible.
 *   - OpenMapTiles, Mapzen, others: same.
 *   - Dataset-level attribution becomes systematic for the first
 *     time — directly supports the publisher-credit framing in
 *     MISSION.md.
 *
 * ─────────────────────────────────────────────────────────────────
 * Implementation outline (what lands once the design is approved)
 * ─────────────────────────────────────────────────────────────────
 *
 *   1. composeDatasetAttribution(dataset: Dataset): string
 *      - Pure function, fed Dataset metadata.
 *      - Output shape: `${title} — Data: ${...} · Vis: ${...} ·
 *        ${license_label}`. Skips fields that aren't populated.
 *      - Tested independently with synthetic Dataset rows.
 *
 *   2. registerDatasetCreditsSource(map, dataset)
 *      - Adds the phantom GeoJSON source on dataset load.
 *      - Called from datasetLoader.ts in both the
 *        loadVideoDataset and loadImageDataset paths.
 *
 *   3. unregisterDatasetCreditsSource(map, datasetId)
 *      - Removes the phantom source on dataset unload / replace.
 *      - Called from the same datasetLoader.ts unload paths.
 *
 *   4. openCreditsPanel() / closeCreditsPanel() — main exports
 *      - Build the panel DOM (or unhide a pre-rendered shell).
 *      - Walk every viewport's map, collect sources, group by
 *        panel for dataset attributions and merge for basemap.
 *      - Render. Wire close handlers (ESC, click-out, X button).
 *
 *   5. Tools menu entry
 *      - toolsMenuUI.ts gets a "Credits" item; click calls
 *        openCreditsPanel().
 *
 *   6. mapRenderer.ts changes
 *      - `attributionControl: { compact: true }` → `false`.
 *      - No other source / style changes.
 *
 *   7. Tests
 *      - Unit · composeDatasetAttribution covers
 *        title-only / data-only / full fields / missing license.
 *      - Unit · registerDatasetCreditsSource adds + carries
 *        the right attribution string.
 *      - Integration · openCreditsPanel reads sources from a
 *        mocked MapRenderer and renders both Basemap and Loaded
 *        sections.
 *      - Integration · multi-panel dataset credits group under
 *        the right panel heading.
 *      - A11y · panel uses the same focus-trap / ESC pattern as
 *        privacyUI; Tools → Credits keyboard-navigable.
 *
 * ─────────────────────────────────────────────────────────────────
 * Out of scope for this PR
 * ─────────────────────────────────────────────────────────────────
 *
 *   - Publisher-portal forms that collect the dataset metadata
 *     this panel renders. Drafted under
 *     docs/CATALOG_PUBLISHING_TOOLS.md; that work proceeds
 *     independently. SOS-imported rows that lack `developers`
 *     etc. simply render with a shorter credit — fields the
 *     panel doesn't have, it doesn't show.
 *   - Localised attribution strings. Today everything's
 *     English-only — same posture as the rest of the app.
 *   - Per-dataset link-out targets (clickable affiliation URLs).
 *     Trivial follow-up once the panel ships.
 */

// Implementation TBD pending design review on this PR.
export {}
