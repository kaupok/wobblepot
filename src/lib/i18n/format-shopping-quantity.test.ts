import { describe, it, expect } from 'vitest'
import { formatShoppingQuantity } from './format-shopping-quantity'

describe('formatShoppingQuantity', () => {
  describe('grams', () => {
    it('renders sub-kilogram quantities as integer grams', () => {
      expect(formatShoppingQuantity(600, 'g', 'en')).toBe('600g')
      expect(formatShoppingQuantity(600, 'g', 'et')).toBe('600g')
    })

    it('rounds non-integer gram quantities', () => {
      expect(formatShoppingQuantity(123.7, 'g', 'en')).toBe('124g')
    })

    it('renders zero grams', () => {
      expect(formatShoppingQuantity(0, 'g', 'en')).toBe('0g')
    })
  })

  describe('kilograms', () => {
    it('switches to kg at 1000g', () => {
      expect(formatShoppingQuantity(1000, 'g', 'en')).toBe('1kg')
      expect(formatShoppingQuantity(1000, 'g', 'et')).toBe('1kg')
    })

    it('uses period decimal in en', () => {
      expect(formatShoppingQuantity(1500, 'g', 'en')).toBe('1.5kg')
    })

    it('uses comma decimal in et', () => {
      expect(formatShoppingQuantity(1500, 'g', 'et')).toBe('1,5kg')
    })

    it('drops trailing zeros for whole kg amounts', () => {
      expect(formatShoppingQuantity(2000, 'g', 'en')).toBe('2kg')
      expect(formatShoppingQuantity(2000, 'g', 'et')).toBe('2kg')
    })

    it('rounds beyond one fraction digit', () => {
      // 1550g → 1.55kg → 1.6kg / 1,6kg
      expect(formatShoppingQuantity(1550, 'g', 'en')).toBe('1.6kg')
      expect(formatShoppingQuantity(1550, 'g', 'et')).toBe('1,6kg')
    })

    it('uses locale-aware grouping for very large kg amounts', () => {
      // 1234kg → en uses comma grouping, et uses non-breaking space
      expect(formatShoppingQuantity(1_234_000, 'g', 'en')).toBe('1,234kg')
      const et = formatShoppingQuantity(1_234_000, 'g', 'et')
      expect(et.replace(/[\s  ]/g, '')).toBe('1234kg')
      expect(et).not.toBe('1,234kg')
    })
  })

  describe('pieces', () => {
    // Piece quantities are already piece counts (HON-713), never grams.
    it('renders a whole piece count as-is', () => {
      // 2 eggs per serving x 4 servings
      expect(formatShoppingQuantity(8, 'piece', 'en')).toBe('8')
      expect(formatShoppingQuantity(8, 'piece', 'et')).toBe('8')
    })

    it('rounds up partial pieces (always enough for shopping)', () => {
      // half a lemon per serving x 3 servings
      expect(formatShoppingQuantity(1.5, 'piece', 'en')).toBe('2')
    })

    it('does not round up float residue from total / servings * servings', () => {
      expect(formatShoppingQuantity((8 / 3) * 3, 'piece', 'en')).toBe('8')
    })

    it('never switches to kg, however large the count', () => {
      expect(formatShoppingQuantity(1500, 'piece', 'en')).toBe('1,500')
    })
  })

  describe('vague quantities', () => {
    it('returns the original phrase unchanged when vague', () => {
      expect(formatShoppingQuantity(5, 'g', 'en', true, 'to taste')).toBe('to taste')
      expect(formatShoppingQuantity(5, 'g', 'et', true, 'maitse järgi')).toBe('maitse järgi')
    })

    it('formats normally when isVague is true but originalPhrase is missing', () => {
      expect(formatShoppingQuantity(5, 'g', 'en', true, null)).toBe('5g')
    })
  })
})
