/**
 * ViewportManager — orchestrates one or more synchronised MapRenderer
 * instances inside a CSS grid container.
 *
 * Phase 1 scope: creates/destroys MapRenderer instances to match a
 * target layout (1, 2h, 2v, or 4 panels), wires each one's `move`
 * event to mirror camera state to every sibling, and tracks a
 * "primary" index that drives playback, screenshots, and the info
 * panel. Each viewport shows the same base Earth — per-viewport
 * datasets come in Phase 2.
 *
 * The grid element passed to `init()` owns the direct child divs for
 * each panel (`.map-viewport`). UI overlays (#ui) sit above the grid
 * in the DOM tree and are not our concern.
 *
 * Camera sync uses `jumpTo` (not `easeTo`) on siblings so motion is
 * instantaneous and doesn't compound across panels. A `syncLock` flag
 * prevents the move event we dispatch on siblings from re-entering
 * the sync path — without it, every `jumpTo` would fire another
 * `move` and we'd recurse forever.
 *
 * Consumers that previously held a direct `MapRenderer` reference go
 * through `getPrimary()`. The module-level `activeRenderer` singleton
 * in mapRenderer.ts is kept in sync via `setActiveMapRenderer()` so
 * screenshotService (which can't easily take a renderer argument)
 * always captures the primary.
 */

import { MapRenderer, setActiveMapRenderer } from './mapRenderer'
import { logger } from '../utils/logger'

/** Viewport layout identifier. */
export type ViewLayout = '1' | '2h' | '2v' | '4'

/** How many panels a given layout renders. */
const PANEL_COUNT: Record<ViewLayout, number> = {
  '1': 1,
  '2h': 2,
  '2v': 2,
  '4': 4,
}

/** CSS grid-template for each layout. */
const GRID_TEMPLATE: Record<ViewLayout, string> = {
  '1': '"a" / 1fr',
  '2h': '"a b" / 1fr 1fr',
  '2v': '"a" "b" / 1fr 1fr',
  '4': '"a b" "c d" / 1fr 1fr',
}

/** One panel in the grid. */
interface Viewport {
  index: number
  container: HTMLDivElement
  renderer: MapRenderer
  onMove: () => void
}

export class ViewportManager {
  private grid: HTMLElement | null = null
  private viewports: Viewport[] = []
  private layout: ViewLayout = '1'
  private primaryIndex = 0
  /** Re-entrancy guard for mirrored camera moves. */
  private syncLock = false

  /**
   * Initialize the manager with a grid element and the starting layout.
   * Creates the initial set of panels and their MapRenderers.
   */
  init(grid: HTMLElement, initialLayout: ViewLayout = '1'): void {
    this.grid = grid
    this.applyGridTemplate(initialLayout)
    this.layout = initialLayout

    const count = PANEL_COUNT[initialLayout]
    for (let i = 0; i < count; i++) {
      this.addViewport(i)
    }
    this.refreshActiveRenderer()
  }

  /**
   * Change the layout. Adds or removes panels as needed, reusing
   * existing ones. Camera state is copied from the primary to any
   * newly-created panels so the visual transition is seamless.
   */
  setLayout(layout: ViewLayout): void {
    if (!this.grid) {
      logger.warn('[ViewportManager] setLayout called before init')
      return
    }
    if (layout === this.layout) return

    const targetCount = PANEL_COUNT[layout]
    const current = this.viewports.length

    // Remove excess panels (back-to-front so indices stay stable)
    while (this.viewports.length > targetCount) {
      const vp = this.viewports.pop()!
      this.destroyViewport(vp)
    }

    this.applyGridTemplate(layout)
    this.layout = layout

    // Add new panels seeded from the primary's current camera state
    while (this.viewports.length < targetCount) {
      const idx = this.viewports.length
      this.addViewport(idx)
    }

    // Primary might have been removed — clamp
    if (this.primaryIndex >= this.viewports.length) {
      this.primaryIndex = 0
    }
    this.refreshActiveRenderer()
    this.resizeAll()
  }

  /** Get the primary (drives playback/screenshots/info panel). */
  getPrimary(): MapRenderer | null {
    return this.viewports[this.primaryIndex]?.renderer ?? null
  }

  /** Get all current renderers in panel order. */
  getAll(): MapRenderer[] {
    return this.viewports.map(v => v.renderer)
  }

  /** Current layout. */
  getLayout(): ViewLayout {
    return this.layout
  }

  /** Current primary index. */
  getPrimaryIndex(): number {
    return this.primaryIndex
  }

  /**
   * Mark a panel as primary. Updates the active-renderer singleton so
   * screenshot consumers pick up the change.
   */
  promoteToPrimary(index: number): void {
    if (index < 0 || index >= this.viewports.length) {
      logger.warn(`[ViewportManager] promoteToPrimary: index ${index} out of range`)
      return
    }
    if (index === this.primaryIndex) return
    this.primaryIndex = index
    this.refreshActiveRenderer()
  }

  /** Resize all MapLibre instances — call after CSS grid changes. */
  resizeAll(): void {
    for (const vp of this.viewports) {
      vp.renderer.getMap()?.resize()
    }
  }

  /** Dispose all viewports. */
  dispose(): void {
    for (const vp of this.viewports) {
      this.destroyViewport(vp)
    }
    this.viewports = []
    setActiveMapRenderer(null)
    this.grid = null
  }

  // --- internals ---

  private applyGridTemplate(layout: ViewLayout): void {
    if (!this.grid) return
    this.grid.style.display = 'grid'
    // Explicit template with named areas so we can reliably assign
    // each panel to a grid cell via grid-area: a/b/c/d.
    this.grid.style.gridTemplate = GRID_TEMPLATE[layout]
    this.grid.setAttribute('data-layout', layout)
  }

  private addViewport(index: number): void {
    if (!this.grid) return

    const container = document.createElement('div')
    container.className = 'map-viewport'
    container.style.position = 'relative'
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.background = '#000'
    container.style.overflow = 'hidden'
    container.setAttribute('data-viewport-index', String(index))
    // Assign to a named grid area — a/b/c/d in panel order.
    container.style.gridArea = String.fromCharCode('a'.charCodeAt(0) + index)
    this.grid.appendChild(container)

    const renderer = new MapRenderer()
    const canvasId = index === 0 ? 'globe-canvas' : `globe-canvas-${index}`
    renderer.init(container, { canvasId })

    // If there's already a primary, copy its camera state so new panels
    // don't flash the default center before their first sync.
    const primary = this.viewports[this.primaryIndex]?.renderer.getMap()
    if (primary) {
      const map = renderer.getMap()
      if (map) {
        // Run after the new map's 'load' so the camera is definitely set
        map.once('load', () => {
          map.jumpTo({
            center: primary.getCenter(),
            zoom: primary.getZoom(),
            bearing: primary.getBearing(),
            pitch: primary.getPitch(),
          })
        })
      }
    }

    const onMove = () => this.syncCameras(index)
    renderer.getMap()?.on('move', onMove)

    this.viewports.push({ index, container, renderer, onMove })
  }

  private destroyViewport(vp: Viewport): void {
    // Remove the move listener before disposing so dispose() doesn't
    // trigger a cascading sync while the renderer is being torn down.
    vp.renderer.getMap()?.off('move', vp.onMove)
    vp.renderer.dispose()
    vp.container.remove()
  }

  /**
   * Mirror the camera state from the source panel to every sibling.
   * Uses `jumpTo` (instantaneous) so siblings don't lag or animate,
   * and a re-entrancy guard so the mirrored `move` events don't
   * re-enter this function and recurse.
   */
  private syncCameras(sourceIdx: number): void {
    if (this.syncLock) return
    if (this.viewports.length <= 1) return

    const sourceMap = this.viewports[sourceIdx]?.renderer.getMap()
    if (!sourceMap) return

    const center = sourceMap.getCenter()
    const zoom = sourceMap.getZoom()
    const bearing = sourceMap.getBearing()
    const pitch = sourceMap.getPitch()

    this.syncLock = true
    try {
      for (let i = 0; i < this.viewports.length; i++) {
        if (i === sourceIdx) continue
        const siblingMap = this.viewports[i].renderer.getMap()
        if (!siblingMap) continue
        siblingMap.jumpTo({ center, zoom, bearing, pitch })
      }
    } finally {
      this.syncLock = false
    }
  }

  /** Update the module-level active-renderer slot to point at primary. */
  private refreshActiveRenderer(): void {
    const primary = this.viewports[this.primaryIndex]?.renderer ?? null
    setActiveMapRenderer(primary)
  }
}
