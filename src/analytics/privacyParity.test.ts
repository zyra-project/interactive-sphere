/**
 * Drift detection: docs/PRIVACY.md is the canonical source of the
 * privacy policy text; public/privacy.html is the ship artifact. The
 * implementation PR is responsible for keeping them in sync. This
 * test fails if a section heading present in the markdown does not
 * appear in the served HTML — a pragmatic fuzzy check, not a strict
 * equality assertion. Edits to copy that don't change a heading
 * still need a manual cross-check, but the structural bones must
 * match.
 *
 * Reads both files from disk at test time. No build step required.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..')
const MD_PATH = resolve(REPO_ROOT, 'docs', 'PRIVACY.md')
const HTML_PATH = resolve(REPO_ROOT, 'public', 'privacy.html')

/** Strip HTML tags and decode the small set of entities we use in
 * privacy.html so heading text in the rendered page matches the
 * raw markdown headings. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&hellip;/g, '…')
    .replace(/&times;/g, '×')
    .replace(/&#x2715;/g, '✕')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Collapse whitespace and normalize punctuation so "1. Who runs
 * this" matches across markdown source and rendered HTML. Curly /
 * straight apostrophe variants are folded to a single ASCII form
 * because authors flip between them without intent. */
function normalize(text: string): string {
  return text
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Pull every `## ` and `### ` heading out of the markdown — these
 * are the section anchors we want to guarantee survive the render. */
function extractMarkdownHeadings(md: string): string[] {
  const headings: string[] = []
  for (const line of md.split('\n')) {
    const match = line.match(/^#{2,3}\s+(.+?)\s*$/)
    if (match) headings.push(match[1])
  }
  return headings
}

describe('privacy policy parity — docs/PRIVACY.md ↔ public/privacy.html', () => {
  const md = readFileSync(MD_PATH, 'utf-8')
  const html = readFileSync(HTML_PATH, 'utf-8')
  const htmlText = normalize(stripHtml(html))
  const mdHeadings = extractMarkdownHeadings(md)

  it('parses a non-trivial set of headings from the markdown', () => {
    expect(mdHeadings.length).toBeGreaterThanOrEqual(12)
  })

  it.each(mdHeadings)('HTML contains heading: %s', (heading) => {
    const needle = normalize(heading)
    expect(htmlText).toContain(needle)
  })

  it('HTML page is self-contained — no <script> tags', () => {
    expect(html).not.toMatch(/<script\b/i)
  })

  it('HTML page declares a Content-Security-Policy meta tag', () => {
    expect(html).toMatch(
      /<meta[^>]+http-equiv=["']Content-Security-Policy["']/i,
    )
  })

  it('HTML page sets lang="en" and includes a skip-link', () => {
    expect(html).toMatch(/<html[^>]+lang=["']en["']/i)
    expect(html).toMatch(/class=["']skip-link["']/)
  })

  it('HTML page references the canonical "Last updated" line', () => {
    expect(html.toLowerCase()).toContain('last updated')
  })
})
