/**
 * Debug panel wiring for the Orbit standalone page.
 *
 * Phase 2 adds the State select (grouped Behavior / Emotion / Head
 * per the design doc's catalog). Later phases extend with:
 *   - Gesture buttons (Phase 3)
 *   - Scale-preset segmented control + Fly to Earth (Phase 4)
 *   - Palette radio group (Phase 5)
 */

import type { OrbitController, StateKey } from '../services/orbitCharacter'
import { BEHAVIOR_STATES, EMOTION_STATES, GESTURE_STATES, STATES } from '../services/orbitCharacter'

export function initOrbitDebugPanel(controller: OrbitController): void {
  const panel = document.querySelector<HTMLElement>('.orbit-debug-panel')
  const toggleBtn = document.querySelector<HTMLButtonElement>('.orbit-debug-toggle')
  const stateSelect = document.getElementById('orbit-debug-state') as HTMLSelectElement | null
  const paletteOut = document.getElementById('orbit-debug-palette')

  if (!panel || !toggleBtn || !stateSelect || !paletteOut) return

  populateStateOptions(stateSelect)
  stateSelect.value = controller.getState()
  paletteOut.textContent = controller.getPalette()

  stateSelect.addEventListener('change', () => {
    controller.setState(stateSelect.value as StateKey)
  })

  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed')
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggleBtn.innerHTML = collapsed ? '&#x25B8;' : '&#x25BE;'
    announce(collapsed ? 'Debug panel collapsed' : 'Debug panel expanded')
  })
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

function announce(msg: string): void {
  const live = document.getElementById('a11y-announcer')
  if (live) live.textContent = msg
}
