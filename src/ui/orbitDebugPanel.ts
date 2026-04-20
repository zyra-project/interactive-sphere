/**
 * Debug panel wiring for the Orbit standalone page.
 *
 * Phase 3 adds gesture buttons (Shrug, Wave, Beckon, Affirm) that
 * disable while a gesture is playing to match the design doc's
 * one-at-a-time rule. Phase 4 will add flight controls + scale
 * preset; Phase 5 adds the palette radio group.
 */

import type { OrbitController, StateKey, GestureKind } from '../services/orbitCharacter'
import {
  BEHAVIOR_STATES, EMOTION_STATES, GESTURE_STATES, STATES,
  GESTURE_KEYS, GESTURES,
} from '../services/orbitCharacter'

export function initOrbitDebugPanel(controller: OrbitController): void {
  const panel = document.querySelector<HTMLElement>('.orbit-debug-panel')
  const toggleBtn = document.querySelector<HTMLButtonElement>('.orbit-debug-toggle')
  const stateSelect = document.getElementById('orbit-debug-state') as HTMLSelectElement | null
  const gestureHost = document.getElementById('orbit-debug-gestures')
  const paletteOut = document.getElementById('orbit-debug-palette')

  if (!panel || !toggleBtn || !stateSelect || !gestureHost || !paletteOut) return

  populateStateOptions(stateSelect)
  stateSelect.value = controller.getState()
  paletteOut.textContent = controller.getPalette()

  stateSelect.addEventListener('change', () => {
    controller.setState(stateSelect.value as StateKey)
  })

  const gestureButtons = buildGestureButtons(gestureHost, controller)

  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed')
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggleBtn.innerHTML = collapsed ? '&#x25B8;' : '&#x25BE;'
    announce(collapsed ? 'Debug panel collapsed' : 'Debug panel expanded')
  })

  // Poll gesture-playing state at a cheap rate so buttons disable
  // while any gesture runs. Gestures are short (≤ 1.8 s), so 10 Hz
  // is plenty and doesn't fight the render loop.
  setInterval(() => {
    const playing = controller.isGesturePlaying()
    for (const btn of gestureButtons) btn.disabled = playing
  }, 100)
}

function populateStateOptions(select: HTMLSelectElement): void {
  select.innerHTML = ''
  appendGroup(select, 'Behavior', BEHAVIOR_STATES)
  appendGroup(select, 'Emotion', EMOTION_STATES)
  appendGroup(select, 'Head', GESTURE_STATES)
}

function appendGroup(select: HTMLSelectElement, label: string, keys: StateKey[]): void {
  const group = document.createElement('optgroup')
  group.label = label
  keys.forEach((k) => {
    const opt = document.createElement('option')
    opt.value = k
    opt.textContent = STATES[k].label
    group.appendChild(opt)
  })
  select.appendChild(group)
}

function buildGestureButtons(host: HTMLElement, controller: OrbitController): HTMLButtonElement[] {
  host.innerHTML = ''
  const buttons: HTMLButtonElement[] = []
  for (const kind of GESTURE_KEYS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'orbit-debug-gesture'
    btn.textContent = GESTURES[kind].label
    btn.setAttribute('aria-label', `Play ${GESTURES[kind].label} gesture`)
    btn.addEventListener('click', () => {
      controller.playGesture(kind as GestureKind)
      announce(`Playing ${GESTURES[kind].label}`)
    })
    host.appendChild(btn)
    buttons.push(btn)
  }
  return buttons
}

function announce(msg: string): void {
  const live = document.getElementById('a11y-announcer')
  if (live) live.textContent = msg
}
