/**
 * Sub-sphere trails — sparkling "comet" streams + persistent orbit
 * rings.
 *
 * Two separate visuals share one sparkle shader:
 *
 *   • {@link buildTrails} / {@link updateTrails}: a rolling 42-point
 *     comet tail behind each sub, for expressive sub-modes (point /
 *     trace / burst). Design doc hazard: `THREE.Line` / `Line2`
 *     render at 1 pixel width on mobile GPUs, so `THREE.Points` with
 *     a custom point-sprite shader is the portable fallback.
 *
 *   • {@link buildOrbitRings} / {@link updateOrbitRings}: persistent
 *     closed-ring sparkle geometries tracing each sub's precomputed
 *     elliptical orbit path. Visible even when the sub breaks off
 *     its orbit (the ring reads as "Orbit HAS orbital satellites,"
 *     not "this is where the sub is right now"). Intensity is
 *     state-driven via `ExpressionConfig.ringIntensity`.
 *
 * Color is decision-table driven: idle / low-excitement states fall
 * back to a warm off-white; expressive states use the active
 * palette's accent. New states land in the idle bucket by default.
 */

import * as THREE from 'three'
import { PALETTES, type PaletteKey } from './orbitTypes'
import { STATES, expressionFor } from './orbitStates'
import type { StateKey } from './orbitTypes'

export const TRAIL_LENGTH = 42

/** Warm off-white used for idle / low-excitement trails. */
const IDLE_TRAIL_COLOR = '#fff0d8'

/**
 * States where the trail should use the palette's ACCENT color
 * (expressive register). Everything else falls into the idle bucket
 * and uses the warm off-white. Adding a new state without listing
 * it here defaults to idle — one less thing to remember.
 */
const EXPRESSIVE_TRAIL_STATES = new Set<StateKey>([
  'TALKING', 'POINTING', 'PRESENTING',
  'EXCITED', 'HAPPY', 'CURIOUS', 'SURPRISED', 'CONFUSED',
])

export function trailColorFor(state: StateKey, palette: PaletteKey): string {
  return EXPRESSIVE_TRAIL_STATES.has(state)
    ? PALETTES[palette].accent
    : IDLE_TRAIL_COLOR
}

export interface TrailHandle {
  points: THREE.Points
  geom: THREE.BufferGeometry
  mat: THREE.ShaderMaterial
  positions: Float32Array
  currentIntensity: number
}

export function buildTrails(
  scene: THREE.Scene,
  subSpheres: THREE.Mesh[],
  palette: PaletteKey,
  pixelRatio: number,
): TrailHandle[] {
  return subSpheres.map((sub) => {
    const positions = new Float32Array(TRAIL_LENGTH * 3)
    const sizes = new Float32Array(TRAIL_LENGTH)
    const alphas = new Float32Array(TRAIL_LENGTH)
    const seeds = new Float32Array(TRAIL_LENGTH)
    for (let j = 0; j < TRAIL_LENGTH; j++) {
      positions[j * 3] = sub.position.x
      positions[j * 3 + 1] = sub.position.y
      positions[j * 3 + 2] = sub.position.z
      const t = 1 - j / TRAIL_LENGTH
      alphas[j] = t
      // Slight per-vertex size jitter reinforces the "sparkle" read —
      // uniform-size points look like a dashed line instead.
      sizes[j] = 3 + t * 18 * (0.75 + Math.random() * 0.5)
      seeds[j] = Math.random()
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geom.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    geom.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(IDLE_TRAIL_COLOR) },
        uIntensity: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float size; attribute float alpha; attribute float seed;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          vAlpha = alpha;
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (0.35 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
        varying float vAlpha; varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float fade = 1.0 - smoothstep(0.0, 0.5, d);
          // Sharper exponent reads as a spark core rather than a
          // soft smear.
          fade = pow(fade, 2.2);
          // Per-vertex twinkle — each particle pulses on its own
          // phase, so the trail doesn't strobe in unison.
          float twinkle = 0.6 + 0.4 * sin(uTime * 6.0 + vSeed * 6.2831);
          float a = vAlpha * uIntensity * fade * twinkle;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
    const points = new THREE.Points(geom, mat)
    scene.add(points)
    return { points, geom, mat, positions, currentIntensity: 0 }
  })
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Per-frame trail update.
 *
 * Reads the active STATE's `trail` amount, eases each trail's
 * intensity toward it, and rolls each trail's positions forward by
 * one step (shift buffer, write current sub-sphere position at index 0).
 *
 * Sub 0 owns the directional trail during point/trace (sub 1's trail
 * is suppressed so the lead sub's motion reads cleanly). `flightBoost`
 * lifts trail intensity during Orbit's fly-to-Earth arc so the journey
 * leaves a visible streak.
 */
export function updateTrails(
  trails: TrailHandle[],
  subSpheres: THREE.Mesh[],
  state: StateKey,
  palette: PaletteKey,
  time: number,
  flightBoost = 0,
): void {
  const s = STATES[state]
  const trailColor = trailColorFor(state, palette)
  trails.forEach((trail, i) => {
    trail.mat.uniforms.uColor.value.set(trailColor)
    trail.mat.uniforms.uTime.value = time
    let targetIntensity = Math.max(flightBoost, s.trail)
    if ((s.subMode === 'point' || s.subMode === 'trace') && i !== 0) {
      targetIntensity = 0
    }
    trail.currentIntensity = lerp(trail.currentIntensity, targetIntensity, 0.10)
    trail.mat.uniforms.uIntensity.value = trail.currentIntensity

    const sub = subSpheres[i]
    const pos = trail.positions
    for (let j = TRAIL_LENGTH - 1; j > 0; j--) {
      pos[j * 3] = pos[(j - 1) * 3]
      pos[j * 3 + 1] = pos[(j - 1) * 3 + 1]
      pos[j * 3 + 2] = pos[(j - 1) * 3 + 2]
    }
    pos[0] = sub.position.x
    pos[1] = sub.position.y
    pos[2] = sub.position.z
    trail.geom.attributes.position.needsUpdate = true
  })
}

export function setTrailPixelRatio(trails: TrailHandle[], pixelRatio: number): void {
  for (const t of trails) t.mat.uniforms.uPixelRatio.value = pixelRatio
}

// -----------------------------------------------------------------------
// Orbit rings — persistent closed sparkle ellipses tracing each sub's
// idle-orbit path. Rendered as points with the same sparkle shader
// as the comet trails, but one ring per sub at full length (no
// head-to-tail alpha ramp). Parented under the head group so the
// rings follow Orbit through any body motion without per-frame
// position writes.
// -----------------------------------------------------------------------

/**
 * Point count per ring. Dense enough that adjacent sparkles overlap
 * for a continuous read even on high-DPI mobile; cheap enough for the
 * Quest GPU budget. 2 rings × 140 points = 280 extra points total.
 */
const RING_POINT_COUNT = 140

export interface OrbitRingHandle {
  points: THREE.Points
  geom: THREE.BufferGeometry
  mat: THREE.ShaderMaterial
  currentIntensity: number
}

/**
 * Build one sparkle ring per sub-sphere, sampled along the sub's
 * precomputed `orbitBasis` (set in `orbitScene.ts/buildScene`).
 * Parented to `parent` (typically the head group) so the ring
 * translates with Orbit's body automatically. Caller should read
 * each sub's `userData.orbitBasis`.
 */
export function buildOrbitRings(
  parent: THREE.Object3D,
  subSpheres: THREE.Mesh[],
  orbitRadius: number,
  palette: PaletteKey,
  pixelRatio: number,
): OrbitRingHandle[] {
  return subSpheres.map((sub) => {
    const basis = sub.userData.orbitBasis as { u: THREE.Vector3; v: THREE.Vector3 }
    const positions = new Float32Array(RING_POINT_COUNT * 3)
    const sizes = new Float32Array(RING_POINT_COUNT)
    const seeds = new Float32Array(RING_POINT_COUNT)
    for (let i = 0; i < RING_POINT_COUNT; i++) {
      const t = (i / RING_POINT_COUNT) * Math.PI * 2
      const cp = Math.cos(t) * orbitRadius
      const sp = Math.sin(t) * orbitRadius
      positions[i * 3]     = basis.u.x * cp + basis.v.x * sp
      positions[i * 3 + 1] = basis.u.y * cp + basis.v.y * sp
      positions[i * 3 + 2] = basis.u.z * cp + basis.v.z * sp
      // Tight size variance — a ring of identical specks reads as a
      // dotted line; small random size gives the "cloud of sparkles"
      // texture the concept art has.
      sizes[i] = 7 + Math.random() * 6
      seeds[i] = Math.random()
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geom.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(IDLE_TRAIL_COLOR) },
        uIntensity: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float size; attribute float seed;
        uniform float uPixelRatio;
        varying float vSeed;
        void main() {
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (0.35 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float fade = 1.0 - smoothstep(0.0, 0.5, d);
          fade = pow(fade, 2.0);
          // Per-sparkle twinkle — each particle has its own phase so
          // the ring shimmers rather than throbbing in unison.
          float twinkle = 0.55 + 0.45 * sin(uTime * 5.0 + vSeed * 6.2831);
          float a = uIntensity * fade * twinkle;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
    const points = new THREE.Points(geom, mat)
    parent.add(points)
    return { points, geom, mat, currentIntensity: 0 }
  })
}

/**
 * Per-frame orbit-ring update. Intensity target comes from the active
 * state's EXPRESSIONS.ringIntensity; color shares the trail decision
 * table (warm off-white idle, palette accent for expressive states).
 *
 * No per-frame geometry writes — the ring geometry is static in head
 * space and the head group's world transform updates the ring's
 * rendered position for free.
 */
export function updateOrbitRings(
  rings: OrbitRingHandle[],
  state: StateKey,
  palette: PaletteKey,
  time: number,
): void {
  const color = trailColorFor(state, palette)
  const target = expressionFor(state).ringIntensity
  for (const r of rings) {
    r.mat.uniforms.uColor.value.set(color)
    r.mat.uniforms.uTime.value = time
    r.currentIntensity = lerp(r.currentIntensity, target, 0.06)
    r.mat.uniforms.uIntensity.value = r.currentIntensity
  }
}

export function setOrbitRingsPixelRatio(rings: OrbitRingHandle[], pixelRatio: number): void {
  for (const r of rings) r.mat.uniforms.uPixelRatio.value = pixelRatio
}
