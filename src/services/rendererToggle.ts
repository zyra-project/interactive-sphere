/**
 * Renderer backend toggle.
 *
 * The renderer is selected exclusively by URL param:
 *   ?renderer=maplibre  → MapLibre GL JS globe
 *   ?renderer=threejs   → Three.js sphere (explicit)
 *   (no param)          → Three.js sphere (default)
 *
 * No localStorage persistence — the Three.js renderer is always the default
 * unless the URL explicitly opts into MapLibre. This prevents the spike
 * renderer from "sticking" across page loads.
 */

export type RendererBackend = 'threejs' | 'maplibre'

/** Read the active renderer backend from the URL param, defaulting to Three.js. */
export function getRendererBackend(): RendererBackend {
  const params = new URLSearchParams(window.location.search)
  const urlParam = params.get('renderer')
  if (urlParam === 'maplibre' || urlParam === 'threejs') {
    return urlParam
  }
  return 'threejs'
}
