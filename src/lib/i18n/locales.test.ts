import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  KNOWN_LOCALES,
  LocaleSchema,
  isDefaultLocale,
  isKnownLocale,
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
})
