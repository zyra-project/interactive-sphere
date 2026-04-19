/**
 * In-VR dataset browse panel — a floating CanvasTexture panel that
 * renders the dataset catalog so the user can switch datasets
 * without exiting the XR session.
 *
 * The panel mirrors a simplified version of the 2D `browseUI.ts`:
 * scrollable list of dataset cards with title and category, tappable
 * via controller raycast. Category chips and search are added in
 * later commits; this scaffold handles the mesh, canvas lifecycle,
 * and show/hide toggle.
 *
 * Same CanvasTexture + UV hit-test pattern as `vrHud.ts`. The caller
 * (`vrSession.ts`) adds the mesh to the scene, toggles visibility,
 * and calls `dispose()` on session end.
 *
 * See {@link file://./../../docs/VR_INVESTIGATION_PLAN.md VR_INVESTIGATION_PLAN.md}
 * Phase 3 section.
 */

import type * as THREE from 'three'

/** World-space size of the browse panel. */
const PANEL_WIDTH = 0.8
const PANEL_HEIGHT = 0.6

/**
 * Panel placement relative to the globe. Offset to the right so it
 * doesn't occlude the globe, and slightly forward (less negative Z)
 * so the text is at a comfortable reading distance. Y matches the
 * globe center so the user's gaze stays roughly level.
 */
const PANEL_OFFSET = { x: 0.7, y: 0, z: 0.3 }

/** Canvas resolution. 4:3 ratio matches the 0.8 × 0.6 m panel. */
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

/** Visual constants for the panel chrome. */
const BG_COLOR = 'rgba(13, 13, 18, 0.92)'
const BORDER_COLOR = 'rgba(255, 255, 255, 0.12)'
const TITLE_COLOR = '#e8eaf0'
const SUBTITLE_COLOR = 'rgba(232, 234, 240, 0.5)'
const ACCENT_COLOR = 'rgba(77, 166, 255, 0.9)'
const TITLE_BAR_HEIGHT = 60

export interface VrBrowseHandle {
  /** The Three.js mesh — add to the scene. */
  readonly mesh: THREE.Mesh
  /** Show or hide the panel. Hidden by default on creation. */
  setVisible(visible: boolean): void
  /** Whether the panel is currently visible. */
  isVisible(): boolean
  /**
   * Map a UV-space intersection to a semantic action. Returns null
   * if the ray hit the panel but not an interactive element.
   * Future commits add card-tap and scroll actions here.
   */
  hitTest(uv: { x: number; y: number }): VrBrowseAction | null
  /** Release GPU resources. Safe to call multiple times. */
  dispose(): void
}

export type VrBrowseAction = 'close'

/**
 * Draw the browse panel contents. For the scaffold commit this is
 * just the chrome (background, border, title bar, close button) and
 * a placeholder message. Subsequent commits add the actual catalog.
 */
function drawCanvas(ctx: CanvasRenderingContext2D): void {
  const w = CANVAS_WIDTH
  const h = CANVAS_HEIGHT

  ctx.clearRect(0, 0, w, h)

  // Background
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, w, h)

  // Border
  ctx.strokeStyle = BORDER_COLOR
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  // Title bar background
  ctx.fillStyle = 'rgba(77, 166, 255, 0.12)'
  ctx.fillRect(0, 0, w, TITLE_BAR_HEIGHT)

  // Title bar bottom border
  ctx.strokeStyle = BORDER_COLOR
  ctx.beginPath()
  ctx.moveTo(0, TITLE_BAR_HEIGHT)
  ctx.lineTo(w, TITLE_BAR_HEIGHT)
  ctx.stroke()

  // Title text
  ctx.fillStyle = TITLE_COLOR
  ctx.font = '600 28px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('Browse Datasets', 20, TITLE_BAR_HEIGHT / 2)

  // Close button (× in top-right corner)
  ctx.fillStyle = ACCENT_COLOR
  ctx.font = '500 32px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('✕', w - 30, TITLE_BAR_HEIGHT / 2)

  // Placeholder content
  ctx.fillStyle = SUBTITLE_COLOR
  ctx.font = '400 22px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Dataset catalog loading…', w / 2, (h + TITLE_BAR_HEIGHT) / 2)
}

/**
 * UV-space layout for hit regions. Canvas Y=0 is the top edge;
 * Three.js PlaneGeometry UV v=1 is the top edge. So canvas-Y maps
 * to v via: v = 1 - (canvasY / CANVAS_HEIGHT).
 */
const CLOSE_BUTTON = {
  uMin: (CANVAS_WIDTH - 50) / CANVAS_WIDTH,
  uMax: 1.0,
  vMin: 1 - TITLE_BAR_HEIGHT / CANVAS_HEIGHT,
  vMax: 1.0,
}

/**
 * Build the browse panel. Starts hidden (`mesh.visible = false`).
 * Caller adds it to the scene and toggles visibility via
 * `setVisible()`.
 */
export function createVrBrowse(THREE_: typeof THREE): VrBrowseHandle {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) throw new Error('[VR Browse] 2D canvas context unavailable')

  const texture = new THREE_.CanvasTexture(canvas)
  texture.colorSpace = THREE_.SRGBColorSpace
  texture.minFilter = THREE_.LinearFilter
  texture.magFilter = THREE_.LinearFilter

  const material = new THREE_.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })

  const geometry = new THREE_.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT)
  const mesh = new THREE_.Mesh(geometry, material)
  mesh.renderOrder = 9
  mesh.visible = false

  drawCanvas(ctx2d)
  texture.needsUpdate = true

  let visible = false

  return {
    mesh,

    setVisible(v) {
      visible = v
      mesh.visible = v
    },

    isVisible() {
      return visible
    },

    hitTest(uv) {
      if (!visible) return null
      const { x: u, y: v } = uv
      if (
        u >= CLOSE_BUTTON.uMin && u <= CLOSE_BUTTON.uMax &&
        v >= CLOSE_BUTTON.vMin && v <= CLOSE_BUTTON.vMax
      ) {
        return 'close'
      }
      return null
    },

    dispose() {
      texture.dispose()
      material.dispose()
      geometry.dispose()
    },
  }
}
