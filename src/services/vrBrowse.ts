/**
 * In-VR dataset browse panel — a floating CanvasTexture panel that
 * renders the dataset catalog so the user can switch datasets
 * without exiting the XR session.
 *
 * The panel mirrors a simplified version of the 2D `browseUI.ts`:
 * scrollable list of dataset cards with title and category, tappable
 * via controller raycast. Category chips and search are added in
 * later commits.
 *
 * Same CanvasTexture + UV hit-test pattern as `vrHud.ts`. The caller
 * (`vrSession.ts`) adds the mesh to the scene, toggles visibility,
 * and calls `dispose()` on session end.
 *
 * See {@link file://./../../docs/VR_INVESTIGATION_PLAN.md VR_INVESTIGATION_PLAN.md}
 * Phase 3 section.
 */

import type * as THREE from 'three'
import type { VrDatasetEntry } from './vrSession'

/** World-space size of the browse panel. */
const PANEL_WIDTH = 0.8
const PANEL_HEIGHT = 0.6

/** Canvas resolution. 4:3 ratio matches the 0.8 × 0.6 m panel. */
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

/** Visual constants. */
const BG_COLOR = 'rgba(13, 13, 18, 0.92)'
const BORDER_COLOR = 'rgba(255, 255, 255, 0.12)'
const TITLE_COLOR = '#e8eaf0'
const SUBTITLE_COLOR = 'rgba(232, 234, 240, 0.5)'
const ACCENT_COLOR = 'rgba(77, 166, 255, 0.9)'
const CARD_BG = 'rgba(255, 255, 255, 0.06)'
const CARD_BG_HOVER = 'rgba(77, 166, 255, 0.15)'

const TITLE_BAR_HEIGHT = 60
const CARD_HEIGHT = 56
const CARD_GAP = 4
const CARD_PADDING_X = 16
const LIST_PADDING = 12
const SCROLLBAR_WIDTH = 8

export interface VrBrowseHandle {
  readonly mesh: THREE.Mesh
  setVisible(visible: boolean): void
  isVisible(): boolean
  /** Provide the dataset catalog. Triggers a redraw. */
  setDatasets(datasets: VrDatasetEntry[]): void
  /** Scroll the list by a delta (positive = down). Called per-frame from vrInteraction. */
  scroll(delta: number): void
  hitTest(uv: { x: number; y: number }): VrBrowseAction | null
  dispose(): void
}

export type VrBrowseAction =
  | { kind: 'close' }
  | { kind: 'select'; datasetId: string }

/** Content area = everything below the title bar. */
const LIST_TOP = TITLE_BAR_HEIGHT + LIST_PADDING
const LIST_BOTTOM = CANVAS_HEIGHT - LIST_PADDING
const LIST_HEIGHT = LIST_BOTTOM - LIST_TOP

const CLOSE_BUTTON = {
  uMin: (CANVAS_WIDTH - 50) / CANVAS_WIDTH,
  uMax: 1.0,
  vMin: 1 - TITLE_BAR_HEIGHT / CANVAS_HEIGHT,
  vMax: 1.0,
}

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  datasets: VrDatasetEntry[],
  scrollY: number,
  highlightIndex: number,
): void {
  const w = CANVAS_WIDTH
  const h = CANVAS_HEIGHT

  ctx.clearRect(0, 0, w, h)

  // Background + border
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = BORDER_COLOR
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  // Title bar
  ctx.fillStyle = 'rgba(77, 166, 255, 0.12)'
  ctx.fillRect(0, 0, w, TITLE_BAR_HEIGHT)
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
  ctx.fillText(`Browse Datasets (${datasets.length})`, 20, TITLE_BAR_HEIGHT / 2)

  // Close button
  ctx.fillStyle = ACCENT_COLOR
  ctx.font = '500 32px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('✕', w - 30, TITLE_BAR_HEIGHT / 2)

  if (datasets.length === 0) {
    ctx.fillStyle = SUBTITLE_COLOR
    ctx.font = '400 22px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No datasets available', w / 2, (h + TITLE_BAR_HEIGHT) / 2)
    return
  }

  // Clip to list area
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, LIST_TOP, w, LIST_HEIGHT)
  ctx.clip()

  const cardStride = CARD_HEIGHT + CARD_GAP
  const listContentWidth = w - LIST_PADDING * 2 - SCROLLBAR_WIDTH

  for (let i = 0; i < datasets.length; i++) {
    const cardY = LIST_TOP + i * cardStride - scrollY
    if (cardY + CARD_HEIGHT < LIST_TOP || cardY > LIST_BOTTOM) continue

    const ds = datasets[i]
    const x = LIST_PADDING
    const cardW = listContentWidth

    // Card background
    ctx.fillStyle = i === highlightIndex ? CARD_BG_HOVER : CARD_BG
    ctx.beginPath()
    ctx.roundRect(x, cardY, cardW, CARD_HEIGHT, 6)
    ctx.fill()

    // Title
    ctx.fillStyle = TITLE_COLOR
    ctx.font = '500 20px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    let title = ds.title
    const maxTitleWidth = cardW - CARD_PADDING_X * 2
    while (ctx.measureText(title).width > maxTitleWidth && title.length > 4) {
      title = title.slice(0, -2) + '…'
    }
    ctx.fillText(title, x + CARD_PADDING_X, cardY + 10)

    // Category chip
    if (ds.category) {
      ctx.fillStyle = ACCENT_COLOR
      ctx.font = '400 14px system-ui, -apple-system, sans-serif'
      ctx.fillText(ds.category, x + CARD_PADDING_X, cardY + 35)
    }
  }

  ctx.restore()

  // Scrollbar
  const totalContent = datasets.length * cardStride
  if (totalContent > LIST_HEIGHT) {
    const scrollbarHeight = Math.max(20, (LIST_HEIGHT / totalContent) * LIST_HEIGHT)
    const scrollbarY = LIST_TOP + (scrollY / (totalContent - LIST_HEIGHT)) * (LIST_HEIGHT - scrollbarHeight)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.beginPath()
    ctx.roundRect(w - LIST_PADDING - SCROLLBAR_WIDTH, scrollbarY, SCROLLBAR_WIDTH, scrollbarHeight, 4)
    ctx.fill()
  }
}

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

  let visible = false
  let datasets: VrDatasetEntry[] = []
  let scrollY = 0
  let highlightIndex = -1

  function clampScroll(): void {
    const totalContent = datasets.length * (CARD_HEIGHT + CARD_GAP)
    const maxScroll = Math.max(0, totalContent - LIST_HEIGHT)
    scrollY = Math.max(0, Math.min(maxScroll, scrollY))
  }

  function redraw(): void {
    drawCanvas(ctx2d!, datasets, scrollY, highlightIndex)
    texture.needsUpdate = true
  }

  redraw()

  /** Convert UV hit to the card index at that position. */
  function cardIndexAtUv(u: number, v: number): number {
    const canvasX = u * CANVAS_WIDTH
    const canvasY = (1 - v) * CANVAS_HEIGHT
    if (canvasY < LIST_TOP || canvasY > LIST_BOTTOM) return -1
    if (canvasX < LIST_PADDING || canvasX > CANVAS_WIDTH - LIST_PADDING - SCROLLBAR_WIDTH) return -1
    const cardStride = CARD_HEIGHT + CARD_GAP
    const idx = Math.floor((canvasY - LIST_TOP + scrollY) / cardStride)
    if (idx < 0 || idx >= datasets.length) return -1
    const withinCard = (canvasY - LIST_TOP + scrollY) % cardStride
    if (withinCard > CARD_HEIGHT) return -1
    return idx
  }

  return {
    mesh,

    setVisible(v) {
      visible = v
      mesh.visible = v
      if (v) redraw()
    },

    isVisible() {
      return visible
    },

    setDatasets(ds) {
      datasets = ds
      scrollY = 0
      highlightIndex = -1
      if (visible) redraw()
    },

    scroll(delta) {
      if (!visible || datasets.length === 0) return
      scrollY += delta
      clampScroll()
      redraw()
    },

    hitTest(uv) {
      if (!visible) return null
      const { x: u, y: v } = uv

      // Close button
      if (
        u >= CLOSE_BUTTON.uMin && u <= CLOSE_BUTTON.uMax &&
        v >= CLOSE_BUTTON.vMin && v <= CLOSE_BUTTON.vMax
      ) {
        return { kind: 'close' }
      }

      // Dataset card
      const idx = cardIndexAtUv(u, v)
      if (idx >= 0) {
        return { kind: 'select', datasetId: datasets[idx].id }
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
