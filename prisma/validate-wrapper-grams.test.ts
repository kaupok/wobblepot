import { describe, it, expect } from 'vitest'
import { validateWrapperGramsPerPiece } from './validate-wrapper-grams'
import { comprehensiveIngredients } from './seed-comprehensive'
import { importCoverageIngredients } from './seed-import-coverage'
import type { IngredientInput } from './seed-types'

const row = (overrides: Partial<IngredientInput>): IngredientInput => ({
  name: 'test wrappers',
  category: 'carb',
  subcategory: 'wrapper',
  defaultUnit: 'g',
  allergens: [],
  calories: 290,
  protein: 8,
  carbs: 56,
  fat: 2,
  ...overrides,
})

describe('validateWrapperGramsPerPiece', () => {
  it('names a wrapper row without gramsPerPiece', () => {
    expect(validateWrapperGramsPerPiece([row({ name: 'dumpling sheets' })])).toEqual([
      "dumpling sheets: missing 'gramsPerPiece' (required for subcategory 'wrapper', which a recipe counts in pieces)",
    ])
  })

  it('treats a null gramsPerPiece as missing', () => {
    expect(validateWrapperGramsPerPiece([row({ gramsPerPiece: null })])).toHaveLength(1)
  })

  it('passes a wrapper row with gramsPerPiece', () => {
    expect(validateWrapperGramsPerPiece([row({ gramsPerPiece: 8 })])).toEqual([])
  })

  it('ignores a row outside the wrapper subcategory', () => {
    expect(validateWrapperGramsPerPiece([row({ subcategory: 'noodle' })])).toEqual([])
  })

  it('passes every wrapper row in the seed', () => {
    const pool = [...comprehensiveIngredients, ...importCoverageIngredients]
    expect(validateWrapperGramsPerPiece(pool)).toEqual([])
  })

  it('carries the issue values on the three seed wrapper rows', () => {
    const grams = Object.fromEntries(
      comprehensiveIngredients
        .filter((ing) => ing.subcategory === 'wrapper')
        .map((ing) => [ing.name, ing.gramsPerPiece]),
    )
    expect(grams).toEqual({ 'wonton wrappers': 8, 'spring roll wrappers': 15, 'rice paper': 9 })
  })
})
