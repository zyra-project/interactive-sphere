/**
 * Bootstrap for the Orbit standalone page.
 *
 * Runs at `/orbit` (production) or `/orbit.html` (fallback). Wires the
 * OrbitController to its canvas host and initializes the debug panel.
 * See docs/ORBIT_CHARACTER_INTEGRATION_PLAN.md.
 */

import './styles/tokens.css'
import './styles/orbit.css'
import { OrbitController, ALL_STATES, STATES, type StateKey, type PaletteKey } from './services/orbitCharacter'
import { initOrbitDebugPanel } from './ui/orbitDebugPanel'

const ALLOWED_STATES = new Set<StateKey>(ALL_STATES)
const ALLOWED_PALETTES = new Set<PaletteKey>(['cyan', 'green', 'amber', 'violet'])

function readUrlOverrides(): { state?: StateKey; palette?: PaletteKey } {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const out: { state?: StateKey; palette?: PaletteKey } = {}
  const s = params.get('state')?.toUpperCase()
  if (s && ALLOWED_STATES.has(s as StateKey)) out.state = s as StateKey
  const p = params.get('palette')?.toLowerCase()
  if (p && ALLOWED_PALETTES.has(p as PaletteKey)) out.palette = p as PaletteKey
  return out
}

function announce(msg: string): void {
  const live = document.getElementById('a11y-announcer')
  if (live) live.textContent = msg
}

function updateCanvasAriaLabel(state: StateKey): void {
  const host = document.getElementById('orbit-canvas-host')
  if (host) host.setAttribute('aria-label', `Orbit character, ${labelFor(state)}`)
}

function labelFor(state: StateKey): string {
  return STATES[state].label
}

function bootstrap(): void {
  const host = document.getElementById('orbit-canvas-host')
  if (!host) {
    console.error('Orbit: #orbit-canvas-host not found')
    return
  }

  const overrides = readUrlOverrides()

  const controller = new OrbitController({
    container: host,
    palette: overrides.palette ?? 'cyan',
    onStateChange: (state) => {
      updateCanvasAriaLabel(state)
      announce(`Orbit is now ${labelFor(state).toLowerCase()}`)
    },
  })

  if (overrides.state) controller.setState(overrides.state)
  updateCanvasAriaLabel(controller.getState())

  initOrbitDebugPanel(controller)

  // Expose for console debugging and the eventual postMessage bridge.
  // Kept as a property on a namespaced object so it doesn't collide
  // with anything the main app might someday inject.
  ;(window as unknown as { __orbit?: { controller: OrbitController } }).__orbit = {
    controller,
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true })
} else {
  bootstrap()
}
