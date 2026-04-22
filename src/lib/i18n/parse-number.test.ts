import { describe, it, expect } from 'vitest'
import { parseLocalizedNumber } from './parse-number'

describe('parseLocalizedNumber', () => {
  describe('happy paths', () => {
    it('parses a dot-decimal number', () => {
      expect(parseLocalizedNumber('1.5')).toBe(1.5)
    })

    it('parses a comma-decimal number (Estonian input)', () => {
      expect(parseLocalizedNumber('1,5')).toBe(1.5)
    })

    it('parses an integer with no separator', () => {
      expect(parseLocalizedNumber('250')).toBe(250)
    })

    it('parses zero', () => {
      expect(parseLocalizedNumber('0')).toBe(0)
    })

    it('parses negative numbers', () => {
      expect(parseLocalizedNumber('-2.3')).toBe(-2.3)
      expect(parseLocalizedNumber('-2,3')).toBe(-2.3)
    })

    it('trims leading/trailing whitespace', () => {
      expect(parseLocalizedNumber('  1.5  ')).toBe(1.5)
      expect(parseLocalizedNumber('  1,5  ')).toBe(1.5)
    })
  })

  describe('regression — comma and dot produce the same value', () => {
    it('1,5 (et) === 1.5 (en)', () => {
      expect(parseLocalizedNumber('1,5')).toBe(parseLocalizedNumber('1.5'))
    })

    it('0,5 (et) === 0.5 (en)', () => {
      expect(parseLocalizedNumber('0,5')).toBe(parseLocalizedNumber('0.5'))
    })
  })

  describe('rejects invalid input', () => {
    it('returns null for empty string', () => {
      expect(parseLocalizedNumber('')).toBeNull()
    })

    it('returns null for whitespace only', () => {
      expect(parseLocalizedNumber('   ')).toBeNull()
    })

    it('returns null when both . and , are present', () => {
      expect(parseLocalizedNumber('1.5,0')).toBeNull()
      expect(parseLocalizedNumber('1,5.0')).toBeNull()
      expect(parseLocalizedNumber('1,000.5')).toBeNull()
    })

    it('returns null for multiple dots', () => {
      expect(parseLocalizedNumber('1.2.3')).toBeNull()
    })

    it('returns null for multiple commas', () => {
      expect(parseLocalizedNumber('1,2,3')).toBeNull()
    })

    it('returns null for alphabetic characters', () => {
      expect(parseLocalizedNumber('abc')).toBeNull()
      expect(parseLocalizedNumber('1.5kg')).toBeNull()
      expect(parseLocalizedNumber('kg1.5')).toBeNull()
    })

    it('returns null for scientific notation', () => {
      expect(parseLocalizedNumber('1e5')).toBeNull()
      expect(parseLocalizedNumber('1.5e2')).toBeNull()
    })

    it('returns null for trailing separator', () => {
      expect(parseLocalizedNumber('1,')).toBeNull()
      expect(parseLocalizedNumber('1.')).toBeNull()
    })

    it('returns null for leading separator', () => {
      expect(parseLocalizedNumber(',5')).toBeNull()
      expect(parseLocalizedNumber('.5')).toBeNull()
    })

    it('returns null for leading plus sign', () => {
      expect(parseLocalizedNumber('+1.5')).toBeNull()
    })

    it('returns null for hex values', () => {
      expect(parseLocalizedNumber('0xff')).toBeNull()
    })

    it('returns null for Infinity / NaN strings', () => {
      expect(parseLocalizedNumber('Infinity')).toBeNull()
      expect(parseLocalizedNumber('NaN')).toBeNull()
    })

    it('returns null for non-string input', () => {
      // @ts-expect-error — runtime guard against wrong types
      expect(parseLocalizedNumber(undefined)).toBeNull()
      // @ts-expect-error — runtime guard against wrong types
      expect(parseLocalizedNumber(null)).toBeNull()
      // @ts-expect-error — runtime guard against wrong types
      expect(parseLocalizedNumber(1.5)).toBeNull()
    })
  })

  describe('integer option', () => {
    it('accepts whole numbers', () => {
      expect(parseLocalizedNumber('4', { integer: true })).toBe(4)
      expect(parseLocalizedNumber('-10', { integer: true })).toBe(-10)
    })

    it('rejects values with decimal separators', () => {
      expect(parseLocalizedNumber('1.5', { integer: true })).toBeNull()
      expect(parseLocalizedNumber('1,5', { integer: true })).toBeNull()
    })

    it('rejects trailing decimal with no digits', () => {
      expect(parseLocalizedNumber('1.', { integer: true })).toBeNull()
      expect(parseLocalizedNumber('1,', { integer: true })).toBeNull()
    })
  })

  describe('locale option', () => {
    it('is accepted but behaviour is identical across locales today', () => {
      expect(parseLocalizedNumber('1,5', { locale: 'et-EE' })).toBe(1.5)
      expect(parseLocalizedNumber('1,5', { locale: 'en-GB' })).toBe(1.5)
      expect(parseLocalizedNumber('1.5', { locale: 'et-EE' })).toBe(1.5)
      expect(parseLocalizedNumber('1.5', { locale: 'en-GB' })).toBe(1.5)
    })
  })
})
