import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  KNOWN_LOCALES,
  LocaleSchema,
  PUBLIC_LOCALES,
  isDefaultLocale,
  isKnownLocale,
  isPublicLocale,
} from './locales'

describe('locales', () => {
  it('exposes known locales', () => {
    expect(KNOWN_LOCALES).toEqual(['en', 'et'])
  })

  it('defaults to English', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })

  describe('LocaleSchema', () => {
    it.each(KNOWN_LOCALES)('accepts known locale %s', (locale) => {
      expect(LocaleSchema.parse(locale)).toBe(locale)
    })

    it('rejects unknown locales', () => {
      expect(() => LocaleSchema.parse('fr')).toThrow()
    })

    it('rejects empty string', () => {
      expect(() => LocaleSchema.parse('')).toThrow()
    })
  })

  describe('isKnownLocale', () => {
    it('returns true for known locales', () => {
      expect(isKnownLocale('en')).toBe(true)
      expect(isKnownLocale('et')).toBe(true)
    })

    it('returns false for unknown locales', () => {
      expect(isKnownLocale('fr')).toBe(false)
      expect(isKnownLocale('')).toBe(false)
    })
  })

  describe('isDefaultLocale', () => {
    it('returns true only for the default locale', () => {
      expect(isDefaultLocale('en')).toBe(true)
      expect(isDefaultLocale('et')).toBe(false)
    })

    it('treats missing/null/undefined as default', () => {
      expect(isDefaultLocale(null)).toBe(true)
      expect(isDefaultLocale(undefined)).toBe(true)
      expect(isDefaultLocale('')).toBe(true)
    })
  })

  describe('PUBLIC_LOCALES', () => {
    it('is a subset of KNOWN_LOCALES', () => {
      for (const locale of PUBLIC_LOCALES) {
        expect(KNOWN_LOCALES).toContain(locale)
      }
    })

    it('always contains the default English locale', () => {
      expect(PUBLIC_LOCALES).toContain(DEFAULT_LOCALE)
      expect(PUBLIC_LOCALES).toContain('en')
    })

    it('contains Estonian (HON-549 — public flip)', () => {
      expect(PUBLIC_LOCALES).toContain('et')
    })
  })

  describe('isPublicLocale', () => {
    it('returns true for every public locale', () => {
      for (const locale of PUBLIC_LOCALES) {
        expect(isPublicLocale(locale)).toBe(true)
      }
    })

    it('returns false for unknown locales', () => {
      expect(isPublicLocale('fr')).toBe(false)
      expect(isPublicLocale('')).toBe(false)
    })
  })
})
