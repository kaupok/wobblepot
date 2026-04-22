import { describe, it, expect } from 'vitest'
import { matchAcceptLanguage, parseAcceptLanguage } from './accept-language'

describe('parseAcceptLanguage', () => {
  it('returns empty array for null / undefined / empty', () => {
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage(undefined)).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
  })

  it('parses a single locale with default quality 1.0', () => {
    expect(parseAcceptLanguage('et')).toEqual([{ locale: 'et', q: 1.0 }])
  })

  it('parses multiple locales with quality values and sorts by q desc', () => {
    const result = parseAcceptLanguage('en;q=0.5, et;q=0.9, fi;q=0.1')
    expect(result).toEqual([
      { locale: 'et', q: 0.9 },
      { locale: 'en', q: 0.5 },
      { locale: 'fi', q: 0.1 },
    ])
  })

  it('lowercases locale tokens and trims whitespace', () => {
    expect(parseAcceptLanguage('  EN-US , ET ')).toEqual([
      { locale: 'en-us', q: 1.0 },
      { locale: 'et', q: 1.0 },
    ])
  })

  it('ignores wildcard (*)', () => {
    expect(parseAcceptLanguage('*')).toEqual([])
  })

  it('tolerates malformed q values', () => {
    const result = parseAcceptLanguage('et;q=garbage')
    expect(result).toEqual([{ locale: 'et', q: 1.0 }])
  })
})

describe('matchAcceptLanguage', () => {
  it('returns null when no candidates match', () => {
    expect(matchAcceptLanguage('fr,de;q=0.5')).toBeNull()
  })

  it('returns exact match on known locale', () => {
    expect(matchAcceptLanguage('et')).toBe('et')
  })

  it('matches on primary subtag when full tag is unknown', () => {
    expect(matchAcceptLanguage('en-US,en-GB;q=0.8')).toBe('en')
  })

  it('respects quality ordering — highest q wins among known locales', () => {
    expect(matchAcceptLanguage('en;q=0.5, et;q=0.9')).toBe('et')
  })

  it('skips unknown entries and finds the first known one', () => {
    expect(matchAcceptLanguage('fr,et;q=0.7,de;q=0.5')).toBe('et')
  })

  it('returns null for empty / missing headers', () => {
    expect(matchAcceptLanguage(null)).toBeNull()
    expect(matchAcceptLanguage(undefined)).toBeNull()
    expect(matchAcceptLanguage('')).toBeNull()
  })
})
