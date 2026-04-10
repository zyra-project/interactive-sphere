/**
 * Screenshot Service — captures the globe canvas as a compressed JPEG data URL.
 *
 * Used by the Orbit vision flow (sending the current view to a vision-capable
 * LLM) and by the help/feedback flow (optional attachment to bug reports).
 *
 * The preferred path delegates to the active MapRenderer, which forces a
 * fresh repaint and waits for MapLibre to finish rendering before reading
 * pixels — necessary because `preserveDrawingBuffer: true` alone is not
 * enough to keep the WebGL drawing buffer populated between idle frames
 * on some browsers. The DOM fallback exists for tests and degenerate
 * cases where the renderer isn't reachable.
 */

import { getActiveMapRenderer } from './mapRenderer'
import { logger } from '../utils/logger'

/** Max dimension for a captured screenshot — keeps payload small. */
export const SCREENSHOT_MAX_SIZE = 512

/**
 * Fallback capture that reads straight from a DOM canvas with the id
 * `globe-canvas`. Used only when no MapRenderer is registered — the
 * result may be blank on a MapLibre canvas because the drawing buffer
 * can be cleared between frames.
 */
function captureFromDom(): string | null {
  const canvas = document.getElementById('globe-canvas') as HTMLCanvasElement | null
  if (!canvas) return null
  try {
    const { width, height } = canvas
    const scale = Math.min(1, SCREENSHOT_MAX_SIZE / Math.max(width, height))
    if (scale < 1) {
      const offscreen = document.createElement('canvas')
      offscreen.width = Math.round(width * scale)
      offscreen.height = Math.round(height * scale)
      const ctx = offscreen.getContext('2d')
      if (!ctx) return canvas.toDataURL('image/jpeg', 0.6)
      ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height)
      return offscreen.toDataURL('image/jpeg', 0.6)
    }
    return canvas.toDataURL('image/jpeg', 0.6)
  } catch {
    logger.warn('[screenshotService] Failed to capture globe screenshot (DOM fallback)')
    return null
  }
}

/**
 * Capture the globe canvas as a compressed JPEG data URL, downsized to
 * at most SCREENSHOT_MAX_SIZE px on the longest edge so the payload stays
 * small and downstream consumers (vision models, feedback storage) can
 * process it quickly.
 *
 * Returns null if the canvas is not available or the capture fails.
 */
export async function captureGlobeScreenshot(): Promise<string | null> {
  const renderer = getActiveMapRenderer()
  if (renderer) {
    const result = await renderer.captureScreenshot()
    if (result) return result
    // Renderer exists but capture failed — fall through to DOM fallback
  }
  return captureFromDom()
}
