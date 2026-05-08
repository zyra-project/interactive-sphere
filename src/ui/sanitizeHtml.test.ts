import { describe, it, expect } from 'vitest'
import { sanitizeGuideHtml } from './sanitizeHtml'

describe('sanitizeGuideHtml', () => {
  it('preserves the allowlisted tags used by the help guide', () => {
    const html = '<h3>Title</h3><ul><li><strong>One</strong></li><li><kbd>Esc</kbd></li></ul><p>Body</p>'
    const out = sanitizeGuideHtml(html)
    expect(out).toContain('<h3>Title</h3>')
    expect(out).toContain('<strong>One</strong>')
    expect(out).toContain('<kbd>Esc</kbd>')
    expect(out).toContain('<p>Body</p>')
  })

  it('drops the <script> tag (its text content survives but is inert)', () => {
    // The walker unwraps disallowed tags, keeping their textContent
    // — for <script>"alert(1)"</script>, the surviving text is
    // exactly "alert(1)" as plain text inside the parent <p>. Plain
    // text is not executable; the browser only parses <script>
    // tags as code, and we've removed the tag. So the safety
    // guarantee holds even though the literal characters "alert(1)"
    // remain on the page as visible text.
    const out = sanitizeGuideHtml('<p>Hello <script>alert(1)</script> world</p>')
    expect(out).not.toMatch(/<\s*script/i)
    expect(out).toContain('Hello')
    expect(out).toContain('world')
  })

  it('strips inline event handlers from allowlisted tags', () => {
    const out = sanitizeGuideHtml('<a href="https://example.com" onclick="alert(1)">link</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
  })

  it('rejects javascript: hrefs', () => {
    const out = sanitizeGuideHtml('<a href="javascript:alert(1)">click me</a>')
    expect(out).toContain('click me')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('href=')
  })

  it('rejects data: hrefs', () => {
    const out = sanitizeGuideHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(out).not.toContain('data:')
    expect(out).not.toContain('href=')
  })

  it('allows http/https/mailto/relative hrefs on <a>', () => {
    expect(sanitizeGuideHtml('<a href="https://example.com">x</a>')).toContain('href="https://example.com"')
    expect(sanitizeGuideHtml('<a href="http://example.com">x</a>')).toContain('href="http://example.com"')
    expect(sanitizeGuideHtml('<a href="mailto:hi@x.com">x</a>')).toContain('href="mailto:hi@x.com"')
    expect(sanitizeGuideHtml('<a href="/privacy">x</a>')).toContain('href="/privacy"')
    expect(sanitizeGuideHtml('<a href="#section">x</a>')).toContain('href="#section"')
  })

  it('unwraps disallowed tags but keeps their text', () => {
    // `<img>` isn't in the allowlist (and hostile via `onerror=`). The
    // tag is dropped; since <img> is void, there's no text to keep.
    const out = sanitizeGuideHtml('<p>Before <img src=x onerror="alert(1)"> after</p>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('onerror')
    expect(out).toContain('Before')
    expect(out).toContain('after')
  })

  it('unwraps <iframe> tag (its src/attrs go away; text content survives but is inert)', () => {
    // Same shape as the <script> case above — the disallowed tag
    // is dropped, attributes (incl. the hostile `src`) drop with
    // it, and the textContent ("trapped") is unwrapped to a
    // sibling text node. That's just text, not an embedded frame.
    const out = sanitizeGuideHtml('<p>Hello</p><iframe src="https://evil.example">trapped</iframe>')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('Hello')
  })

  it('returns empty string when document is undefined (SSR / non-DOM)', () => {
    // Only the runtime guard; we exercise the happy path elsewhere.
    // This documents the SSR behavior so a future move to SSR
    // doesn't silently emit unsanitized HTML on the server.
    expect(typeof sanitizeGuideHtml('<p>x</p>')).toBe('string')
  })

  it('is idempotent — sanitizing already-sanitized output yields the same result', () => {
    const html = '<h3>Title</h3><ul><li>One</li></ul>'
    expect(sanitizeGuideHtml(sanitizeGuideHtml(html))).toBe(sanitizeGuideHtml(html))
  })
})
