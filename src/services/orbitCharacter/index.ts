/**
 * OrbitController — public API for the Orbit character.
 *
 * This is the only surface external callers touch. Internally it owns
 * the Three.js scene, a requestAnimationFrame loop, and (in later
 * phases) the state machine, gesture queue, and flight system.
 *
 * Phase 1 exposes state/palette setters as typed no-ops for the values
 * that aren't yet wired — `setState('IDLE')` is the only useful call.
 * The signatures match the design in the integration plan so callers
 * written today compile unchanged once later phases land.
 */

import * as THREE from 'three'
import {
  buildScene,
  createIdleAnimationState,
  updateIdle,
  type OrbitSceneHandles,
  type IdleAnimationState,
} from './orbitScene'
import type { PaletteKey, ScaleKey, StateKey, GestureKind } from './orbitTypes'

export type { PaletteKey, ScaleKey, StateKey, GestureKind }

export interface OrbitControllerOptions {
  container: HTMLElement
  palette?: PaletteKey
  onStateChange?: (state: StateKey) => void
}

export class OrbitController {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly handles: OrbitSceneHandles
  private readonly idleState: IdleAnimationState
  private readonly clock = new THREE.Clock()
  private readonly onStateChange?: (state: StateKey) => void

  private rafId = 0
  private disposed = false
  private state: StateKey = 'IDLE'
  private palette: PaletteKey
  private scalePreset: ScaleKey = 'close'
  private lastTime = 0

  constructor(options: OrbitControllerOptions) {
    this.container = options.container
    this.palette = options.palette ?? 'cyan'
    this.onStateChange = options.onStateChange

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    // Cap pixel ratio at 2 on desktop, 1.5 on mobile; see §7 "Performance
    // on low-end mobile" in the integration plan.
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2))

    this.handles = buildScene(this.palette)
    this.idleState = createIdleAnimationState()

    this.resize()
    this.container.appendChild(this.renderer.domElement)

    window.addEventListener('resize', this.handleResize)
    this.animate()
  }

  // ---- Public API -------------------------------------------------------

  setState(state: StateKey): void {
    if (state === this.state) return
    this.state = state
    this.onStateChange?.(state)
  }

  getState(): StateKey {
    return this.state
  }

  playGesture(_kind: GestureKind): void {
    // Gestures arrive in Phase 4. The signature is stable so callers
    // written today compile against the final API.
  }

  isGesturePlaying(): boolean {
    return false
  }

  setPalette(palette: PaletteKey): void {
    // Palette swap arrives in Phase 6 (palettes + pupil tint). For now,
    // store the value so `getPalette()` reflects what was asked for and
    // future wiring has somewhere to read from.
    this.palette = palette
  }

  getPalette(): PaletteKey {
    return this.palette
  }

  setScalePreset(preset: ScaleKey): void {
    // Flight + scale presets arrive in Phase 5.
    this.scalePreset = preset
  }

  getScalePreset(): ScaleKey {
    return this.scalePreset
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this.handles.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      }
    })
  }

  // ---- Internals --------------------------------------------------------

  private handleResize = (): void => {
    this.resize()
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.renderer.setSize(clientWidth, clientHeight, false)
    this.handles.camera.aspect = clientWidth / clientHeight
    this.handles.camera.updateProjectionMatrix()
  }

  private animate = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.1) // clamp huge dt on tab resume
    this.lastTime += dt

    // Phase 1 only drives the Idle state. Phase 3 replaces this with
    // a state dispatch that reads STATES[this.state] and computes
    // per-state sub-sphere mode, lid values, pupil brightness, etc.
    updateIdle(this.handles, this.idleState, this.lastTime, dt)

    this.renderer.render(this.handles.scene, this.handles.camera)
  }
}
