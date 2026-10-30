import { describe, expect, it } from 'vitest'

import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import type { IngredientInput } from './seed-types'
import { validateRawMeatNutrition } from './validate-raw-meat-nutrition'

const row = (overrides: Partial<IngredientInput>): IngredientInput => ({
  name: 'test chicken',
  category: 'protein',
  subcategory: 'poultry',
  proteinType: 'poultry',
  defaultUnit: 'g',
  allergens: [],
  calories: 120,
  protein: 22.5,
  carbs: 0,
  fat: 2.6,
  ...overrides,
})

describe('validateRawMeatNutrition', () => {
  it('warns for a poultry row with cooked values', () => {
    expect(validateRawMeatNutrition([row({ protein: 28 })])).toEqual([
      'test chicken: 28 g protein per 100 g looks cooked; a poultry row holds raw, as-bought values',
    ])
  })

  it('does not warn for prosciutto, which is cured', () => {
    expect(
      validateRawMeatNutrition([
        row({ name: 'prosciutto', subcategory: 'pork', proteinType: 'pork', protein: 26 }),
      ]),
    ).toEqual([])
  })

  it('does not warn for fish, which runs above 24 g raw', () => {
    expect(
      validateRawMeatNutrition([
        row({ name: 'tuna', subcategory: 'fish', proteinType: 'fish', protein: 24.4 }),
      ]),
    ).toEqual([])
  })

  it('passes every seed ingredient', () => {
    const pool: IngredientInput[] = [
      ...baseIngredients,
      ...newIngredients,
      ...comprehensiveIngredients,
      ...importCoverageIngredients,
    ]
    expect(validateRawMeatNutrition(pool)).toEqual([])
  })
})
