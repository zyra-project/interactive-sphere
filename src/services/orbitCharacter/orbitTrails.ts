/**
 * Sub-sphere trails — sparkling wakes that wrap into rings during
 * steady idle orbit.
 *
 * The trail is a `THREE.Points` rolling buffer following the sub's
 * current position. The buffer is long enough (and written on a
 * downsampled cadence) that one full idle-orbit period fits within
 * it — so after a few seconds of steady orbit, the trail wraps
 * around Orbit's body and reads as a closed sparkle ring. When the
 * sub breaks away (POINTING / TRACE / BURST / etc.) the SAME buffer
 * naturally becomes a comet wake behind the sub — no separate code
 * path, no state switching.
 *
 * Design doc hazard: `THREE.Line` / `Line2` render at 1 pixel width
 * on mobile GPUs regardless of the requested `linewidth`. Trails
 * stay on `THREE.Points` with a custom point-sprite shader (circular
 * fade, distance-scaled size, additive blending). Per-vertex `size`
 * and `alpha` give the wake shape; per-vertex `seed` + `uTime`
 * drive the twinkle.
 *
 * Color + intensity are decision-table driven:
 *   - `trailColorFor(state, palette)` — idle/quiet states use warm
 *     off-white; expressive states use the active palette accent.
 *     New states default to the idle bucket.
 *   - Intensity reads `expressionFor(state).trailIntensity`, which
 *     sits in the shared EXPRESSIONS table in `orbitStates.ts` so
 *     adding a new state inherits a sensible default without edits.
 *
 * See `docs/ORBIT_CHARACTER_VINYL_REDESIGN.md` §4.
 */

import * as THREE from 'three'
import { PALETTES, type PaletteKey } from './orbitTypes'
import { expressionFor, STATES } from './orbitStates'
import type { StateKey } from './orbitTypes'

/**
 * Rolling buffer size. Long enough that at IDLE orbit speed
 * (~6.3 s per orbit) and our downsampled write cadence, the buffer
 * fully wraps around the orbit path within a handful of seconds.
 * Tuning target: 160 points × 30 writes/sec = 5.3 s of coverage,
 * roughly 85 % of an IDLE orbit — reads as a near-complete ring
 * with a subtle bright head at the sub's current position.
 */
export const TRAIL_LENGTH = 160

/**
 * Trail write cadence. We shift the rolling buffer and write a new
 * head point every Nth frame. Lower write rate = each buffer slot
 * covers more motion distance = longer visible trail for the same
 * buffer length. At 60 fps with N=2, we effectively run the trail
 * at 30 Hz, which is plenty for a continuous sparkle read.
 */
const TRAIL_WRITE_EVERY_N_FRAMES = 2

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
  /**
   * Frame counter used to downsample writes to
   * `TRAIL_WRITE_EVERY_N_FRAMES`. Incremented once per call to
   * `updateTrails`; when it hits the modulus, we roll the buffer.
   */
  writeCounter: number
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
      // Alpha profile: mostly flat with a brief bright spike at the
      // head (newest point) and a soft fade at the oldest tail. A
      // flat mid-body is what lets a long trail read as a clean ring
      // when it wraps during idle — a simple linear taper would
      // read as a dimming spiral.
      const t = 1 - j / TRAIL_LENGTH // 1.0 at head (j=0), 0.0 at tail
      let a: number
      if (t > 0.92) {
        // Head spike — a brief 10 % window of extra brightness so
        // the sub's current location is legible at a glance.
        a = 1.0 + (t - 0.92) * 2.0
      } else if (t > 0.12) {
        // Flat body.
        a = 0.85
      } else {
        // Soft tail fade from 0.85 at t=0.12 down to 0 at t=0.
        a = (t / 0.12) * 0.85
      }
      alphas[j] = a
      // Slight per-vertex size jitter reinforces the "sparkle" read —
      // uniform-size points look like a dashed line instead.
      sizes[j] = 5 + 10 * a * (0.75 + Math.random() * 0.5)
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
    return { points, geom, mat, positions, currentIntensity: 0, writeCounter: 0 }
  })
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Per-frame trail update.
 *
 * Pulls the target intensity from `expressionFor(state).trailIntensity`
 * (so new states inherit the default silently) and the color from
 * `trailColorFor`. Eases the current intensity toward the target and
 * — every `TRAIL_WRITE_EVERY_N_FRAMES` frames — shifts the rolling
 * buffer and writes the current sub-sphere position at the head.
 *
 * Sub 0 owns the directional trail during point/trace (sub 1's trail
 * is suppressed so the lead sub's motion reads cleanly). `flightBoost`
 * lifts trail intensity during Orbit's fly-to-Earth arc so the
 * journey leaves a visible streak.
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
  const expr = expressionFor(state)
  const trailColor = trailColorFor(state, palette)
  trails.forEach((trail, i) => {
    trail.mat.uniforms.uColor.value.set(trailColor)
    trail.mat.uniforms.uTime.value = time
    let targetIntensity = Math.max(flightBoost, expr.trailIntensity)
    if ((s.subMode === 'point' || s.subMode === 'trace') && i !== 0) {
      targetIntensity = 0
    }
    trail.currentIntensity = lerp(trail.currentIntensity, targetIntensity, 0.08)
    trail.mat.uniforms.uIntensity.value = trail.currentIntensity

    // Downsample writes — we still ease intensity every frame, but
    // the rolling buffer shifts at a reduced cadence so each slot
    // covers more path distance. Net effect: a longer visible trail
    // for the same buffer memory, which is what lets the tail wrap
    // into a closed sparkle ring during steady idle orbit.
    trail.writeCounter += 1
    if (trail.writeCounter < TRAIL_WRITE_EVERY_N_FRAMES) return
    trail.writeCounter = 0

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
