/**
 * Floating in-VR HUD — a small panel with dataset title, play/pause
 * button, and exit-VR button. Rendered as a `CanvasTexture` on a
 * `PlaneGeometry` so we can use familiar 2D canvas drawing (text,
 * icons) instead of spinning up another shader for UI work.
 *
 * The HUD exposes its mesh so `vrSession` can attach it to the scene,
 * and a `hitTest(uv)` method so `vrInteraction` can translate a
 * raycast intersection into a semantic action. `vrInteraction` is
 * responsible for doing the raycast — this module only knows about
 * the 2D layout of its own buttons in UV space.
 *
 * See {@link file://./../../docs/VR_INVESTIGATION_PLAN.md VR_INVESTIGATION_PLAN.md}.
 */

import type * as THREE from 'three'

/** World-space size of the HUD plane. Tall-thin strip that tucks below the globe. */
const HUD_WIDTH = 0.5
const HUD_HEIGHT = 0.1

/**
 * Local-floor placement. Globe sits at `(0, 1.3, -1.5)` with 0.5 m
 * radius, so its bottom is at y≈0.8 and its nearest point at z≈-1.0.
 * HUD at (0, 0.75, -1.05) is just below the globe's visible bottom
 * edge and slightly closer to the user — natural glance-down zone
 * for both seated and standing poses.
 */
const HUD_POSITION = { x: 0, y: 0.75, z: -1.05 }

/** Canvas resolution. 5:1 ratio mirrors the plane's 0.5 × 0.1 m shape. */
const CANVAS_WIDTH = 1024
const CANVAS_HEIGHT = 205

/**
 * Hit-region layout in UV space. `u` runs 0 (left) → 1 (right), `v`
 * runs 0 (bottom) → 1 (top) — Three.js' default PlaneGeometry UVs.
 * All three regions are full-height bands; users don't need
 * fine-grained vertical targeting for buttons this small.
 */
const BUTTON_LAYOUT = {
  playPause: { uMin: 0.0, uMax: 0.18 },
  exit: { uMin: 0.82, uMax: 1.0 },
  // Middle 64 % is the dataset title — non-interactive.
} as const

export type VrHudAction = 'play-pause' | 'exit-vr'

export interface VrHudState {
  /** Title shown in the middle of the panel. Null/empty renders "No dataset". */
  datasetTitle: string | null
  /** Drives the play/pause icon. */
  isPlaying: boolean
  /** Hides the play/pause button when the loaded dataset is an image (no playback). */
  hasVideo: boolean
}

export interface VrHudHandle {
  /** The Three.js mesh — add to the scene, no further handling needed. */
  readonly mesh: THREE.Mesh
  /** Update visible state. Triggers a canvas redraw. */
  setState(state: VrHudState): void
  /**
   * Map a UV-space intersection (from a controller raycast) to an
   * action. Returns null if the ray hit the panel but not a button.
   * The caller (vrInteraction) supplies the UV directly from the
   * `Raycaster.intersectObject(mesh)` result.
   */
  hitTest(uv: { x: number; y: number }): VrHudAction | null
  dispose(): void
}

/**
 * Draw the HUD contents into a 2D canvas. Called every time state
 * changes — cheap enough at this resolution (1024 × 205) that we
 * don't bother with partial redraws.
 */
function drawCanvas(
  ctx: CanvasRenderingContext2D,
  state: VrHudState,
): void {
  const w = CANVAS_WIDTH
  const h = CANVAS_HEIGHT

  // Clear + translucent dark background. Matches the glass-surface
  // look used by the 2D UI (see src/styles/tokens.css).
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(13, 13, 18, 0.85)'
  ctx.fillRect(0, 0, w, h)

  // Thin border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  // --- Left: play/pause button (or spacer if no video) ---
  const ppMinX = BUTTON_LAYOUT.playPause.uMin * w
  const ppMaxX = BUTTON_LAYOUT.playPause.uMax * w
  const ppCenterX = (ppMinX + ppMaxX) / 2
  const ppCenterY = h / 2

  if (state.hasVideo) {
    ctx.fillStyle = 'rgba(77, 166, 255, 0.9)' // --color-accent
    if (state.isPlaying) {
      // Pause icon — two vertical bars
      const barW = 14
      const barH = 60
      ctx.fillRect(ppCenterX - barW - 6, ppCenterY - barH / 2, barW, barH)
      ctx.fillRect(ppCenterX + 6, ppCenterY - barH / 2, barW, barH)
    } else {
      // Play icon — right-pointing triangle
      const size = 36
      ctx.beginPath()
      ctx.moveTo(ppCenterX - size / 2, ppCenterY - size)
      ctx.lineTo(ppCenterX - size / 2, ppCenterY + size)
      ctx.lineTo(ppCenterX + size, ppCenterY)
      ctx.closePath()
      ctx.fill()
    }
  }

  // --- Middle: dataset title ---
  const titleText = state.datasetTitle || 'No dataset loaded'
  ctx.fillStyle = '#e8eaf0' // --color-text
  ctx.font = '500 48px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const titleMaxWidth = w * 0.6
  // Crude ellipsis — if the title doesn't fit at full size, truncate
  // character-by-character until it does. Fine for typical dataset
  // names (< 40 chars); a longer implementation would binary-search.
  let title = titleText
  while (ctx.measureText(title).width > titleMaxWidth && title.length > 4) {
    title = title.slice(0, -2) + '…'
  }
  ctx.fillText(title, w / 2, h / 2)

  // --- Right: exit VR button (×) ---
  const exMinX = BUTTON_LAYOUT.exit.uMin * w
  const exMaxX = BUTTON_LAYOUT.exit.uMax * w
  const exCenterX = (exMinX + exMaxX) / 2
  const exCenterY = h / 2
  ctx.strokeStyle = 'rgba(232, 234, 240, 0.85)'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  const armLength = 24
  ctx.beginPath()
  ctx.moveTo(exCenterX - armLength, exCenterY - armLength)
  ctx.lineTo(exCenterX + armLength, exCenterY + armLength)
  ctx.moveTo(exCenterX + armLength, exCenterY - armLength)
  ctx.lineTo(exCenterX - armLength, exCenterY + armLength)
  ctx.stroke()
}

/**
 * Build the HUD. Caller is responsible for adding `handle.mesh` to
 * the scene, calling `setState()` when dataset or play state changes,
 * and calling `dispose()` on session end.
 */
export function createVrHud(THREE_: typeof THREE): VrHudHandle {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) throw new Error('[VR HUD] 2D canvas context unavailable')

  const texture = new THREE_.CanvasTexture(canvas)
  texture.colorSpace = THREE_.SRGBColorSpace
  texture.minFilter = THREE_.LinearFilter
  texture.magFilter = THREE_.LinearFilter

  const material = new THREE_.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Render on top of the globe even when the HUD is visually
    // beyond the globe's bottom edge — avoids z-fighting fussiness
    // and is the expected UI behaviour anyway.
    depthTest: false,
    depthWrite: false,
  })
  // `renderOrder` > 0 + depthTest:false guarantees the HUD draws
  // after the scene geometry so it's always visible.
  const geometry = new THREE_.PlaneGeometry(HUD_WIDTH, HUD_HEIGHT)
  const mesh = new THREE_.Mesh(geometry, material)
  mesh.position.set(HUD_POSITION.x, HUD_POSITION.y, HUD_POSITION.z)
  mesh.renderOrder = 10

  // Mutable state; the canvas redraw is idempotent, so tracking the
  // current state here means setState() can skip redraws when nothing
  // changed (cheap but a nice win during typical playback).
  let currentState: VrHudState = {
    datasetTitle: null,
    isPlaying: false,
    hasVideo: false,
  }

  function redraw() {
    drawCanvas(ctx2d!, currentState)
    texture.needsUpdate = true
  }

  // Initial paint so the HUD isn't blank for the first frame.
  redraw()

  return {
    mesh,

    setState(state) {
      const changed =
        state.datasetTitle !== currentState.datasetTitle ||
        state.isPlaying !== currentState.isPlaying ||
        state.hasVideo !== currentState.hasVideo
      if (!changed) return
      currentState = state
      redraw()
    },

    hitTest(uv) {
      const { x: u, y: v } = uv
      if (v < 0 || v > 1) return null
      if (
        currentState.hasVideo &&
        u >= BUTTON_LAYOUT.playPause.uMin &&
        u <= BUTTON_LAYOUT.playPause.uMax
      ) {
        return 'play-pause'
      }
      if (u >= BUTTON_LAYOUT.exit.uMin && u <= BUTTON_LAYOUT.exit.uMax) {
        return 'exit-vr'
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
