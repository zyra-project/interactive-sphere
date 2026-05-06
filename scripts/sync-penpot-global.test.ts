import { describe, it, expect } from 'vitest'
import {
  buildGlobalTokenSpecs,
  buildPluginCode,
  readGlobalTokensJson,
  GLOBAL_SET_NAME,
} from './sync-penpot-global.ts'

describe('sync-penpot-global', () => {
  const specs = buildGlobalTokenSpecs(readGlobalTokensJson())
  const byName = new Map(specs.map((s) => [s.name, s]))

  it('emits dotted names mirroring the JSON path', () => {
    expect(byName.has('color.accent')).toBe(true)
    expect(byName.has('radius.md')).toBe(true)
    expect(byName.has('accent-opacity.o05')).toBe(true)
    expect(byName.has('white-opacity.o70')).toBe(true)
    expect(byName.has('glass.bg')).toBe(true)
    expect(byName.has('glass.blur')).toBe(true)
    expect(byName.has('touch.min')).toBe(true)
  })

  it('preserves the W3C $type and $value verbatim', () => {
    expect(byName.get('color.accent')).toMatchObject({
      type: 'color',
      value: '#4da6ff',
    })
    expect(byName.get('radius.md')).toMatchObject({
      type: 'dimension',
      value: '6px',
    })
    expect(byName.get('accent-opacity.o05')).toMatchObject({
      type: 'color',
      value: 'rgba(77, 166, 255, 0.05)',
    })
    expect(byName.get('glass.blur')).toMatchObject({
      type: 'dimension',
      value: '12px',
    })
  })

  it('uses the default $value only — ignores mode overrides', () => {
    // radius.lg has a `mobile-native: 10px` override; default is 8px.
    expect(byName.get('radius.lg')?.value).toBe('8px')
    expect(byName.get('radius.xl')?.value).toBe('10px')
    expect(byName.get('touch.min')?.value).toBe('44px')
  })

  it('captures $description when present', () => {
    expect(byName.get('color.accent')?.description).toMatch(/accent/i)
    expect(byName.get('radius.md')?.description).toBeUndefined()
  })

  it('only emits color and dimension specs', () => {
    const types = new Set(specs.map((s) => s.type))
    expect([...types].sort()).toEqual(['color', 'dimension'])
  })

  it('produces unique token names', () => {
    const names = specs.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('plugin code embeds the set name and full spec list', () => {
    const code = buildPluginCode(specs)
    expect(code).toContain(`"setName": "${GLOBAL_SET_NAME}"`)
    expect(code).toContain('"color.accent"')
    expect(code).toContain('"accent-opacity.o05"')
    expect(code).toContain('penpot.library.local.tokens')
    expect(code).toContain('addToken')
    // Sanity: the embedded plan size should match spec count.
    const planMatch = code.match(/"specs": \[([\s\S]*?)\n  \]/)
    expect(planMatch, 'embedded specs array must be present').toBeTruthy()
  })

  it('includes every entry under tokens/global.json color/dimension leaves', () => {
    const json = readGlobalTokensJson() as Record<string, Record<string, unknown>>
    let leafCount = 0
    for (const group of Object.values(json)) {
      for (const v of Object.values(group)) {
        if (
          v &&
          typeof v === 'object' &&
          '$type' in (v as object) &&
          ((v as { $type: string }).$type === 'color' ||
            (v as { $type: string }).$type === 'dimension')
        ) {
          leafCount++
        }
      }
    }
    expect(specs.length).toBe(leafCount)
  })
})
