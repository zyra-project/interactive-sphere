import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  build,
  diffAgainstSource,
  LocaleBuildError,
  renderEntryModule,
  renderLocaleModule,
  validateLocale,
} from './generate-locales'

function tmpLocalesDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'terraviz-locales-'))
  mkdirSync(dir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    const value =
      typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2)
    writeFileSync(resolve(dir, name), value, 'utf-8')
  }
  return dir
}

describe('validateLocale', () => {
  it('accepts a flat object of string keys matching the regex', () => {
    expect(() =>
      validateLocale('en', { 'app.title': 'Terraviz', 'browse.search.placeholder': 'Search…' }),
    ).not.toThrow()
  })

  it('rejects arrays', () => {
    expect(() => validateLocale('en', ['nope'])).toThrow(LocaleBuildError)
  })

  it('rejects non-string values', () => {
    expect(() => validateLocale('en', { 'app.title': 42 })).toThrow(/must be a string/)
  })

  it('rejects keys that fail the regex', () => {
    expect(() => validateLocale('en', { 'App.Title': 'x' })).toThrow(/violates/)
    expect(() => validateLocale('en', { '0bad': 'x' })).toThrow(/violates/)
    expect(() => validateLocale('en', { 'has space': 'x' })).toThrow(/violates/)
  })

  it('accepts an empty object', () => {
    expect(() => validateLocale('en', {})).not.toThrow()
  })

  it('rejects values that contain script-class HTML', () => {
    // Translator input flows into innerHTML in a few places (notably
    // help-guide section blobs). The runtime sanitizer in
    // src/ui/sanitizeHtml.ts is the primary defense; the codegen
    // tripwire below catches the obvious classes at build time so
    // hostile substrings can't ship at all.
    expect(() => validateLocale('en', { 'help.foo': '<script>x</script>' })).toThrow(/forbidden/)
    expect(() => validateLocale('en', { 'help.foo': '<iframe src=x>' })).toThrow(/forbidden/)
    expect(() => validateLocale('en', { 'help.foo': '<a onclick="alert(1)">x</a>' })).toThrow(/forbidden/)
    expect(() => validateLocale('en', { 'help.foo': 'click <a href="javascript:1">here</a>' })).toThrow(/forbidden/)
    expect(() => validateLocale('en', { 'help.foo': '<a href="data:text/html,foo">x</a>' })).toThrow(/forbidden/)
  })

  it('keeps benign HTML intact (the help-guide blobs use it)', () => {
    expect(() => validateLocale('en', {
      'help.guide.section.x': '<h3>Title</h3><ul><li><strong>Bold</strong></li></ul>',
    })).not.toThrow()
    expect(() => validateLocale('en', {
      'help.foo': 'Press <kbd>Esc</kbd> to close',
    })).not.toThrow()
    expect(() => validateLocale('en', {
      'help.foo': 'See <a href="/privacy" target="_blank">policy</a>',
    })).not.toThrow()
  })
})

describe('diffAgainstSource', () => {
  it('reports missing-in-target as warnings', () => {
    const { warnings, errors } = diffAgainstSource(
      'es',
      { 'app.title': 'Terraviz', 'browse.search': 'Search' },
      { 'app.title': 'Terraviz' },
    )
    expect(warnings).toEqual([
      '[locales] es.json: missing translation for "browse.search"',
    ])
    expect(errors).toEqual([])
  })

  it('reports orphan keys as errors', () => {
    const { warnings, errors } = diffAgainstSource(
      'es',
      { 'app.title': 'Terraviz' },
      { 'app.title': 'Terraviz', 'orphan.key': 'oops' },
    )
    expect(warnings).toEqual([])
    expect(errors[0]).toMatch(/orphan key "orphan\.key"/)
  })

  it('returns clean output when keys match', () => {
    const { warnings, errors } = diffAgainstSource(
      'es',
      { 'app.title': 'Terraviz' },
      { 'app.title': 'Terraviz' },
    )
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
  })
})

describe('renderEntryModule', () => {
  it('emits deterministic output with sorted locales and sorted entries', () => {
    const a = renderEntryModule(['es', 'en'], { 'b.key': 'B', 'a.key': 'A' })
    const b = renderEntryModule(['en', 'es'], { 'a.key': 'A', 'b.key': 'B' })
    expect(a).toEqual(b)
    expect(a).toContain('"a.key": "A"')
    expect(a.indexOf('"a.key"')).toBeLessThan(a.indexOf('"b.key"'))
  })

  it('includes the lazy import line for non-source locales', () => {
    const out = renderEntryModule(['en', 'es'], {})
    expect(out).toMatch(/import\(['"]\.\/messages\.es['"]\)/)
    expect(out).toMatch(/async \(\) => enMessages/) // English is sync
  })

  it('emits MessageKey conditional that widens to string when source is empty', () => {
    const out = renderEntryModule(['en'], {})
    expect(out).toMatch(/keyof typeof enLiteral extends never/)
    expect(out).toMatch(/\? string/)
  })

  it('produces compilable TS shape (smoke check via simple regex)', () => {
    const out = renderEntryModule(['en', 'es'], { 'app.title': 'Terraviz' })
    expect(out).toContain('export type Locale = "en" | "es"')
    expect(out).toContain('export const SOURCE_LOCALE: Locale = "en"')
    expect(out).toContain('export const enMessages')
  })
})

describe('renderLocaleModule', () => {
  it('emits a default-export const object frozen via `as const`', () => {
    const out = renderLocaleModule('es', { 'app.title': 'Terraviz' })
    expect(out).toContain('export default messages')
    expect(out).toContain('as const')
    expect(out).toContain('"app.title": "Terraviz"')
  })

  it('is deterministic across input ordering', () => {
    const a = renderLocaleModule('es', { 'b.key': 'B', 'a.key': 'A' })
    const b = renderLocaleModule('es', { 'a.key': 'A', 'b.key': 'B' })
    expect(a).toEqual(b)
  })
})

describe('build', () => {
  it('renders entry + non-source locale files', () => {
    const dir = tmpLocalesDir({
      'en.json': { 'app.title': 'Terraviz' },
      'es.json': { 'app.title': 'Terraviz' },
    })
    const out = build(dir)
    expect(out.files.map((f) => f.path.split('/').pop())).toEqual([
      'messages.ts',
      'messages.es.ts',
    ])
    expect(out.warnings).toEqual([])
  })

  it('warns on missing-in-target keys but still renders', () => {
    const dir = tmpLocalesDir({
      'en.json': { 'app.title': 'Terraviz', 'browse.search': 'Search' },
      'es.json': { 'app.title': 'Terraviz' },
    })
    const out = build(dir)
    expect(out.warnings.length).toBeGreaterThan(0)
    expect(out.files.length).toBe(2)
  })

  it('throws on orphan key in non-source locale', () => {
    const dir = tmpLocalesDir({
      'en.json': { 'app.title': 'Terraviz' },
      'es.json': { 'orphan': 'oops' },
    })
    expect(() => build(dir)).toThrow(LocaleBuildError)
  })

  it('throws when en.json is missing', () => {
    const dir = tmpLocalesDir({
      'es.json': { 'app.title': 'Terraviz' },
    })
    expect(() => build(dir)).toThrow(/source locale/)
  })

  it('throws on invalid JSON', () => {
    const dir = tmpLocalesDir({
      'en.json': '{not json',
    })
    expect(() => build(dir)).toThrow(/invalid JSON/)
  })

  it('produces byte-identical output across runs (drift detection)', () => {
    const dir = tmpLocalesDir({
      'en.json': { 'app.title': 'Terraviz', 'browse.search': 'Search' },
      'es.json': { 'app.title': 'Terraviz' },
    })
    const a = build(dir).files.map((f) => f.contents).join('\n---\n')
    const b = build(dir).files.map((f) => f.contents).join('\n---\n')
    expect(a).toEqual(b)
  })

  it('strips allowlisted $-meta keys ($schema, $comment) before rendering', () => {
    // Editors expect a `$schema` reference at the top of each locale
    // for autocomplete; the codegen must accept it, exclude it from
    // diffing/validation, and never leak it into generated TS.
    const dir = tmpLocalesDir({
      'en.json': {
        $schema: '../src/types/locale.schema.json',
        $comment: 'wave 0 seed',
        'app.title': 'Terraviz',
      },
      'es.json': {
        $schema: '../src/types/locale.schema.json',
        'app.title': 'Terraviz',
      },
    })
    const out = build(dir)
    expect(out.warnings).toEqual([])
    expect(out.files.length).toBe(2)
    for (const f of out.files) {
      expect(f.contents).not.toContain('$schema')
      expect(f.contents).not.toContain('$comment')
    }
  })

  it('still fails on a typo like $app.title (not in the meta allowlist)', () => {
    // Guards against the obvious regression: someone broadens the
    // strip back to `startsWith('$')` and a fat-fingered key gets
    // silently dropped instead of failing CI.
    const dir = tmpLocalesDir({
      'en.json': { '$app.title': 'Terraviz' },
    })
    expect(() => build(dir)).toThrow(/violates/)
  })
})
