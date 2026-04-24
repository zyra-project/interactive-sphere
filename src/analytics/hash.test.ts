import { describe, it, expect } from 'vitest'
import { hashQuery } from './hash'

describe('hashQuery', () => {
  it('returns 12 hex characters', async () => {
    const h = await hashQuery('hurricane')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
  })

  it('is deterministic — same input → same output', async () => {
    const a = await hashQuery('hurricane')
    const b = await hashQuery('hurricane')
    expect(a).toBe(b)
  })

  it('normalizes case + surrounding whitespace', async () => {
    const a = await hashQuery('Hurricane')
    const b = await hashQuery('hurricane ')
    const c = await hashQuery('  HURRICANE  ')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('does not normalize internal whitespace', async () => {
    const a = await hashQuery('sea ice')
    const b = await hashQuery('seaice')
    expect(a).not.toBe(b)
  })

  it('distinguishes different queries', async () => {
    const a = await hashQuery('hurricane')
    const b = await hashQuery('tornado')
    expect(a).not.toBe(b)
  })

  it('empty string still returns 12 hex chars', async () => {
    const h = await hashQuery('')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
  })
})
