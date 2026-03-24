/**
 * Input handling for the 3D globe: mouse/touch rotation, zoom, and lat/lng raycasting.
 *
 * Extracted from SphereRenderer to separate interaction concerns from rendering.
 */

import * as THREE from 'three'
import type { ControlsState } from '../types'
import { debounce } from '../utils/debounce'

// --- Input constants ---
const DAMPING = 0.88
const SENSITIVITY = 0.005
const AUTO_ROTATE_SPEED = 0.0015
const INERTIA_THRESHOLD = 0.0001
const ZOOM_MIN = 1.15
const ZOOM_MAX = 3.6
const ZOOM_STEP_FACTOR = 0.12
const SPHERE_SURFACE_RADIUS = 1.0
const PINCH_SENSITIVITY = 0.002
const CAMERA_DEFAULT_Z = 1.8
const RESIZE_DEBOUNCE_MS = 150

export class InputHandler {
  private camera: THREE.PerspectiveCamera
  private webglRenderer: THREE.WebGLRenderer
  private controls: ControlsState = {
    isRotating: false,
    autoRotate: false,
    zoomLevel: 1
  }

  /** Set by the parent after sphere creation. */
  sphere: THREE.Mesh | null = null

  private velocityX = 0
  private velocityY = 0

  private raycaster = new THREE.Raycaster()
  private mouseNDC = new THREE.Vector2()
  private mouseOverSphere = false

  private onLatLng: ((lat: number, lng: number) => void) | null = null
  private onLatLngClear: (() => void) | null = null

  // Touch state
  private lastTouchX = 0
  private lastTouchY = 0
  private lastPinchDistance = 0

  constructor(
    container: HTMLElement,
    camera: THREE.PerspectiveCamera,
    webglRenderer: THREE.WebGLRenderer,
  ) {
    this.camera = camera
    this.webglRenderer = webglRenderer
    this.setupEventListeners(container)
    window.addEventListener('resize', debounce(() => this.onWindowResize(container), RESIZE_DEBOUNCE_MS))
  }

  setLatLngCallbacks(
    onUpdate: (lat: number, lng: number) => void,
    onClear: () => void
  ): void {
    this.onLatLng = onUpdate
    this.onLatLngClear = onClear
  }

  toggleAutoRotate(): boolean {
    this.controls.autoRotate = !this.controls.autoRotate
    return this.controls.autoRotate
  }

  // --- Event setup ---

  private setupEventListeners(container: HTMLElement): void {
    container.addEventListener('mousedown', (e) => this.onMouseDown(e))
    container.addEventListener('mousemove', (e) => this.onMouseMove(e))
    container.addEventListener('mouseup', () => this.onMouseUp())
    container.addEventListener('wheel', (e) => this.onMouseWheel(e), { passive: false })

    container.addEventListener('touchstart', (e) => this.onTouchStart(e))
    container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false })
    container.addEventListener('touchend', () => this.onTouchEnd())

    container.addEventListener('mouseleave', () => {
      this.mouseOverSphere = false
      this.onLatLngClear?.()
    })

    container.addEventListener('dblclick', () => this.resetView())
  }

  // --- Mouse handlers ---

  private onMouseDown(e: MouseEvent): void {
    if (e.target !== this.webglRenderer.domElement) return
    this.controls.isRotating = true
    this.velocityX = 0
    this.velocityY = 0
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.controls.isRotating && this.sphere) {
      this.velocityX = e.movementX * SENSITIVITY
      this.velocityY = e.movementY * SENSITIVITY

      this.sphere.rotation.y += this.velocityX
      this.sphere.rotation.x += this.velocityY
      this.sphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.sphere.rotation.x))
    }

    // Store NDC for continuous raycasting during auto-rotate
    const rect = this.webglRenderer.domElement.getBoundingClientRect()
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.mouseOverSphere = true

    this.updateLatLng()
  }

  private onMouseUp(): void {
    this.controls.isRotating = false
  }

  private onMouseWheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest?.('.ui-panel')) return
    e.preventDefault()

    const currentZ = this.camera.position.z
    const distFromSurface = currentZ - SPHERE_SURFACE_RADIUS
    const step = distFromSurface * ZOOM_STEP_FACTOR * (e.deltaY > 0 ? 1 : -1)
    this.camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZ + step))
  }

  // --- Touch handlers ---

  private isTouchOnUI(e: TouchEvent): boolean {
    const target = e.target as HTMLElement
    return !!target?.closest?.('#ui .ui-panel, #playback-controls')
  }

  private onTouchStart(e: TouchEvent): void {
    if (this.isTouchOnUI(e)) return

    if (e.touches.length === 1) {
      this.controls.isRotating = true
      this.velocityX = 0
      this.velocityY = 0
      this.lastTouchX = e.touches[0].clientX
      this.lastTouchY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
      this.controls.isRotating = false
      this.lastPinchDistance = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      )
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (this.isTouchOnUI(e)) return
    e.preventDefault()

    if (e.touches.length === 1 && this.controls.isRotating && this.sphere) {
      const touch = e.touches[0]
      this.velocityX = (touch.clientX - this.lastTouchX) * SENSITIVITY
      this.velocityY = (touch.clientY - this.lastTouchY) * SENSITIVITY

      this.sphere.rotation.y += this.velocityX
      this.sphere.rotation.x += this.velocityY
      this.sphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.sphere.rotation.x))

      this.lastTouchX = touch.clientX
      this.lastTouchY = touch.clientY

    } else if (e.touches.length === 2) {
      const distance = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      )
      const pinchDelta = (distance - this.lastPinchDistance) * PINCH_SENSITIVITY
      const distFromSurface = this.camera.position.z - SPHERE_SURFACE_RADIUS
      this.camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.camera.position.z - distFromSurface * pinchDelta))
      this.lastPinchDistance = distance
    }
  }

  private onTouchEnd(): void {
    this.controls.isRotating = false
    this.lastPinchDistance = 0
  }

  // --- Resize ---

  private onWindowResize(container: HTMLElement): void {
    const width = container.clientWidth
    const height = container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.webglRenderer.setSize(width, height)
  }

  private resetView(): void {
    if (this.sphere) {
      this.sphere.rotation.set(0, 0, 0)
    }
    this.controls.zoomLevel = 1
    this.camera.position.z = CAMERA_DEFAULT_Z
  }

  // --- Lat/lng raycasting ---

  private updateLatLng(): void {
    if (!this.sphere || !this.onLatLng || !this.mouseOverSphere) return

    this.raycaster.setFromCamera(this.mouseNDC, this.camera)
    const hits = this.raycaster.intersectObject(this.sphere)

    if (hits.length > 0) {
      const localPoint = this.sphere.worldToLocal(hits[0].point.clone())
      const lat = Math.asin(localPoint.y) * (180 / Math.PI)
      const lng = Math.atan2(-localPoint.z, localPoint.x) * (180 / Math.PI)
      this.onLatLng(lat, lng)
    } else {
      this.onLatLngClear?.()
    }
  }

  // --- Animate loop helper ---

  /**
   * Apply auto-rotation, inertia, and lat/lng updates. Called each frame.
   */
  applyFrameUpdate(): void {
    if (!this.sphere) return

    if (this.controls.autoRotate) {
      this.sphere.rotation.y += AUTO_ROTATE_SPEED
    }

    // Inertia when not dragging
    if (!this.controls.isRotating) {
      const speed = Math.abs(this.velocityX) + Math.abs(this.velocityY)
      if (speed > INERTIA_THRESHOLD) {
        this.sphere.rotation.y += this.velocityX
        this.sphere.rotation.x += this.velocityY
        this.sphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.sphere.rotation.x))

        this.velocityX *= DAMPING
        this.velocityY *= DAMPING
      } else {
        this.velocityX = 0
        this.velocityY = 0
      }
    }

    if (this.mouseOverSphere) {
      this.updateLatLng()
    }
  }
}
