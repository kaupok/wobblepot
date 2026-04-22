import { describe, it, expect } from 'vitest'
import { resolveLocale } from './resolve-locale'

describe('resolveLocale', () => {
  it('returns household locale when signed-in user has household', () => {
    expect(resolveLocale({ householdLocale: 'et', acceptLanguage: 'en' })).toBe('et')
  })

  it('falls through to Accept-Language when household locale is missing', () => {
    expect(resolveLocale({ householdLocale: null, acceptLanguage: 'et,en;q=0.9' })).toBe('et')
  })

  it('falls through to Accept-Language when household locale is unknown', () => {
    expect(resolveLocale({ householdLocale: 'fr', acceptLanguage: 'et' })).toBe('et')
  })

  it('falls back to default (en) when nothing matches', () => {
    expect(resolveLocale({ householdLocale: null, acceptLanguage: 'fr,de' })).toBe('en')
  })

  it('falls back to default (en) when both inputs are missing', () => {
    expect(resolveLocale({})).toBe('en')
  })

  it('respects quality ordering in Accept-Language', () => {
    expect(resolveLocale({ householdLocale: null, acceptLanguage: 'en;q=0.5,et;q=0.9' })).toBe('et')
  })

  it('matches Accept-Language primary subtag', () => {
    expect(resolveLocale({ householdLocale: null, acceptLanguage: 'en-US' })).toBe('en')
  })
})
