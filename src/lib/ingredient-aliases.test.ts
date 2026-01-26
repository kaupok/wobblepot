import { describe, it, expect } from 'vitest'
import { INGREDIENT_ALIASES, applyIngredientAlias, hasIngredientAlias } from './ingredient-aliases'

describe('INGREDIENT_ALIASES', () => {
  it('contains expected common aliases', () => {
    // All aliases must point to ingredients that exist in the database
    expect(INGREDIENT_ALIASES['pepper']).toBe('black pepper')
    expect(INGREDIENT_ALIASES['oil']).toBe('vegetable oil')
    expect(INGREDIENT_ALIASES['rice']).toBe('white rice')
    expect(INGREDIENT_ALIASES['cream']).toBe('heavy cream')
    expect(INGREDIENT_ALIASES['lettuce']).toBe('romaine lettuce')
  })

  it('contains protein aliases', () => {
    expect(INGREDIENT_ALIASES['chicken']).toBe('chicken breast')
    expect(INGREDIENT_ALIASES['beef']).toBe('ground beef')
    expect(INGREDIENT_ALIASES['pork']).toBe('pork loin')
    expect(INGREDIENT_ALIASES['fish']).toBe('salmon fillet')
  })

  it('contains legume aliases', () => {
    expect(INGREDIENT_ALIASES['beans']).toBe('black beans')
    expect(INGREDIENT_ALIASES['lentils']).toBe('green lentils')
  })

  it('contains multi-word keys', () => {
    expect(INGREDIENT_ALIASES['cooking oil']).toBe('vegetable oil')
  })

  it('does not contain aliases that would degrade direct matches', () => {
    // These were removed because they pointed to non-existent DB ingredients
    // and would make direct matches worse (e.g., "onion" -> "yellow onion" when DB has "onion")
    expect(INGREDIENT_ALIASES['onion']).toBeUndefined()
    expect(INGREDIENT_ALIASES['flour']).toBeUndefined()
    expect(INGREDIENT_ALIASES['milk']).toBeUndefined()
    expect(INGREDIENT_ALIASES['butter']).toBeUndefined()
    expect(INGREDIENT_ALIASES['basil']).toBeUndefined()
  })
})

describe('applyIngredientAlias', () => {
  it('expands known aliases', () => {
    expect(applyIngredientAlias('pepper')).toBe('black pepper')
    expect(applyIngredientAlias('rice')).toBe('white rice')
    expect(applyIngredientAlias('chicken')).toBe('chicken breast')
  })

  it('handles case insensitively', () => {
    expect(applyIngredientAlias('PEPPER')).toBe('black pepper')
    expect(applyIngredientAlias('Rice')).toBe('white rice')
    expect(applyIngredientAlias('CHICKEN')).toBe('chicken breast')
  })

  it('handles whitespace', () => {
    expect(applyIngredientAlias('  pepper  ')).toBe('black pepper')
    expect(applyIngredientAlias('\trice\n')).toBe('white rice')
  })

  it('returns original name for unknown ingredients', () => {
    expect(applyIngredientAlias('quinoa')).toBe('quinoa')
    expect(applyIngredientAlias('tofu')).toBe('tofu')
    expect(applyIngredientAlias('some random ingredient')).toBe('some random ingredient')
  })

  it('returns original name for ingredients that should match directly', () => {
    // These ingredients exist in the DB, so they should pass through unchanged
    expect(applyIngredientAlias('onion')).toBe('onion')
    expect(applyIngredientAlias('flour')).toBe('flour')
    expect(applyIngredientAlias('milk')).toBe('milk')
    expect(applyIngredientAlias('butter')).toBe('butter')
  })

  it('handles multi-word aliases', () => {
    expect(applyIngredientAlias('cooking oil')).toBe('vegetable oil')
  })
})

describe('hasIngredientAlias', () => {
  it('returns true for known aliases', () => {
    expect(hasIngredientAlias('pepper')).toBe(true)
    expect(hasIngredientAlias('rice')).toBe(true)
    expect(hasIngredientAlias('chicken')).toBe(true)
    expect(hasIngredientAlias('cooking oil')).toBe(true)
  })

  it('returns false for unknown ingredients', () => {
    expect(hasIngredientAlias('quinoa')).toBe(false)
    expect(hasIngredientAlias('tofu')).toBe(false)
    expect(hasIngredientAlias('black pepper')).toBe(false) // This is the expanded form, not an alias
  })

  it('returns false for ingredients that should match directly', () => {
    // These are not aliases anymore - they should match directly in DB
    expect(hasIngredientAlias('onion')).toBe(false)
    expect(hasIngredientAlias('flour')).toBe(false)
    expect(hasIngredientAlias('milk')).toBe(false)
    expect(hasIngredientAlias('butter')).toBe(false)
  })

  it('handles case insensitively', () => {
    expect(hasIngredientAlias('PEPPER')).toBe(true)
    expect(hasIngredientAlias('Rice')).toBe(true)
  })
})
