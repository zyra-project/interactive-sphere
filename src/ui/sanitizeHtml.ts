/**
 * Allowlist-based HTML sanitizer for translator-supplied content.
 *
 * Used for the help-guide section blobs (`help.guide.section.*`) —
 * these locale strings ship inline HTML for emphasis, lists, and
 * keyboard-shortcut markers, and translators may edit them via
 * Weblate (untrusted input). Without sanitization, a translation
 * containing `<img onerror=...>` or `<script>` would execute when
 * the panel opens.
 *
 * Defense in depth pairs with `forbiddenPatterns()` in
 * `scripts/generate-locales.ts`, which fails CI if a locale string
 * carries an obviously hostile substring (script tags, event
 * handlers, javascript: URLs). The codegen catches accidents at
 * build time; this sanitizer catches anything that slipped past
 * (or that lands in a runtime-fetched override later).
 *
 * The allowlist is intentionally small — exactly the tags + attrs
 * the help guide actually uses. Anything outside the allowlist is
 * unwrapped (text content kept, tag dropped) so a typo in one
 * tag doesn't blank the whole section. `href` values are
 * additionally restricted to safe schemes.
 */

const ALLOWED_TAGS = new Set([
  'SECTION', 'H3', 'H4', 'P', 'UL', 'OL', 'LI',
  'STRONG', 'EM', 'KBD', 'CODE', 'A', 'BR', 'SPAN',
])

const ALLOWED_ATTRS_BY_TAG: Readonly<Record<string, ReadonlyArray<string>>> = {
  A: ['href', 'target', 'rel'],
}

/** href schemes we'll accept on `<a>`: http(s), mailto, and same-origin
 *  relative paths. `javascript:`, `data:`, `vbscript:`, etc. fall
 *  through to attribute removal. */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i

/**
 * Sanitize a translator-supplied HTML blob against the allowlist
 * above. Output is safe to set as `innerHTML`. Idempotent.
 *
 * Implementation note: parses via `<template>.innerHTML` rather
 * than `DOMParser` — `<template>` is the
 * <https://developer.mozilla.org/docs/Web/HTML/Element/template>
 * inert-fragment idiom and avoids resource fetches (no `<img src>`
 * load, no script execution) during parsing. The walker then
 * mutates the fragment in place before we read its
 * `innerHTML` back out.
 */
export function sanitizeGuideHtml(html: string): string {
  if (typeof document === 'undefined') return ''
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  walkAndSanitize(tpl.content)
  return tpl.innerHTML
}

function walkAndSanitize(node: ParentNode): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1 /* ELEMENT_NODE */) continue
    const el = child as Element
    const tag = el.tagName

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap rather than delete — preserves visible text so a
      // translator typo doesn't blank a paragraph.
      const text = document.createTextNode(el.textContent ?? '')
      el.replaceWith(text)
      continue
    }

    const allowed = ALLOWED_ATTRS_BY_TAG[tag] ?? []
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (!allowed.includes(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'href' && !SAFE_HREF.test(attr.value.trim())) {
        el.removeAttribute(attr.name)
      }
    }

    walkAndSanitize(el)
  }
}
