/**
 * Debug panel wiring for the Orbit standalone page.
 *
 * Phase 1 shows read-only state/palette values and a collapse toggle.
 * Later phases extend this with:
 *   - State select (Phase 3)
 *   - Gesture buttons (Phase 4)
 *   - Scale-preset segmented control + Fly to Earth (Phase 5)
 *   - Palette radio group (Phase 6)
 */

import type { OrbitController } from '../services/orbitCharacter'

export function initOrbitDebugPanel(controller: OrbitController): void {
  const panel = document.querySelector<HTMLElement>('.orbit-debug-panel')
  const toggleBtn = document.querySelector<HTMLButtonElement>('.orbit-debug-toggle')
  const stateOut = document.getElementById('orbit-debug-state')
  const paletteOut = document.getElementById('orbit-debug-palette')

  if (!panel || !toggleBtn || !stateOut || !paletteOut) return

  const announce = (msg: string) => {
    const live = document.getElementById('a11y-announcer')
    if (live) live.textContent = msg
  }

  const refresh = () => {
    stateOut.textContent = labelForState(controller.getState())
    paletteOut.textContent = controller.getPalette()
  }

  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed')
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggleBtn.innerHTML = collapsed ? '&#x25B8;' : '&#x25BE;'
    announce(collapsed ? 'Debug panel collapsed' : 'Debug panel expanded')
  })

  refresh()
}

function labelForState(state: string): string {
  // State keys are uppercase internally; display form is title-case.
  return state.charAt(0) + state.slice(1).toLowerCase()
}
