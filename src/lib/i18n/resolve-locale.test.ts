import { describe, it, expect } from 'vitest'
import { resolveHouseholdLocale, resolveLocale } from './resolve-locale'

describe('resolveLocale', () => {
  it('returns household locale when signed-in user has household', () => {
    expect(resolveLocale({ householdLocale: 'et', acceptLanguage: 'en' })).toBe('et')
  })

  it('falls through to Accept-Language when household locale is missing', () => {
    expect(resolveLocale({ householdLocale: null, acceptLanguage: 'et,en;q=0.9' })).toBe('et')
  })

  it('falls back to default (en), not Accept-Language, when household locale is unknown', () => {
    // A locale rolled back out of KNOWN_LOCALES: chrome must agree with the
    // content and AI paths, which have no header to read (HON-921).
    expect(resolveLocale({ householdLocale: 'fr', acceptLanguage: 'et' })).toBe('en')
    expect(resolveLocale({ householdLocale: '', acceptLanguage: 'et' })).toBe('en')
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

describe('resolveHouseholdLocale', () => {
  it('returns a known household locale', () => {
    expect(resolveHouseholdLocale({ locale: 'et' })).toBe('et')
    expect(resolveHouseholdLocale({ locale: 'en' })).toBe('en')
  })

  it('returns the default for a locale outside KNOWN_LOCALES', () => {
    expect(resolveHouseholdLocale({ locale: 'xx' })).toBe('en')
    expect(resolveHouseholdLocale({ locale: 'ET' })).toBe('en')
  })

  it('returns the default when there is no household or no locale', () => {
    expect(resolveHouseholdLocale(null)).toBe('en')
    expect(resolveHouseholdLocale(undefined)).toBe('en')
    expect(resolveHouseholdLocale({ locale: null })).toBe('en')
    expect(resolveHouseholdLocale({ locale: '' })).toBe('en')
  })
})
