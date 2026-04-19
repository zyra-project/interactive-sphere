/**
 * Three.js scene graph for the Orbit character — Phase 1.
 *
 * Builds the head group (body + eye + pupil) and two sub-spheres
 * circling the body. The animation loop runs the prototype's Idle
 * behavior: gentle body sway, wandering pupil, slow-cycling blink,
 * tilted elliptical sub-sphere orbits.
 *
 * Shaders, tuning constants, and orbit math are lifted verbatim from
 * `docs/prototypes/orbit-prototype.jsx` to preserve the nine-iteration
 * visual tuning. See docs/ORBIT_CHARACTER_INTEGRATION_PLAN.md §5.
 *
 * Later phases extend this module with the STATES table (Phase 3),
 * gestures (Phase 4), flight + scale presets (Phase 5).
 */

import * as THREE from 'three'
import {
  createBodyMaterial,
  createEyeFieldMaterial,
  createPupilMaterials,
  type BodyMaterialBundle,
  type EyeFieldMaterialBundle,
  type PupilMaterials,
} from './orbitMaterials'
import { PALETTES, type PaletteKey } from './orbitTypes'

const BODY_RADIUS = 0.075
const SUB_RADIUS = 0.009
const SUB_ORBIT_RADIUS = 0.14
const IDLE_ORBIT_SPEED = 0.5 // matches STATES.IDLE.orbitSpeed in prototype

export interface OrbitSceneHandles {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  head: THREE.Group
  body: THREE.Mesh
  bodyBundle: BodyMaterialBundle
  eyeGroup: THREE.Group
  eyeBundle: EyeFieldMaterialBundle
  pupil: THREE.Mesh
  pupilGlow: THREE.Mesh
  pupilMaterials: PupilMaterials
  subSpheres: THREE.Mesh[]
}

export function buildScene(palette: PaletteKey = 'cyan'): OrbitSceneHandles {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x060810)

  // Close preset framing — intimate, tabletop distance.
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40)
  camera.position.set(0, 0, 1.1)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.75)
  keyLight.position.set(0.6, 0.8, 0.5)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.15)
  fillLight.position.set(-0.6, 0.3, 0.4)
  scene.add(fillLight)

  const head = new THREE.Group()
  scene.add(head)

  const bodyBundle = createBodyMaterial(palette)
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BODY_RADIUS, 4),
    bodyBundle.material,
  )
  head.add(body)

  const eyeGroup = new THREE.Group()
  head.add(eyeGroup)

  const eyeBundle = createEyeFieldMaterial(palette)
  const eyeDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.030, 64),
    eyeBundle.material,
  )
  eyeDisc.position.z = BODY_RADIUS + 0.0003
  eyeGroup.add(eyeDisc)

  const pupilMaterials = createPupilMaterials(palette)
  const pupilGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.014, 48),
    pupilMaterials.glowMat,
  )
  pupilGlow.position.z = BODY_RADIUS + 0.0005
  eyeGroup.add(pupilGlow)

  const pupil = new THREE.Mesh(
    new THREE.CircleGeometry(0.008, 48),
    pupilMaterials.pupilMat,
  )
  pupil.position.z = BODY_RADIUS + 0.0006
  eyeGroup.add(pupil)

  const subSpheres: THREE.Mesh[] = []
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTES[palette].accent),
    })
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(SUB_RADIUS, 2),
      mat,
    )
    mesh.userData.phaseOffset = (i / 2) * Math.PI * 2
    scene.add(mesh)
    subSpheres.push(mesh)
  }

  return {
    scene, camera, head, body, bodyBundle,
    eyeGroup, eyeBundle, pupil, pupilGlow, pupilMaterials,
    subSpheres,
  }
}

export interface IdleAnimationState {
  orbitPhaseAccum: number
  wanderTarget: { x: number, y: number }
  wanderTimer: number
  blinkStartTime: number
  nextBlinkTime: number
  currentEyeYaw: number
  currentEyePitch: number
}

export function createIdleAnimationState(): IdleAnimationState {
  return {
    orbitPhaseAccum: 0,
    wanderTarget: { x: 0, y: 0 },
    wanderTimer: 0,
    blinkStartTime: -1,
    nextBlinkTime: 1.0 + Math.random() * 2.0,
    currentEyeYaw: 0,
    currentEyePitch: 0,
  }
}

/**
 * Per-frame update for the Idle state.
 *
 * Motion systems (lifted from the prototype's animate() loop, trimmed
 * to just the subset Idle exercises):
 *   - Body sway: gentle pitch/roll on sin curves.
 *   - Pupil wander: target eased every ~1.8s within a small cone.
 *   - Blink: auto-scheduled every 4s; 0.14s duration.
 *   - Sub-spheres: tilted elliptical orbits around body center.
 */
export function updateIdle(
  handles: OrbitSceneHandles,
  state: IdleAnimationState,
  time: number,
  dt: number,
): void {
  handles.bodyBundle.uniforms.uTime.value = time

  // Body sway — matches prototype's Idle sway parameters.
  handles.body.rotation.x = Math.sin(time * 0.5) * 0.05
  handles.body.rotation.z = Math.sin(time * 0.7) * 0.03
  handles.body.position.y = Math.sin(time * 0.8) * 0.003

  // Pupil wander: pick a new target every 1.8s, ease toward it.
  state.wanderTimer -= dt
  if (state.wanderTimer <= 0) {
    state.wanderTarget.x = (Math.random() - 0.5) * 0.35
    state.wanderTarget.y = (Math.random() - 0.5) * 0.25
    state.wanderTimer = 1.2 + Math.random() * 1.2
  }
  const eyeEaseRate = 3
  state.currentEyeYaw += (state.wanderTarget.x - state.currentEyeYaw) * eyeEaseRate * dt
  state.currentEyePitch += (state.wanderTarget.y - state.currentEyePitch) * eyeEaseRate * dt
  handles.eyeGroup.rotation.y = state.currentEyeYaw
  handles.eyeGroup.rotation.x = -state.currentEyePitch

  // Auto-blink scheduler.
  if (state.blinkStartTime < 0 && time >= state.nextBlinkTime) {
    state.blinkStartTime = time
  }
  let blinkValue = 0
  if (state.blinkStartTime >= 0) {
    const blinkT = (time - state.blinkStartTime) / 0.14
    if (blinkT >= 1) {
      state.blinkStartTime = -1
      state.nextBlinkTime = time + 4.0 + Math.random() * 2.0
    } else {
      blinkValue = Math.sin(blinkT * Math.PI) // 0 → 1 → 0
    }
  }
  handles.eyeBundle.uniforms.uUpperLid.value = blinkValue
  handles.eyeBundle.uniforms.uLowerLid.value = 0

  // Sub-spheres: tilted elliptical orbits. Integrate phase by current
  // speed so future phases can modulate orbitSpeed without glitches.
  state.orbitPhaseAccum += IDLE_ORBIT_SPEED * dt
  const radius = SUB_ORBIT_RADIUS
  handles.subSpheres.forEach((sub, i) => {
    const phase = state.orbitPhaseAccum + (sub.userData.phaseOffset as number)
    const tilt = i * 0.8 + 0.3
    sub.position.set(
      Math.cos(phase) * radius,
      Math.sin(phase * 0.7 + tilt) * radius * 0.4,
      Math.sin(phase) * radius,
    )
  })
}
