import { describe, it, expect } from 'vitest'
import { formatShoppingQuantity } from './format-shopping-quantity'

describe('formatShoppingQuantity', () => {
  describe('grams', () => {
    it('renders sub-kilogram quantities as integer grams', () => {
      expect(formatShoppingQuantity(600, 'g', null, 'en')).toBe('600g')
      expect(formatShoppingQuantity(600, 'g', null, 'et')).toBe('600g')
    })

    it('rounds non-integer gram quantities', () => {
      expect(formatShoppingQuantity(123.7, 'g', null, 'en')).toBe('124g')
    })

    it('renders zero grams', () => {
      expect(formatShoppingQuantity(0, 'g', null, 'en')).toBe('0g')
    })
  })

  describe('kilograms', () => {
    it('switches to kg at 1000g', () => {
      expect(formatShoppingQuantity(1000, 'g', null, 'en')).toBe('1kg')
      expect(formatShoppingQuantity(1000, 'g', null, 'et')).toBe('1kg')
    })

    it('uses period decimal in en', () => {
      expect(formatShoppingQuantity(1500, 'g', null, 'en')).toBe('1.5kg')
    })

    it('uses comma decimal in et', () => {
      expect(formatShoppingQuantity(1500, 'g', null, 'et')).toBe('1,5kg')
    })

    it('drops trailing zeros for whole kg amounts', () => {
      expect(formatShoppingQuantity(2000, 'g', null, 'en')).toBe('2kg')
      expect(formatShoppingQuantity(2000, 'g', null, 'et')).toBe('2kg')
    })

    it('rounds beyond one fraction digit', () => {
      // 1550g → 1.55kg → 1.6kg / 1,6kg
      expect(formatShoppingQuantity(1550, 'g', null, 'en')).toBe('1.6kg')
      expect(formatShoppingQuantity(1550, 'g', null, 'et')).toBe('1,6kg')
    })

    it('uses locale-aware grouping for very large kg amounts', () => {
      // 1234kg → en uses comma grouping, et uses non-breaking space
      expect(formatShoppingQuantity(1_234_000, 'g', null, 'en')).toBe('1,234kg')
      const et = formatShoppingQuantity(1_234_000, 'g', null, 'et')
      expect(et.replace(/[\s  ]/g, '')).toBe('1234kg')
      expect(et).not.toBe('1,234kg')
    })
  })

  describe('pieces', () => {
    it('rounds up grams to whole pieces using gramsPerPiece', () => {
      expect(formatShoppingQuantity(360, 'piece', 60, 'en')).toBe('6')
      expect(formatShoppingQuantity(360, 'piece', 60, 'et')).toBe('6')
    })

    it('rounds up partial pieces (always enough for shopping)', () => {
      // 130g / 60g = 2.16 pieces → 3
      expect(formatShoppingQuantity(130, 'piece', 60, 'en')).toBe('3')
    })

    it('falls back to grams when gramsPerPiece is missing', () => {
      expect(formatShoppingQuantity(500, 'piece', null, 'en')).toBe('500g')
      expect(formatShoppingQuantity(500, 'piece', 0, 'en')).toBe('500g')
    })
  })

  describe('vague quantities', () => {
    it('returns the original phrase unchanged when vague', () => {
      expect(formatShoppingQuantity(5, 'g', null, 'en', true, 'to taste')).toBe('to taste')
      expect(formatShoppingQuantity(5, 'g', null, 'et', true, 'maitse järgi')).toBe('maitse järgi')
    })

    it('formats normally when isVague is true but originalPhrase is missing', () => {
      expect(formatShoppingQuantity(5, 'g', null, 'en', true, null)).toBe('5g')
    })
  })
})
