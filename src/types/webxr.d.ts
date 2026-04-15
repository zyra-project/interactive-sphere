/**
 * Minimal WebXR type shim.
 *
 * TypeScript 5.3's built-in DOM lib does not declare the WebXR Device
 * API types, and we'd rather not pull in `@types/webxr` for a feature
 * that is still an investigation. This file declares only the surface
 * area actually used by `src/services/vrSession.ts` and
 * `src/services/vrGlobe.ts`.
 *
 * If the VR feature graduates out of investigation we should replace
 * this with `@types/webxr` or the official DOM lib (expected in a
 * future TypeScript release).
 */

type XRSessionMode = 'inline' | 'immersive-vr' | 'immersive-ar'
type XRReferenceSpaceType =
  | 'viewer'
  | 'local'
  | 'local-floor'
  | 'bounded-floor'
  | 'unbounded'
type XREye = 'none' | 'left' | 'right'
type XRVisibilityState = 'visible' | 'visible-blurred' | 'hidden'

interface XRSystem {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>
  requestSession(mode: XRSessionMode, init?: XRSessionInit): Promise<XRSession>
}

interface XRSessionInit {
  requiredFeatures?: XRReferenceSpaceType[]
  optionalFeatures?: XRReferenceSpaceType[]
}

interface XRSession extends EventTarget {
  readonly visibilityState: XRVisibilityState
  readonly renderState: XRRenderState
  updateRenderState(state: XRRenderStateInit): void
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<XRReferenceSpace>
  requestAnimationFrame(callback: XRFrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  end(): Promise<void>
  addEventListener(
    type: 'end' | 'visibilitychange' | 'inputsourceschange',
    listener: (ev: Event) => unknown,
  ): void
  removeEventListener(
    type: 'end' | 'visibilitychange' | 'inputsourceschange',
    listener: (ev: Event) => unknown,
  ): void
}

interface XRRenderState {
  readonly baseLayer: XRWebGLLayer | null
}

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer
  depthFar?: number
  depthNear?: number
}

type XRFrameRequestCallback = (time: DOMHighResTimeStamp, frame: XRFrame) => void

interface XRFrame {
  readonly session: XRSession
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | undefined
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface XRReferenceSpace extends EventTarget {}

interface XRViewerPose {
  readonly transform: XRRigidTransform
  readonly views: ReadonlyArray<XRView>
}

interface XRView {
  readonly eye: XREye
  readonly projectionMatrix: Float32Array
  readonly transform: XRRigidTransform
}

interface XRRigidTransform {
  readonly matrix: Float32Array
  readonly inverse: XRRigidTransform
  readonly position: DOMPointReadOnly
  readonly orientation: DOMPointReadOnly
}

interface XRViewport {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface XRWebGLLayerInit {
  antialias?: boolean
  depth?: boolean
  stencil?: boolean
  alpha?: boolean
  framebufferScaleFactor?: number
}

declare const XRWebGLLayer: {
  prototype: XRWebGLLayer
  new(
    session: XRSession,
    context: WebGLRenderingContext | WebGL2RenderingContext,
    layerInit?: XRWebGLLayerInit,
  ): XRWebGLLayer
}

interface XRWebGLLayer {
  readonly framebuffer: WebGLFramebuffer | null
  readonly framebufferWidth: number
  readonly framebufferHeight: number
  getViewport(view: XRView): XRViewport | null
}

interface Navigator {
  readonly xr?: XRSystem
}

interface WebGLRenderingContextBase {
  makeXRCompatible?(): Promise<void>
}
