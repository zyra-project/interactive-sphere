import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { scanFile } from './check-i18n-strings'

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'terraviz-i18n-strings-'))
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, name)
  writeFileSync(path, contents, 'utf-8')
  return path
}

describe('check-i18n-strings · scanFile', () => {
  it('flags a hard-coded textContent assignment', () => {
    const path = tmpFile(
      'a.ts',
      `el.textContent = 'Submit form'\n`,
    )
    const violations = scanFile(path)
    expect(violations.length).toBe(1)
    expect(violations[0]?.literal).toBe('Submit form')
    expect(violations[0]?.line).toBe(1)
  })

  it('flags placeholder, title, alt, innerText assignments', () => {
    const path = tmpFile(
      'b.ts',
      [
        `el.placeholder = 'Search datasets'`,
        `el.title = 'Open settings'`,
        `el.alt = 'Globe icon'`,
        `el.innerText = 'Loading data'`,
      ].join('\n') + '\n',
    )
    const violations = scanFile(path)
    expect(violations.length).toBe(4)
  })

  it('flags setAttribute(aria-label, …) with English prose', () => {
    const path = tmpFile(
      'c.ts',
      `el.setAttribute('aria-label', 'Close dialog')\n`,
    )
    const violations = scanFile(path)
    expect(violations.length).toBe(1)
    expect(violations[0]?.literal).toBe('Close dialog')
  })

  it('respects an inline `i18n-exempt:` comment', () => {
    const path = tmpFile(
      'd.ts',
      `el.textContent = 'FPS metric' // i18n-exempt: debug HUD\n`,
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })

  it('skips literals routed through t()', () => {
    const path = tmpFile(
      'e.ts',
      `el.textContent = t('app.title')\n`,
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })

  it('skips template-literal assignments (interpolation handled separately)', () => {
    const path = tmpFile(
      'f.ts',
      'el.textContent = `${count} items found`\n',
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })

  it('skips HTML-bearing literals (markup-template scope deferred)', () => {
    const path = tmpFile(
      'g.ts',
      `el.innerHTML = '<div class="foo">Hello world</div>'\n`,
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })

  it('skips literals that are only locale-key-shaped', () => {
    const path = tmpFile(
      'h.ts',
      `el.textContent = 'app.title'\n`,
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })

  it('skips literals that have no spaces', () => {
    const path = tmpFile(
      'i.ts',
      `el.placeholder = 'searchPlaceholder'\n`,
    )
    const violations = scanFile(path)
    expect(violations).toEqual([])
  })
})
