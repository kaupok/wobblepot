import { describe, expect, it } from 'vitest'

import { KNOWN_LOCALES } from './locales'
import { toOgLocale } from './og-locale'

describe('toOgLocale', () => {
  it('maps en to en_US', () => {
    expect(toOgLocale('en')).toBe('en_US')
  })

  it('maps et to et_EE', () => {
    expect(toOgLocale('et')).toBe('et_EE')
  })

  it('returns a value for every known locale', () => {
    for (const locale of KNOWN_LOCALES) {
      const result = toOgLocale(locale)
      expect(result).toMatch(/^[a-z]{2}_[A-Z]{2}$/)
    }
  })
})
