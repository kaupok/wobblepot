import { describe, it, expect } from 'vitest'
import { INGREDIENT_ALIASES, applyIngredientAlias, hasIngredientAlias } from './ingredient-aliases'

describe('INGREDIENT_ALIASES', () => {
  it('contains expected common aliases', () => {
    expect(INGREDIENT_ALIASES['pepper']).toBe('black pepper')
    expect(INGREDIENT_ALIASES['onion']).toBe('yellow onion')
    expect(INGREDIENT_ALIASES['flour']).toBe('all-purpose flour')
    expect(INGREDIENT_ALIASES['oil']).toBe('vegetable oil')
    expect(INGREDIENT_ALIASES['milk']).toBe('whole milk')
    expect(INGREDIENT_ALIASES['butter']).toBe('unsalted butter')
    expect(INGREDIENT_ALIASES['rice']).toBe('white rice')
  })

  it('contains herb aliases with fresh defaults', () => {
    expect(INGREDIENT_ALIASES['basil']).toBe('fresh basil')
    expect(INGREDIENT_ALIASES['parsley']).toBe('fresh parsley')
    expect(INGREDIENT_ALIASES['cilantro']).toBe('fresh cilantro')
    expect(INGREDIENT_ALIASES['thyme']).toBe('fresh thyme')
  })

  it('contains multi-word keys', () => {
    expect(INGREDIENT_ALIASES['bell pepper']).toBe('green bell pepper')
    expect(INGREDIENT_ALIASES['cooking oil']).toBe('vegetable oil')
  })
})

describe('applyIngredientAlias', () => {
  it('expands known aliases', () => {
    expect(applyIngredientAlias('pepper')).toBe('black pepper')
    expect(applyIngredientAlias('onion')).toBe('yellow onion')
    expect(applyIngredientAlias('flour')).toBe('all-purpose flour')
  })

  it('handles case insensitively', () => {
    expect(applyIngredientAlias('PEPPER')).toBe('black pepper')
    expect(applyIngredientAlias('Onion')).toBe('yellow onion')
    expect(applyIngredientAlias('FLOUR')).toBe('all-purpose flour')
  })

  it('handles whitespace', () => {
    expect(applyIngredientAlias('  pepper  ')).toBe('black pepper')
    expect(applyIngredientAlias('\tonion\n')).toBe('yellow onion')
  })

  it('returns original name for unknown ingredients', () => {
    expect(applyIngredientAlias('quinoa')).toBe('quinoa')
    expect(applyIngredientAlias('tofu')).toBe('tofu')
    expect(applyIngredientAlias('some random ingredient')).toBe('some random ingredient')
  })

  it('handles multi-word aliases', () => {
    expect(applyIngredientAlias('bell pepper')).toBe('green bell pepper')
    expect(applyIngredientAlias('cooking oil')).toBe('vegetable oil')
  })
})

describe('hasIngredientAlias', () => {
  it('returns true for known aliases', () => {
    expect(hasIngredientAlias('pepper')).toBe(true)
    expect(hasIngredientAlias('onion')).toBe(true)
    expect(hasIngredientAlias('flour')).toBe(true)
    expect(hasIngredientAlias('bell pepper')).toBe(true)
  })

  it('returns false for unknown ingredients', () => {
    expect(hasIngredientAlias('quinoa')).toBe(false)
    expect(hasIngredientAlias('tofu')).toBe(false)
    expect(hasIngredientAlias('black pepper')).toBe(false) // This is the expanded form, not an alias
  })

  it('handles case insensitively', () => {
    expect(hasIngredientAlias('PEPPER')).toBe(true)
    expect(hasIngredientAlias('Onion')).toBe(true)
  })
})
