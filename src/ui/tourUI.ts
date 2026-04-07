/**
 * Tour UI — manages the tour control bar and text-box overlays.
 *
 * Text boxes (showRect / hideRect) are positioned as percentage-based DOM
 * overlays on top of the globe canvas, matching the SOS coordinate system
 * where (0,0) is bottom-left and (100,100) is top-right.
 */

import type { ShowRectTaskParams } from '../types'
import type { TourEngine } from '../services/tourEngine'

// ── Text-box overlay management ──────────────────────────────────────

/** Active text-box elements keyed by rectID */
const activeBoxes = new Map<string, HTMLElement>()

/**
 * Parse SOS-style markup in captions:
 *   \n           → <br>
 *   <i>...</i>   → <em>...</em>
 *   <color=X>    → <span style="color:X">
 *   </color>     → </span>
 */
function parseCaptionMarkup(raw: string): string {
  return raw
    .replace(/\\n/g, '<br>')
    .replace(/<i>/gi, '<em>')
    .replace(/<\/i>/gi, '</em>')
    .replace(/<color=([^>]+)>/gi, '<span style="color:$1">')
    .replace(/<\/color>/gi, '</span>')
}

/** Get or create the tour text-box container (lives inside #ui). */
function getTextBoxContainer(): HTMLElement {
  let container = document.getElementById('tour-textbox-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'tour-textbox-container'
    container.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:600;'
    const ui = document.getElementById('ui')
    if (ui) ui.appendChild(container)
    else document.body.appendChild(container)
  }
  return container
}

/** Show a text box overlay at the specified screen-percentage position. */
export function showTourTextBox(params: ShowRectTaskParams): void {
  // Remove existing box with the same ID
  hideTourTextBox(params.rectID)

  const container = getTextBoxContainer()
  const box = document.createElement('div')
  box.dataset.rectId = params.rectID
  box.className = 'tour-textbox'

  // SOS coordinate system: origin at bottom-left, values are percentages.
  // CSS origin is top-left, so we convert: top = 100 - yPct - heightPct/2
  // and left = xPct - widthPct/2 (since SOS positions from center of box).
  const left = Math.max(0, params.xPct - params.widthPct / 2)
  const bottom = Math.max(0, params.yPct - params.heightPct / 2)

  box.style.cssText = `
    position: absolute;
    left: ${left}%;
    bottom: ${bottom}%;
    width: ${params.widthPct}%;
    height: ${params.heightPct}%;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    ${params.captionPos === 'center' ? 'align-items:center;justify-content:center;text-align:center;' : ''}
    ${params.captionPos === 'left' ? 'align-items:flex-start;text-align:left;' : ''}
    ${params.captionPos === 'right' ? 'align-items:flex-end;text-align:right;' : ''}
    ${params.captionPos === 'top' ? 'align-items:center;justify-content:flex-start;text-align:center;' : ''}
    ${params.captionPos === 'bottom' ? 'align-items:center;justify-content:flex-end;text-align:center;' : ''}
    background: rgba(13, 13, 18, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: ${params.showBorder ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.06)'};
    border-radius: 10px;
    padding: 1.25rem;
    color: ${params.fontColor || 'white'};
    font-size: ${params.fontSize ? params.fontSize + 'px' : '0.85rem'};
    line-height: 1.55;
    overflow-y: auto;
    animation: tour-box-fadein 0.35s ease;
  `

  const caption = document.createElement('div')
  caption.innerHTML = parseCaptionMarkup(params.caption)
  box.appendChild(caption)

  if (params.isClosable) {
    const closeBtn = document.createElement('button')
    closeBtn.className = 'tour-textbox-close'
    closeBtn.innerHTML = '&#x2715;'
    closeBtn.title = 'Close'
    closeBtn.setAttribute('aria-label', 'Close text box')
    closeBtn.addEventListener('click', () => hideTourTextBox(params.rectID))
    box.appendChild(closeBtn)
  }

  container.appendChild(box)
  activeBoxes.set(params.rectID, box)
}

/** Hide and remove a text box by rectID. */
export function hideTourTextBox(rectID: string): void {
  const box = activeBoxes.get(rectID)
  if (box) {
    box.remove()
    activeBoxes.delete(rectID)
  }
}

/** Remove all active text boxes. */
export function hideAllTourTextBoxes(): void {
  for (const [id] of activeBoxes) {
    hideTourTextBox(id)
  }
}

// ── Tour controls bar ────────────────────────────────────────────────

let controlsEl: HTMLElement | null = null
let boundEngine: TourEngine | null = null
let spaceHandler: ((e: KeyboardEvent) => void) | null = null

/** Show the tour controls bar and bind it to the given engine. */
export function showTourControls(engine: TourEngine): void {
  boundEngine = engine

  controlsEl = document.getElementById('tour-controls')
  if (!controlsEl) return

  controlsEl.classList.remove('hidden')
  updateTourProgress(engine.currentIndex, engine.totalSteps)
  updatePlayPauseBtn(engine.state === 'playing')

  // Wire buttons
  document.getElementById('tour-prev-btn')?.addEventListener('click', onPrev)
  document.getElementById('tour-play-btn')?.addEventListener('click', onPlayPause)
  document.getElementById('tour-next-btn')?.addEventListener('click', onNext)
  document.getElementById('tour-stop-btn')?.addEventListener('click', onStop)

  // Space bar handler for resuming paused tours
  spaceHandler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space' && boundEngine && boundEngine.state === 'paused') {
      e.preventDefault()
      onPlayPause()
    }
  }
  document.addEventListener('keydown', spaceHandler)
}

/** Hide the tour controls bar and detach event listeners. */
export function hideTourControls(): void {
  controlsEl?.classList.add('hidden')
  document.getElementById('tour-prev-btn')?.removeEventListener('click', onPrev)
  document.getElementById('tour-play-btn')?.removeEventListener('click', onPlayPause)
  document.getElementById('tour-next-btn')?.removeEventListener('click', onNext)
  document.getElementById('tour-stop-btn')?.removeEventListener('click', onStop)
  if (spaceHandler) {
    document.removeEventListener('keydown', spaceHandler)
    spaceHandler = null
  }
  boundEngine = null
}

/** Update the step counter display. */
export function updateTourProgress(index: number, total: number): void {
  const el = document.getElementById('tour-step-counter')
  if (el) el.textContent = `${index + 1} / ${total}`
  // Also update play/pause button state
  if (boundEngine) updatePlayPauseBtn(boundEngine.state === 'playing')
}

function updatePlayPauseBtn(isPlaying: boolean): void {
  const btn = document.getElementById('tour-play-btn')
  if (!btn) return
  btn.innerHTML = isPlaying ? '&#x23F8;&#xFE0E;' : '&#x25B6;&#xFE0E;'
  btn.setAttribute('aria-label', isPlaying ? 'Pause tour' : 'Play tour')
  btn.title = isPlaying ? 'Pause tour' : 'Play tour'
}

function onPrev(): void {
  boundEngine?.prev()
}

function onNext(): void {
  if (boundEngine) {
    boundEngine.next()
    if (boundEngine.state === 'paused') {
      void boundEngine.play()
    }
  }
}

function onPlayPause(): void {
  if (!boundEngine) return
  if (boundEngine.state === 'playing') {
    boundEngine.pause()
  } else {
    void boundEngine.play()
  }
  updatePlayPauseBtn(boundEngine.state === 'playing')
}

function onStop(): void {
  boundEngine?.stop()
}
