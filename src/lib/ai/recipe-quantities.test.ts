import { describe, it, expect } from 'vitest'
import {
  convertQuantity,
  isReasonableQuantity,
  MAX_GRAMS_PER_SERVING,
  DEFAULT_GRAMS_PER_PIECE,
  CUP_CONVERSIONS,
} from './recipe-quantities'

describe('convertQuantity', () => {
  const makeIngredient = (
    defaultUnit: 'g' | 'piece',
    gramsPerPiece: number | null = null,
    category?: string,
  ) => ({
    defaultUnit: defaultUnit as 'g' | 'piece',
    gramsPerPiece,
    category: category as 'spice' | 'dairy' | 'protein' | 'vegetable' | undefined,
  })

  it('returns same quantity when units match', () => {
    expect(convertQuantity(100, 'g', makeIngredient('g'))).toBe(100)
    expect(convertQuantity(3, 'piece', makeIngredient('piece'))).toBe(3)
  })

  it('converts grams to grams (passthrough)', () => {
    expect(convertQuantity(500, 'g', makeIngredient('g'))).toBe(500)
  })

  it('converts ml to grams (1:1 density)', () => {
    expect(convertQuantity(250, 'ml', makeIngredient('g'))).toBe(250)
  })

  it('converts pieces to grams using gramsPerPiece', () => {
    expect(convertQuantity(3, 'piece', makeIngredient('g', 60))).toBe(180)
  })

  it('converts pieces to grams using DEFAULT_GRAMS_PER_PIECE when not specified', () => {
    expect(convertQuantity(3, 'piece', makeIngredient('g', null))).toBe(3 * DEFAULT_GRAMS_PER_PIECE)
  })

  it('converts tbsp to grams (1 tbsp = 15g)', () => {
    expect(convertQuantity(2, 'tbsp', makeIngredient('g'))).toBe(30)
  })

  it('converts tsp to grams (1 tsp = 5g)', () => {
    expect(convertQuantity(3, 'tsp', makeIngredient('g'))).toBe(15)
  })

  it('converts cups to grams using category-specific conversion for spice', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g', null, 'spice'))).toBe(
      CUP_CONVERSIONS.spice,
    )
  })

  it('converts cups to grams using category-specific conversion for dairy', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g', null, 'dairy'))).toBe(
      CUP_CONVERSIONS.dairy,
    )
  })

  it('converts cups to grams using default when no category', () => {
    expect(convertQuantity(1, 'cup', makeIngredient('g'))).toBe(CUP_CONVERSIONS.default)
  })

  it('converts oz to grams (1 oz = 28g)', () => {
    expect(convertQuantity(4, 'oz', makeIngredient('g'))).toBe(112)
  })

  it('converts lb to grams (1 lb = 454g)', () => {
    expect(convertQuantity(2, 'lb', makeIngredient('g'))).toBe(908)
  })

  it('converts grams to pieces using gramsPerPiece', () => {
    expect(convertQuantity(180, 'g', makeIngredient('piece', 60))).toBe(3)
  })

  it('converts grams to pieces rounding to 1 decimal', () => {
    // 100g / 60g per piece = 1.666... → 1.7
    expect(convertQuantity(100, 'g', makeIngredient('piece', 60))).toBe(1.7)
  })

  it('returns original quantity for piece conversion without gramsPerPiece', () => {
    expect(convertQuantity(200, 'g', makeIngredient('piece', null))).toBe(200)
  })

  it('handles unknown fromUnit as passthrough', () => {
    expect(convertQuantity(100, 'unknown', makeIngredient('g'))).toBe(100)
  })
})

describe('isReasonableQuantity', () => {
  it('returns true for reasonable quantities', () => {
    // 400g total for 4 servings = 100g per serving
    expect(isReasonableQuantity(400, 4)).toBe(true)
  })

  it('returns true at the boundary', () => {
    // 2000g for 4 servings = 500g per serving (exactly at MAX_GRAMS_PER_SERVING)
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING * 4, 4)).toBe(true)
  })

  it('returns false for unreasonable quantities', () => {
    // 4000g for 4 servings = 1000g per serving
    expect(isReasonableQuantity(4000, 4)).toBe(false)
  })

  it('handles single serving', () => {
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING, 1)).toBe(true)
    expect(isReasonableQuantity(MAX_GRAMS_PER_SERVING + 1, 1)).toBe(false)
  })
})

describe('exported constants', () => {
  it('has valid MAX_GRAMS_PER_SERVING', () => {
    expect(MAX_GRAMS_PER_SERVING).toBeGreaterThan(0)
  })

  it('has valid DEFAULT_GRAMS_PER_PIECE', () => {
    expect(DEFAULT_GRAMS_PER_PIECE).toBeGreaterThan(0)
  })

  it('has CUP_CONVERSIONS for all expected categories', () => {
    expect(CUP_CONVERSIONS.spice).toBeDefined()
    expect(CUP_CONVERSIONS.dairy).toBeDefined()
    expect(CUP_CONVERSIONS.protein).toBeDefined()
    expect(CUP_CONVERSIONS.default).toBeDefined()
  })
})
