import { describe, expect, it } from 'vitest'

import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import type { IngredientInput } from './seed-types'
import { validateDryWeightNutrition } from './validate-dry-weight-nutrition'

const row = (overrides: Partial<IngredientInput>): IngredientInput => ({
  name: 'test grain',
  category: 'carb',
  subcategory: 'grain',
  defaultUnit: 'g',
  allergens: [],
  calories: 360,
  protein: 7,
  carbs: 79,
  fat: 0.6,
  ...overrides,
})

describe('validateDryWeightNutrition', () => {
  it('warns for a grain row with cooked values', () => {
    expect(validateDryWeightNutrition([row({ calories: 130 })])).toEqual([
      'test grain: 130 kcal per 100 g looks cooked; a grain row holds dry, as-bought values',
    ])
  })

  it('does not warn for gnocchi, which is sold fresh', () => {
    expect(
      validateDryWeightNutrition([row({ name: 'gnocchi', subcategory: 'pasta', calories: 133 })]),
    ).toEqual([])
  })

  it('warns for split peas but not for green peas', () => {
    expect(
      validateDryWeightNutrition([
        row({ name: 'split peas', subcategory: 'peas', calories: 118 }),
        row({ name: 'peas', subcategory: 'peas', calories: 81 }),
      ]),
    ).toEqual([
      'split peas: 118 kcal per 100 g looks cooked; a peas row holds dry, as-bought values',
    ])
  })

  it('warns for a dried legume row with drained-tin values, but not for the tinned row', () => {
    expect(
      validateDryWeightNutrition([
        row({ name: 'dried chickpeas', category: 'legume', subcategory: 'beans', calories: 164 }),
        row({ name: 'chickpeas', category: 'legume', subcategory: 'beans', calories: 164 }),
        row({ name: 'dried black beans', category: 'legume', subcategory: 'beans', calories: 341 }),
      ]),
    ).toEqual([
      'dried chickpeas: 164 kcal per 100 g looks cooked; a beans row holds dry, as-bought values',
    ])
  })

  it('passes every seed ingredient', () => {
    const pool: IngredientInput[] = [
      ...baseIngredients,
      ...newIngredients,
      ...comprehensiveIngredients,
      ...importCoverageIngredients,
    ]
    expect(validateDryWeightNutrition(pool)).toEqual([])
  })
})
