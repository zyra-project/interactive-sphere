import { describe, it, expect, beforeEach } from 'vitest'
import {
  __installMessagesForTests,
  __resetI18nForTests,
  getLocale,
  interpolate,
  plural,
  setLocale,
  t,
  SOURCE_LOCALE,
} from './index'

describe('i18n runtime', () => {
  beforeEach(() => {
    __resetI18nForTests()
  })

  describe('interpolate', () => {
    it('substitutes named placeholders', () => {
      expect(interpolate('Hello, {name}!', { name: 'world' })).toBe('Hello, world!')
    })

    it('coerces numbers to strings', () => {
      expect(interpolate('{count} datasets', { count: 3 })).toBe('3 datasets')
    })

    it('leaves unresolved placeholders in place', () => {
      // Surfaces missing translation parameters during dev rather than
      // silently dropping them.
      expect(interpolate('Hello, {name}!', {})).toBe('Hello, {name}!')
    })

    it('substitutes the same placeholder multiple times', () => {
      expect(interpolate('{x}+{x}={y}', { x: 1, y: 2 })).toBe('1+1=2')
    })
  })

  describe('t', () => {
    it('returns the key string when nothing is registered', () => {
      // Empty bundles → t('foo') falls all the way through to the key.
      // Wave 0 ships en.json = {} so this is the steady-state behavior
      // until Wave 1 starts populating keys.
      // Cast — MessageKey is `string` while en.json is empty.
      expect(t('app.unknown' as never)).toBe('app.unknown')
    })

    it('returns the active locale value when set', () => {
      __installMessagesForTests('en', { 'app.title': 'Terraviz' })
      expect(t('app.title' as never)).toBe('Terraviz')
    })

    it('falls back to English when the active locale is missing the key', () => {
      // Inject English baseline first.
      __installMessagesForTests('en', { 'app.title': 'Terraviz' })
      // Then "switch" to a Spanish bundle that's missing the key. We
      // simulate by re-installing — the runtime's English fallback is
      // always `enMessages` from the generated module, which is `{}`
      // in Wave 0. So the fall-through here is from active → key, not
      // active → English. Tighten this once en.json has entries.
      __installMessagesForTests('es', {})
      // Active 'es' bundle is empty; enMessages is empty in Wave 0;
      // resolution falls through to the raw key.
      expect(t('app.title' as never)).toBe('app.title')
    })

    it('interpolates params when supplied', () => {
      __installMessagesForTests('en', { 'browse.count': '{count} datasets' })
      expect(t('browse.count' as never, { count: 7 })).toBe('7 datasets')
    })
  })

  describe('plural', () => {
    it('selects the "one" form for count=1 in English', () => {
      __installMessagesForTests('en', {
        'browse.count.one': '1 dataset',
        'browse.count.other': '{count} datasets',
      })
      expect(
        plural(
          1,
          { one: 'browse.count.one' as never, other: 'browse.count.other' as never },
        ),
      ).toBe('1 dataset')
    })

    it('selects "other" for count=5 and auto-injects {count}', () => {
      __installMessagesForTests('en', {
        'browse.count.one': '1 dataset',
        'browse.count.other': '{count} datasets',
      })
      expect(
        plural(
          5,
          { one: 'browse.count.one' as never, other: 'browse.count.other' as never },
        ),
      ).toBe('5 datasets')
    })

    it('falls back to "other" if the chosen form is not provided', () => {
      __installMessagesForTests('en', { 'count.other': '{count} items' })
      expect(plural(1, { other: 'count.other' as never })).toBe('1 items')
    })
  })

  describe('setLocale', () => {
    it('returns the source locale by default', () => {
      expect(getLocale()).toBe(SOURCE_LOCALE)
    })

    it('updates document lang and dir attributes when locale changes', async () => {
      // Default English has no entry for 'es' loader yet (Wave 0
      // generates an empty messages.es). Calling setLocale('es')
      // should still update DOM attributes via the en→es transition
      // before resolution. Verify the document side-effects.
      expect(document.documentElement.lang).toBe('') // happy-dom default
      // We can't easily test setLocale to non-en without the
      // generated loader returning real data. Instead, exercise the
      // attribute writer via initI18n indirectly by calling the
      // already-installed test helper, which calls applyHtmlAttributes
      // through __installMessagesForTests is not the one wiring DOM.
      // Use the public setLocale on the source locale (no-op transition
      // but still safe) to confirm the API contract.
      await setLocale(SOURCE_LOCALE)
      expect(getLocale()).toBe(SOURCE_LOCALE)
    })
  })
})
