/**
 * MapLibre GL JS globe renderer — Phase 0 spike.
 *
 * Wraps MapLibre with globe projection, NASA GIBS Blue Marble + Black Marble
 * raster tile sources, and a minimal dark style. Intended to coexist with the
 * existing Three.js SphereRenderer behind a renderer toggle.
 */

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Map as MaplibreMap, StyleSpecification, CustomLayerInterface } from 'maplibre-gl'
import * as THREE from 'three'
import { createDayNightTestLayer, syncAtmosphereLight } from './customLayerSpike'
import { getSunPosition } from '../utils/time'

// --- GIBS tile endpoints ---
const BLUE_MARBLE_TILES = [
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
]
const BLACK_MARBLE_TILES = [
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlackMarble_2016/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'
]
const GIBS_MAX_ZOOM = 8

// --- Default camera ---
const DEFAULT_CENTER: [number, number] = [0, 20]
const DEFAULT_ZOOM = 1.0

/**
 * Minimal dark globe style with NASA GIBS Blue Marble and Black Marble tiles.
 * Black Marble is hidden by default — it will be used by the day/night blend
 * custom layer in Phase 1.
 */
function createGlobeStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'sos-globe',
    projection: { type: 'globe' },
    sources: {
      'blue-marble': {
        type: 'raster',
        tiles: BLUE_MARBLE_TILES,
        tileSize: 256,
        maxzoom: GIBS_MAX_ZOOM,
        attribution: 'NASA Blue Marble',
      },
      'black-marble': {
        type: 'raster',
        tiles: BLACK_MARBLE_TILES,
        tileSize: 256,
        maxzoom: GIBS_MAX_ZOOM,
        attribution: 'NASA Black Marble',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#000000' },
      },
      {
        id: 'blue-marble-layer',
        type: 'raster',
        source: 'blue-marble',
        paint: { 'raster-opacity': 1 },
      },
      {
        id: 'black-marble-layer',
        type: 'raster',
        source: 'black-marble',
        paint: { 'raster-opacity': 0 },
        layout: { visibility: 'none' },
      },
    ],
    sky: {
      'atmosphere-blend': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0, 1,
        5, 1,
        7, 0,
      ],
    },
    // Light is updated dynamically via enableSunLighting() to match the sun
    // position. Start with a neutral overhead light as a safe default.
    light: {
      anchor: 'map',
      position: [1.5, 0, 90],
    },
  }
}

/**
 * MapLibre-based globe renderer.
 *
 * Spike A validates: globe projection, GIBS tile loading, basic interaction,
 * and coexistence with the existing Three.js renderer.
 */
export class MapRenderer {
  private map: MaplibreMap | null = null
  private container: HTMLElement | null = null
  private autoRotateInterval: number | null = null
  private autoRotating = false

  /**
   * Initialize the MapLibre map inside the given container element.
   * The container must already be in the DOM with non-zero dimensions.
   */
  init(container: HTMLElement): void {
    this.container = container

    // MapLibre needs a wrapper div — the Three.js renderer appends a canvas
    // directly, but MapLibre manages its own canvas internally.
    const mapDiv = document.createElement('div')
    mapDiv.id = 'maplibre-container'
    mapDiv.style.width = '100%'
    mapDiv.style.height = '100%'
    container.appendChild(mapDiv)

    this.map = new maplibregl.Map({
      container: mapDiv,
      style: createGlobeStyle(),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      preserveDrawingBuffer: true, // needed for captureViewContext / toDataURL
      maxPitch: 85,
    } as maplibregl.MapOptions)

    // Accessibility
    const canvas = this.map.getCanvas()
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', 'Interactive 3D globe visualization')
    canvas.id = 'globe-canvas'

    // Log when tiles finish loading, and activate Spike C test layer
    this.map.on('load', () => {
      console.info('[MapRenderer] Map loaded with globe projection')
      console.info('[MapRenderer] Center:', this.map!.getCenter())
      console.info('[MapRenderer] Zoom:', this.map!.getZoom())

      // Spike C: add day/night test custom layer to validate Three.js
      // rendering inside MapLibre's WebGL context on globe projection.
      // Activated via ?spike=daynight URL param for manual testing.
      const params = new URLSearchParams(window.location.search)
      if (params.get('spike') === 'daynight') {
        const testLayer = createDayNightTestLayer()
        this.map!.addLayer(testLayer as unknown as maplibregl.LayerSpecification)
        console.info('[MapRenderer] Spike C day/night test layer activated')

        // Debug panel for tuning MapLibre light position
        this.createLightDebugPanel()
      }
    })
  }

  /** Return the underlying MapLibre map instance. */
  getMap(): MaplibreMap | null {
    return this.map
  }

  /** Return the map canvas element for screenshot capture. */
  getCanvas(): HTMLCanvasElement | null {
    return this.map?.getCanvas() ?? null
  }

  // --- Navigation ---

  /** Fly the camera to a geographic location. */
  flyTo(lat: number, lon: number, zoom?: number): void {
    this.map?.flyTo({
      center: [lon, lat],
      zoom: zoom ?? this.map.getZoom(),
      duration: 2500,
    })
  }

  /** Toggle auto-rotation and return the new state. */
  toggleAutoRotate(): boolean {
    this.autoRotating = !this.autoRotating
    if (this.autoRotating) {
      this.startAutoRotate()
    } else {
      this.stopAutoRotate()
    }
    return this.autoRotating
  }

  private startAutoRotate(): void {
    this.stopAutoRotate()
    // Use easeTo with a long duration to smoothly rotate the bearing.
    // Re-trigger every 10 seconds to keep it going.
    const rotate = () => {
      if (!this.map || !this.autoRotating) return
      const currentBearing = this.map.getBearing()
      this.map.easeTo({
        bearing: currentBearing - 30,
        duration: 10000,
        easing: (t: number) => t, // linear
      })
    }
    rotate()
    this.autoRotateInterval = window.setInterval(rotate, 10000)

    // Stop auto-rotate on user interaction
    const stopOnInteraction = () => {
      if (this.autoRotating) {
        this.autoRotating = false
        this.stopAutoRotate()
      }
      this.map?.off('mousedown', stopOnInteraction)
      this.map?.off('touchstart', stopOnInteraction)
    }
    this.map?.on('mousedown', stopOnInteraction)
    this.map?.on('touchstart', stopOnInteraction)
  }

  private stopAutoRotate(): void {
    if (this.autoRotateInterval !== null) {
      clearInterval(this.autoRotateInterval)
      this.autoRotateInterval = null
    }
    this.map?.stop() // cancel any in-flight easeTo
  }

  // --- Lat/lng tracking ---

  /** Register callbacks for cursor lat/lng display. */
  setLatLngCallbacks(
    onUpdate: (lat: number, lng: number) => void,
    onClear: () => void
  ): void {
    this.map?.on('mousemove', (e) => {
      onUpdate(e.lngLat.lat, e.lngLat.lng)
    })
    this.map?.on('mouseout', () => {
      onClear()
    })
  }

  // --- Custom layers (for Phase 1+) ---

  /** Add a custom layer (e.g. day/night blend, clouds). */
  addCustomLayer(layer: CustomLayerInterface, beforeId?: string): void {
    this.map?.addLayer(layer as unknown as maplibregl.LayerSpecification, beforeId)
  }

  // --- Canvas description ---

  /** Update the canvas ARIA label. */
  setCanvasDescription(text: string): void {
    this.map?.getCanvas().setAttribute('aria-label', text)
  }

  // --- Dataset overlays (Spike B) ---

  /**
   * Display an equirectangular image on the globe via MapLibre ImageSource.
   *
   * Tests two bound variants:
   *  - Standard Mercator bounds (+/-85°) — safe but may leave polar gaps
   *  - Full geographic bounds (+/-90°) — ideal if globe projection supports it
   *
   * Falls back to +/-85 if +/-90 throws.
   */
  updateTexture(texture: HTMLCanvasElement | HTMLImageElement): void {
    if (!this.map) return

    // Convert to a data URL if it's a canvas/image element
    let imageUrl: string
    if (texture instanceof HTMLCanvasElement) {
      imageUrl = texture.toDataURL('image/png')
    } else {
      // HTMLImageElement — use its src directly
      imageUrl = texture.src
    }

    // Remove previous dataset overlay if any
    this.removeDatasetOverlay()

    // Try full-globe bounds first (±90°), fall back to Mercator-safe (±85°)
    const fullBounds: [[number, number], [number, number], [number, number], [number, number]] =
      [[-180, 90], [180, 90], [180, -90], [-180, -90]]
    const safeBounds: [[number, number], [number, number], [number, number], [number, number]] =
      [[-180, 85], [180, 85], [180, -85], [-180, -85]]

    let bounds = fullBounds
    try {
      this.map.addSource('dataset-overlay', {
        type: 'image',
        url: imageUrl,
        coordinates: bounds,
      })
    } catch (e) {
      console.warn('[MapRenderer] ±90° bounds failed, falling back to ±85°:', e)
      bounds = safeBounds
      try { this.map.removeSource('dataset-overlay') } catch { /* noop */ }
      this.map.addSource('dataset-overlay', {
        type: 'image',
        url: imageUrl,
        coordinates: bounds,
      })
    }

    this.map.addLayer({
      id: 'dataset-overlay-layer',
      type: 'raster',
      source: 'dataset-overlay',
      paint: { 'raster-opacity': 1 },
    })

    // Hide the Blue Marble base layer when a dataset is active
    this.map.setLayoutProperty('blue-marble-layer', 'visibility', 'none')

    console.info('[MapRenderer] Image overlay added with bounds:', bounds)
  }

  /**
   * Display a video on the globe via MapLibre VideoSource.
   * Returns a THREE.VideoTexture for playback controller compatibility.
   */
  setVideoTexture(video: HTMLVideoElement): THREE.VideoTexture {
    if (!this.map) {
      return new THREE.VideoTexture(video)
    }

    // Remove previous overlay
    this.removeDatasetOverlay()

    const bounds: [[number, number], [number, number], [number, number], [number, number]] =
      [[-180, 85], [180, 85], [180, -85], [-180, -85]]

    this.map.addSource('dataset-overlay', {
      type: 'video',
      urls: [video.src || video.currentSrc],
      coordinates: bounds,
    })

    this.map.addLayer({
      id: 'dataset-overlay-layer',
      type: 'raster',
      source: 'dataset-overlay',
      paint: { 'raster-opacity': 1 },
    })

    this.map.setLayoutProperty('blue-marble-layer', 'visibility', 'none')

    console.info('[MapRenderer] Video overlay added')

    // Return a VideoTexture for playback controller compatibility
    return new THREE.VideoTexture(video)
  }

  /** Remove the current dataset overlay source and layer. */
  private removeDatasetOverlay(): void {
    if (!this.map) return
    try {
      if (this.map.getLayer('dataset-overlay-layer')) {
        this.map.removeLayer('dataset-overlay-layer')
      }
      if (this.map.getSource('dataset-overlay')) {
        this.map.removeSource('dataset-overlay')
      }
    } catch { /* source/layer may not exist */ }

    // Restore Blue Marble base
    try {
      this.map.setLayoutProperty('blue-marble-layer', 'visibility', 'visible')
    } catch { /* noop */ }
  }

  // --- Earth material stubs (Phase 1) ---

  /** Stub: load default earth materials. */
  async loadDefaultEarthMaterials(_onProgress?: (fraction: number) => void): Promise<void> {
    // Phase 1: GIBS tiles are already loaded as the base style.
    // Day/night blend will be a custom layer.
    _onProgress?.(1)
  }

  /** Stub: remove night lights. */
  removeNightLights(): void {
    // Phase 1: toggle day/night custom layer
  }

  /**
   * Enable sun lighting. When the day/night custom layer (spike C) is active,
   * it handles syncing MapLibre's light from within its render callback
   * for zero-lag lockstep. This stub is kept for the GlobeRenderer interface.
   */
  enableSunLighting(_lat: number, _lng: number): void {
    // Light sync is handled by the custom layer's render() callback
    // when spike=daynight is active. See customLayerSpike.ts syncAtmosphereLight().
  }

  /** Create a debug panel with sliders for tuning MapLibre light position. */
  private createLightDebugPanel(): void {
    const panel = document.createElement('div')
    panel.id = 'light-debug-panel'
    panel.style.cssText = `
      position: fixed; top: 10px; right: 10px; z-index: 9999;
      background: rgba(0,0,0,0.85); color: #fff; padding: 12px 16px;
      border-radius: 8px; font: 12px/1.6 monospace; min-width: 280px;
    `
    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 0)
    const currentDoy = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24))
    const currentHour = now.getUTCHours() + now.getUTCMinutes() / 60

    panel.innerHTML = `
      <div style="margin-bottom:8px;font-weight:bold;color:#4da6ff;">Time Override</div>
      <label>Day of year: <span id="dbg-doy-val">${currentDoy}</span> <span id="dbg-date-label"></span></label><br>
      <input id="dbg-doy" type="range" min="1" max="365" value="${currentDoy}" style="width:100%"><br>
      <label>Hour (UTC): <span id="dbg-hour-val">${currentHour.toFixed(1)}</span></label><br>
      <input id="dbg-hour" type="range" min="0" max="240" value="${Math.round(currentHour * 10)}" style="width:100%"><br>
      <div id="dbg-sun-info" style="margin-top:8px;color:#aaa;font-size:11px;white-space:pre-line;"></div>
      <button id="dbg-reset" style="margin-top:6px;padding:2px 8px;font-size:11px;cursor:pointer;">Reset to now</button>
    `
    document.body.appendChild(panel)

    const doySlider = document.getElementById('dbg-doy') as HTMLInputElement
    const hourSlider = document.getElementById('dbg-hour') as HTMLInputElement
    const doyVal = document.getElementById('dbg-doy-val')!
    const dateLabel = document.getElementById('dbg-date-label')!
    const hourVal = document.getElementById('dbg-hour-val')!
    const sunInfo = document.getElementById('dbg-sun-info')!
    const resetBtn = document.getElementById('dbg-reset')!

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    const update = () => {
      const doy = parseInt(doySlider.value)
      const hour = parseInt(hourSlider.value) / 10

      doyVal.textContent = String(doy)
      hourVal.textContent = hour.toFixed(1)

      // Build a simulated date from day-of-year + hour
      const simDate = new Date(now.getFullYear(), 0, doy,
        Math.floor(hour), Math.round((hour % 1) * 60))
      dateLabel.textContent = `(${monthNames[simDate.getMonth()]} ${simDate.getDate()})`

      // Expose simulated date globally so the custom layer uses it too
      ;(window as any).__debugSunDate = simDate

      const sun = getSunPosition(simDate)
      sunInfo.textContent = `Sun: lat=${sun.lat.toFixed(1)}° lng=${sun.lng.toFixed(1)}°`

      // Sync MapLibre's atmosphere light with the simulated sun
      if (this.map) syncAtmosphereLight(this.map, sun.lat, sun.lng)

      // Trigger repaint so the custom layer picks up the new date
      this.map?.triggerRepaint()
    }

    resetBtn.addEventListener('click', () => {
      delete (window as any).__debugSunDate
      const resetNow = new Date()
      const resetStart = new Date(resetNow.getFullYear(), 0, 0)
      const resetDoy = Math.floor((resetNow.getTime() - resetStart.getTime()) / (1000 * 60 * 60 * 24))
      const resetHour = resetNow.getUTCHours() + resetNow.getUTCMinutes() / 60
      doySlider.value = String(resetDoy)
      hourSlider.value = String(Math.round(resetHour * 10))
      doyVal.textContent = String(resetDoy)
      hourVal.textContent = resetHour.toFixed(1)
      sunInfo.textContent = 'Using real time'
      // Re-sync atmosphere light to current time
      const resetSun = getSunPosition(resetNow)
      if (this.map) syncAtmosphereLight(this.map, resetSun.lat, resetSun.lng)
      this.map?.triggerRepaint()
    })

    doySlider.addEventListener('input', update)
    hourSlider.addEventListener('input', update)

    // Show initial label without setting __debugSunDate (use real time on load)
    const initSun = getSunPosition(now)
    dateLabel.textContent = `(${monthNames[now.getMonth()]} ${now.getDate()})`
    sunInfo.textContent = `Sun: lat=${initSun.lat.toFixed(1)}° lng=${initSun.lng.toFixed(1)}°`
  }

  /** Reset light to neutral overhead position. */
  disableSunLighting(): void {
    if (!this.map) return
    this.map.setLight({
      anchor: 'map',
      position: [1.5, 0, 90],
    })
  }

  /** Stub: load cloud overlay. */
  async loadCloudOverlay(_url: string, _onProgress?: (fraction: number) => void): Promise<void> {
    // Phase 1: cloud mesh as custom layer
    _onProgress?.(1)
  }

  /** Stub: remove cloud overlay. */
  removeCloudOverlay(): void {
    // Phase 1
  }

  // --- Disposal ---

  /** Remove the map and clean up resources. */
  dispose(): void {
    this.stopAutoRotate()
    if (this.map) {
      this.map.remove()
      this.map = null
    }
    // Remove the wrapper div
    const mapDiv = this.container?.querySelector('#maplibre-container')
    if (mapDiv) mapDiv.remove()
    this.container = null
  }
}
