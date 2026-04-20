/**
 * Materials and shaders for the Orbit character.
 *
 * Vinyl-toy redesign: the body and sub-spheres use a matte
 * `MeshStandardMaterial` whose diffuse channel is overwritten with a
 * warm→cool gradient via `onBeforeCompile`. The gradient runs along a
 * tilted axis (pink-top → cool-bottom with a slight diagonal lean) so
 * the face reads with warm light from above — the neotenous cue the
 * concept art carries.
 *
 * The eye is a stacked disc rig (iris ring, navy pupil field with
 * star sparkles, tiny black pupil dot, two catchlights) that sells
 * the "big wet anime eye" read the concept art shows. See
 * `docs/ORBIT_CHARACTER_VINYL_REDESIGN.md`.
 */

import * as THREE from 'three'
import { PALETTES, type PaletteKey } from './orbitTypes'

// -----------------------------------------------------------------------
// Vinyl body — MeshStandardMaterial with a warm→cool gradient injected
// via onBeforeCompile. Gradient direction is a tilted axis (top-pink,
// bottom-cool, leaning ~15° off vertical) so the face carries a warm
// wash from above and the lower body cools toward the bottom. Matches
// the concept art's lit-from-above vinyl read and the soft neoteny cue
// of a warm forehead.
// -----------------------------------------------------------------------

/**
 * Half-length of the gradient axis in object space. Anything outside
 * this range clamps to the edge color. Matches the body radius
 * (0.075) plus head-room so silhouette pixels hit the clean anchor.
 */
const BODY_GRADIENT_HALF_SPAN = 0.095

/**
 * Gradient axis direction in object space, normalized. Roughly
 * (0.26, -0.97, 0.0) — 15° off vertical, so the warm anchor sits
 * slightly up-and-to-the-left and cool anchor down-and-to-the-right.
 * The Y component dominates so the read is "warm top, cool bottom";
 * the X lean gives the diagonal sparkle the concept art has.
 */
const BODY_GRADIENT_AXIS_X = 0.259
const BODY_GRADIENT_AXIS_Y = -0.966
const BODY_GRADIENT_AXIS_Z = 0.0

export interface BodyMaterialBundle {
  /**
   * The actual mesh material. A MeshStandardMaterial (not a
   * ShaderMaterial) so Three.js's standard lighting pipeline — key
   * light, shadows, tone mapping — works without reinventing each.
   */
  material: THREE.MeshStandardMaterial
  /**
   * Gradient uniforms that `updateCharacter` writes each frame from
   * the active palette. `uTime` is retained as a field (unused by
   * the fragment today) so callers that expected the legacy
   * interface still type-check.
   */
  uniforms: {
    uTime: { value: number }
    uWarm: { value: THREE.Color }
    uCool: { value: THREE.Color }
    uSpan: { value: number }
    /**
     * Gradient direction in object space — unit vector pointing from
     * cool anchor toward warm anchor. Exposed on the bundle so future
     * state-driven tweaks (e.g. spinning the axis for a confused
     * spiral) don't need to recompile the shader.
     */
    uAxis: { value: THREE.Vector3 }
    /**
     * Back-compat handles. The legacy `uBaseColor` / `uAccentColor`
     * / `uGlowColor` uniforms were read by other subsystems; we
     * keep Color instances so `updateCharacter` can still
     * `.set(p.base)` etc. without branching. Nothing in the
     * gradient shader reads them.
     */
    uBaseColor: { value: THREE.Color }
    uAccentColor: { value: THREE.Color }
    uGlowColor: { value: THREE.Color }
  }
}

export function createBodyMaterial(palette: PaletteKey = 'cyan'): BodyMaterialBundle {
  const p = PALETTES[palette]
  const uniforms = {
    uTime: { value: 0 },
    uWarm: { value: new THREE.Color(p.warm) },
    uCool: { value: new THREE.Color(p.cool) },
    uSpan: { value: BODY_GRADIENT_HALF_SPAN },
    uAxis: { value: new THREE.Vector3(BODY_GRADIENT_AXIS_X, BODY_GRADIENT_AXIS_Y, BODY_GRADIENT_AXIS_Z) },
    uBaseColor: { value: new THREE.Color(p.base) },
    uAccentColor: { value: new THREE.Color(p.accent) },
    uGlowColor: { value: new THREE.Color(p.glow) },
  }
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.0,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWarm = uniforms.uWarm
    shader.uniforms.uCool = uniforms.uCool
    shader.uniforms.uSpan = uniforms.uSpan
    shader.uniforms.uAxis = uniforms.uAxis
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vOrbitObjPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vOrbitObjPos = position;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uWarm;
         uniform vec3 uCool;
         uniform float uSpan;
         uniform vec3 uAxis;
         varying vec3 vOrbitObjPos;`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        // Project the object-space position onto the gradient axis.
        // uAxis points from cool → warm anchor; dot() returns + when
        // the fragment sits on the warm side. Remap to [0,1], mix.
        `float orbitG = clamp(dot(vOrbitObjPos, uAxis) / uSpan * 0.5 + 0.5, 0.0, 1.0);
         vec3 orbitGradient = mix(uCool, uWarm, orbitG);
         vec4 diffuseColor = vec4( orbitGradient, opacity );`,
      )
  }
  return { material, uniforms }
}

// -----------------------------------------------------------------------
// Eye field — flat disc with shader-driven upper/lower lid coverage.
// Lids render in the body's WARM anchor color so the eye reads as
// "skin folding over opaque vinyl" with no visible seam against the
// new gradient body. See ORBIT_CHARACTER_VINYL_REDESIGN.md "Face".
// -----------------------------------------------------------------------

export interface EyeFieldMaterialBundle {
  material: THREE.ShaderMaterial
  uniforms: {
    uUpperLid: { value: number }
    uLowerLid: { value: number }
    uBodyColor: { value: THREE.Color }
    uBodyAccent: { value: THREE.Color }
    uEyeColor: { value: THREE.Color }
    uRimColor: { value: THREE.Color }
  }
}

export function createEyeFieldMaterial(palette: PaletteKey = 'cyan'): EyeFieldMaterialBundle {
  const p = PALETTES[palette]
  const uniforms = {
    uUpperLid: { value: 0 },
    uLowerLid: { value: 0 },
    // `uBodyColor` now gets written with the palette's WARM anchor
    // (the left side of the gradient), which is the hue that sits
    // directly above/below the eye disc. Lids close to that color so
    // the lid+body seam is invisible.
    uBodyColor: { value: new THREE.Color(p.warm) },
    uBodyAccent: { value: new THREE.Color(p.accent) },
    // Warm dark charcoal instead of near-black — reads as socket
    // shadow, not void. Inner disc is ever-so-slightly lighter so
    // the outer rim reads as a distinct bezel edge (the 3-D-looking
    // socket ring in the concept art), sold entirely by the inner
    // vs. rim contrast without extra geometry.
    uEyeColor: { value: new THREE.Color(0x1f1a24) },
    uRimColor: { value: new THREE.Color(0x0f0a12) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uUpperLid; uniform float uLowerLid;
      uniform vec3 uBodyColor; uniform vec3 uBodyAccent;
      uniform vec3 uEyeColor; uniform vec3 uRimColor;
      void main() {
        vec2 c = vUv - vec2(0.5);
        float dist = length(c);
        float eyeMask = 1.0 - smoothstep(0.48, 0.50, dist);
        if (eyeMask < 0.01) discard;
        // Wider bezel zone — darker ring around the iris. Reads as a
        // soft 3-D socket rim even though the geometry is flat.
        float rimFactor = smoothstep(0.30, 0.49, dist);
        float y = c.y + 0.5;
        float upperCov = smoothstep(1.0 - uUpperLid - 0.04, 1.0 - uUpperLid + 0.04, y);
        float lowerCov = 1.0 - smoothstep(uLowerLid - 0.04, uLowerLid + 0.04, y);
        float covered = max(upperCov, lowerCov);
        float crease = 1.0 - abs(y - (1.0 - uUpperLid)) * 6.0;
        crease = max(crease, 1.0 - abs(y - uLowerLid) * 6.0);
        crease = clamp(crease, 0.0, 1.0) * covered;
        vec3 lidColor = mix(uBodyColor, uBodyAccent, crease * 0.2);
        vec3 baseColor = mix(uEyeColor, uRimColor, rimFactor);
        vec3 color = mix(baseColor, lidColor, covered);
        gl_FragColor = vec4(color, eyeMask);
      }`,
  })
  return { material, uniforms }
}

// -----------------------------------------------------------------------
// Eye stack — iris ring, navy pupil field with star sparkles, dark
// pupil dot, plus a soft additive iris glow. Shared across the two
// paired eyes so a palette swap is still one write per material.
// See `docs/ORBIT_CHARACTER_VINYL_REDESIGN.md` §Face.
// -----------------------------------------------------------------------

/**
 * Deep navy of the pupil field — the "dark-blue-with-stars" area
 * inside the teal iris ring. Warm navy (not pure black) so it reads
 * as "big liquid anime eye" rather than a dead hole.
 */
const PUPIL_FIELD_COLOR = 0x1a2040

/**
 * Near-black of the tiny pupil-center dot. Just dark enough to
 * register against the navy field without flattening into a void.
 */
const PUPIL_DOT_COLOR = 0x05080e

export interface PupilMaterials {
  /**
   * Iris ring — the accent-colored disc that becomes the visible
   * "iris" once the navy pupil field covers its center. Carries the
   * palette accent + state-driven pupil-color tint (SOLEMN blue,
   * CONFUSED amber, gesture flashes).
   */
  irisMat: THREE.MeshBasicMaterial
  /**
   * Additive accent glow behind the iris. Tinted the same as the
   * iris so the color pops in state transitions.
   */
  irisGlowMat: THREE.MeshBasicMaterial
  /**
   * Dark navy pupil-field disc. Covers the iris center, leaving the
   * iris visible only as a ring. Holds the star sparkles on top.
   */
  pupilFieldMat: THREE.MeshBasicMaterial
  /**
   * Tiny near-black pupil-center dot. The "real" anatomical pupil;
   * scales with state pupilSize like the old single-color pupil did.
   */
  pupilDotMat: THREE.MeshBasicMaterial
  /**
   * Additive-white material for the iris sparkle stars. Shared across
   * all star sprites on both eyes. See {@link createStarGeometry}.
   */
  starMat: THREE.MeshBasicMaterial
}

export function createPupilMaterials(palette: PaletteKey = 'cyan'): PupilMaterials {
  const accent = new THREE.Color(PALETTES[palette].accent)
  return {
    irisMat: new THREE.MeshBasicMaterial({
      color: accent.clone(),
      transparent: true,
    }),
    irisGlowMat: new THREE.MeshBasicMaterial({
      color: accent.clone(),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    }),
    pupilFieldMat: new THREE.MeshBasicMaterial({
      color: new THREE.Color(PUPIL_FIELD_COLOR),
      transparent: true,
    }),
    pupilDotMat: new THREE.MeshBasicMaterial({
      color: new THREE.Color(PUPIL_DOT_COLOR),
      transparent: true,
    }),
    starMat: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  }
}

/**
 * Build a tiny five-point star geometry for iris sparkles. Four
 * inner vertices pinch toward the center to give the star its
 * pointed-lobe shape without going full SVG-path on the GPU.
 * Shared across every star sprite on both eyes — clones of the
 * mesh share the geometry so memory stays flat.
 */
export function createStarGeometry(radius: number): THREE.BufferGeometry {
  const points = 5
  const inner = radius * 0.42
  // Triangle-fan: center vertex at index 0, then 2*points outer vertices
  // alternating between the long-ray tip and the short inner dip.
  const verts = new Float32Array((1 + 2 * points + 1) * 3)
  verts[0] = 0; verts[1] = 0; verts[2] = 0
  for (let i = 0; i <= 2 * points; i++) {
    const wrapped = i % (2 * points)
    const r = wrapped % 2 === 0 ? radius : inner
    // Top vertex is a tip (upward-pointing star); rotate -π/2 to start there.
    const angle = -Math.PI / 2 + (wrapped / (2 * points)) * Math.PI * 2
    verts[(i + 1) * 3] = Math.cos(angle) * r
    verts[(i + 1) * 3 + 1] = Math.sin(angle) * r
    verts[(i + 1) * 3 + 2] = 0
  }
  const idx: number[] = []
  for (let i = 0; i < 2 * points; i++) {
    idx.push(0, i + 1, i + 2)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geom.setIndex(idx)
  return geom
}

// -----------------------------------------------------------------------
// Catchlight — static additive-white disc that sits on each eye and
// stays fixed relative to the eye group as the pupil moves. Two
// highlights per eye (primary upper-right, secondary lower-left) sell
// the "wet, alive" read that rigid pupils alone can't.
// -----------------------------------------------------------------------

export function createCatchlightMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
}

// -----------------------------------------------------------------------
// Backlight halo — soft warm radial glow that sits behind the body
// and bleeds outward to the scene background. Closes the "luminous
// vinyl toy" read from the concept art without having to pump
// emissive on the body material (which would fight the matte look).
// -----------------------------------------------------------------------

export interface BacklightMaterialBundle {
  material: THREE.ShaderMaterial
  uniforms: {
    uColor: { value: THREE.Color }
    uOpacity: { value: number }
  }
}

/**
 * Warm-white halo color. Kept constant across palettes — the
 * backlight is ambient "lit from behind" light, not character color.
 * Palette-tinting the halo makes the cool palettes read as sickly;
 * a neutral warm glow flatters every option.
 */
const BACKLIGHT_COLOR = 0xffd4a0

export function createBacklightMaterial(): BacklightMaterialBundle {
  const uniforms = {
    uColor: { value: new THREE.Color(BACKLIGHT_COLOR) },
    uOpacity: { value: 0.42 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        vec2 c = vUv - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float fade = 1.0 - smoothstep(0.0, 0.5, d);
        fade = pow(fade, 1.6);
        gl_FragColor = vec4(uColor, uOpacity * fade);
      }`,
  })
  return { material, uniforms }
}

/**
 * Vinyl sub-sphere material — same gradient pipeline as the body,
 * same matte roughness. Returning the bundle (not just the material)
 * lets `updateCharacter` palette-propagate without branching.
 */
export function createSubSphereMaterial(palette: PaletteKey = 'cyan'): BodyMaterialBundle {
  // Subs share the body's gradient recipe; `createBodyMaterial`
  // already parameterizes the whole thing on palette anchors. The
  // returned bundle structure is identical, so per-frame palette
  // writes iterate body + subs with the same code path.
  return createBodyMaterial(palette)
}

// Earth material lived here as a procedural continent shader while
// the photoreal stack was being built. It's now in
// `src/services/photorealEarth.ts` — the Orbit scene consumes that
// factory directly. No local Earth material exports remain.
