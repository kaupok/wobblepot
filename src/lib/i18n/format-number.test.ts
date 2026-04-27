import { describe, it, expect } from 'vitest'
import { formatQuantity, formatInteger } from './format-number'

describe('formatQuantity', () => {
  it('uses a period as decimal separator in en', () => {
    expect(formatQuantity(1.5, 'en')).toBe('1.5')
  })

  it('uses a comma as decimal separator in et', () => {
    expect(formatQuantity(1.5, 'et')).toBe('1,5')
  })

  it('drops trailing zeros by default (maximumFractionDigits=1, minimum=0)', () => {
    expect(formatQuantity(2, 'en')).toBe('2')
    expect(formatQuantity(2, 'et')).toBe('2')
  })

  it('rounds beyond the maximumFractionDigits cap', () => {
    // 1.55 with maxFractionDigits=1 rounds to 1.6 in both locales.
    expect(formatQuantity(1.55, 'en')).toBe('1.6')
    expect(formatQuantity(1.55, 'et')).toBe('1,6')
  })

  it('honours overrides for fraction-digit options', () => {
    expect(formatQuantity(0.5, 'en', { maximumFractionDigits: 2 })).toBe('0.5')
    // When the caller asks for a minimum, they own bumping the maximum so it
    // is never below the minimum (Intl rejects max < min). Asserts the override
    // is wired through.
    expect(formatQuantity(0.5, 'en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe(
      '0.50',
    )
  })
})

describe('formatInteger', () => {
  it('renders integers without fraction digits', () => {
    expect(formatInteger(42, 'en')).toBe('42')
    expect(formatInteger(42, 'et')).toBe('42')
  })

  it('rounds non-integer input', () => {
    expect(formatInteger(42.7, 'en')).toBe('43')
  })

  it('uses locale-appropriate grouping for large integers', () => {
    // en groups with comma, et groups with non-breaking space (U+00A0 or U+202F).
    expect(formatInteger(1234, 'en')).toBe('1,234')
    const et = formatInteger(1234, 'et')
    expect(et.replace(/[\s  ]/g, '')).toBe('1234')
    // Should not be the en form.
    expect(et).not.toBe('1,234')
  })
})
