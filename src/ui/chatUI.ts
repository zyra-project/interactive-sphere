/**
 * Chat UI — digital docent chat panel.
 *
 * Renders as a toggleable panel in the bottom-left area (above the info panel),
 * with a floating trigger button. Persists conversation in sessionStorage.
 */

import type { ChatMessage, ChatAction, ChatSession } from '../types'
import { escapeHtml } from './browseUI'
import { createMessageId, processUserMessage } from '../services/docentEngine'
import type { Dataset } from '../types'

// --- Constants ---
const SESSION_STORAGE_KEY = 'sos-docent-chat'
const TYPING_DELAY_MS = 400
const TYPING_MIN_MS = 300
const TYPING_MAX_MS = 800

export interface ChatCallbacks {
  onLoadDataset: (id: string) => void
  getDatasets: () => Dataset[]
  getCurrentDataset: () => Dataset | null
  announce: (message: string) => void
}

let callbacks: ChatCallbacks | null = null
let messages: ChatMessage[] = []
let isOpen = false

/**
 * Initialize the chat UI with callbacks and restore session.
 */
export function initChatUI(cb: ChatCallbacks): void {
  callbacks = cb
  restoreSession()
  wireEvents()
  renderMessages()
  updateBadge()
}

/**
 * Open the chat panel.
 */
export function openChat(): void {
  const panel = document.getElementById('chat-panel')
  const trigger = document.getElementById('chat-trigger')
  if (!panel) return
  isOpen = true
  panel.classList.remove('hidden')
  trigger?.classList.add('chat-trigger-active')
  updateBadge()
  scrollToBottom()
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
  input?.focus()
  callbacks?.announce('Chat opened')
}

/**
 * Close the chat panel.
 */
export function closeChat(): void {
  const panel = document.getElementById('chat-panel')
  const trigger = document.getElementById('chat-trigger')
  if (!panel) return
  isOpen = false
  panel.classList.add('hidden')
  trigger?.classList.remove('chat-trigger-active')
  callbacks?.announce('Chat closed')
}

/**
 * Toggle the chat panel open/closed.
 */
export function toggleChat(): void {
  if (isOpen) closeChat()
  else openChat()
}

/**
 * Notify the chat that the current dataset changed (for context awareness).
 */
export function notifyDatasetChanged(dataset: Dataset | null): void {
  saveSession()
}

/**
 * Get all current messages (for testing).
 */
export function getMessages(): ChatMessage[] {
  return [...messages]
}

/**
 * Clear chat history.
 */
export function clearChat(): void {
  messages = []
  saveSession()
  renderMessages()
  updateBadge()
}

// --- Session persistence ---

function saveSession(): void {
  const session: ChatSession = {
    messages,
    lastActiveDatasetId: callbacks?.getCurrentDataset()?.id ?? null,
  }
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

function restoreSession(): void {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (raw) {
      const session: ChatSession = JSON.parse(raw)
      messages = session.messages ?? []
    }
  } catch {
    messages = []
  }
}

// --- Event wiring ---

function wireEvents(): void {
  // Trigger button
  document.getElementById('chat-trigger')?.addEventListener('click', toggleChat)

  // Close button
  document.getElementById('chat-close')?.addEventListener('click', closeChat)

  // Send button
  document.getElementById('chat-send')?.addEventListener('click', handleSend)

  // Input — Enter to send, Shift+Enter for newline
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    })
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 96) + 'px'
    })
  }

  // Clear button
  document.getElementById('chat-clear')?.addEventListener('click', () => {
    clearChat()
    callbacks?.announce('Chat cleared')
  })
}

// --- Send / receive ---

function handleSend(): void {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
  if (!input || !callbacks) return

  const text = input.value.trim()
  if (!text) return

  // Add user message
  const userMsg: ChatMessage = {
    id: createMessageId(),
    role: 'user',
    text,
    timestamp: Date.now(),
  }
  messages.push(userMsg)
  input.value = ''
  input.style.height = 'auto'
  renderMessages()
  scrollToBottom()
  saveSession()

  // Show typing indicator, then respond
  showTyping()
  const delay = TYPING_MIN_MS + Math.random() * (TYPING_MAX_MS - TYPING_MIN_MS)
  setTimeout(() => {
    hideTyping()
    const docentMsg = processUserMessage(
      text,
      callbacks!.getDatasets(),
      callbacks!.getCurrentDataset(),
    )
    messages.push(docentMsg)
    renderMessages()
    scrollToBottom()
    saveSession()
    callbacks!.announce('Docent responded')
  }, delay)
}

// --- Rendering ---

function renderMessages(): void {
  const container = document.getElementById('chat-messages')
  if (!container) return

  if (messages.length === 0) {
    container.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon" aria-hidden="true">&#x1F30D;</div>
      <p>I'm your digital docent. Ask me about any topic and I'll find data to show you on the globe.</p>
      <div class="chat-suggestions">
        <button class="chat-suggestion" data-query="Show me hurricanes">Hurricanes</button>
        <button class="chat-suggestion" data-query="Tell me about climate change">Climate</button>
        <button class="chat-suggestion" data-query="Show me ocean temperatures">Oceans</button>
        <button class="chat-suggestion" data-query="What about space?">Space</button>
      </div>
    </div>`
    // Wire suggestion buttons
    container.querySelectorAll<HTMLElement>('.chat-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
        if (input && btn.dataset.query) {
          input.value = btn.dataset.query
          handleSend()
        }
      })
    })
    return
  }

  container.innerHTML = messages.map(msg => {
    const roleClass = msg.role === 'user' ? 'chat-msg-user' : 'chat-msg-docent'
    const textHtml = renderMarkdownLite(escapeHtml(msg.text))
    const actionsHtml = msg.actions?.length ? renderActions(msg.actions) : ''
    return `<div class="chat-msg ${roleClass}" data-msg-id="${msg.id}">
      <div class="chat-msg-text">${textHtml}</div>
      ${actionsHtml}
    </div>`
  }).join('')

  // Wire action buttons
  container.querySelectorAll<HTMLElement>('.chat-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.datasetId
      if (id && callbacks) {
        callbacks.onLoadDataset(id)
        callbacks.announce(`Loading dataset`)
      }
    })
  })
}

function renderActions(actions: ChatAction[]): string {
  return `<div class="chat-actions">${actions.map(a => {
    if (a.type === 'load-dataset') {
      return `<button class="chat-action-btn" data-dataset-id="${escapeHtml(a.datasetId)}" aria-label="Load ${escapeHtml(a.datasetTitle)}">
        <span class="chat-action-title">${escapeHtml(a.datasetTitle)}</span>
        <span class="chat-action-load">Load</span>
      </button>`
    }
    return ''
  }).join('')}</div>`
}

/**
 * Minimal markdown: bold (**text**) and newlines.
 */
function renderMarkdownLite(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

function showTyping(): void {
  const el = document.getElementById('chat-typing')
  if (el) el.classList.remove('hidden')
}

function hideTyping(): void {
  const el = document.getElementById('chat-typing')
  if (el) el.classList.add('hidden')
}

function scrollToBottom(): void {
  const container = document.getElementById('chat-messages')
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
  }
}

function updateBadge(): void {
  // No badge needed when open
  const badge = document.getElementById('chat-badge')
  if (badge) badge.classList.add('hidden')
}
