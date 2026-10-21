import { describe, it, expect } from 'vitest'
import { PIECE_COUNTED_SPICES, validatePieceSpiceGramsPerPiece } from './validate-piece-spice-grams'
import { newIngredients } from './seed-expansion'
import { comprehensiveIngredients } from './seed-comprehensive'
import { importCoverageIngredients } from './seed-import-coverage'
import type { IngredientInput } from './seed-types'

const pool: IngredientInput[] = [
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]

const row = (overrides: Partial<IngredientInput>): IngredientInput => ({
  name: 'bay leaves',
  category: 'spice',
  subcategory: 'herb',
  defaultUnit: 'g',
  allergens: [],
  calories: 313,
  protein: 8,
  carbs: 75,
  fat: 8,
  ...overrides,
})

// Every listed name present with a weight, so one test can break a single row.
const withWeights = (): IngredientInput[] =>
  PIECE_COUNTED_SPICES.map((name) => row({ name, gramsPerPiece: 1 }))

describe('validatePieceSpiceGramsPerPiece', () => {
  it('names a listed row without gramsPerPiece', () => {
    const rows = withWeights().map((ing) =>
      ing.name === 'bay leaves' ? { ...ing, gramsPerPiece: undefined } : ing,
    )
    expect(validatePieceSpiceGramsPerPiece(rows)).toEqual([
      "bay leaves: missing 'gramsPerPiece' (a recipe counts it in pieces)",
    ])
  })

  it('treats a null gramsPerPiece as missing', () => {
    const rows = withWeights().map((ing) =>
      ing.name === 'cloves' ? { ...ing, gramsPerPiece: null } : ing,
    )
    expect(validatePieceSpiceGramsPerPiece(rows)).toHaveLength(1)
  })

  it('names a listed spice with no seed row', () => {
    const rows = withWeights().filter((ing) => ing.name !== 'star anise')
    expect(validatePieceSpiceGramsPerPiece(rows)).toEqual([
      'star anise: listed in PIECE_COUNTED_SPICES but has no seed row',
    ])
  })

  it('passes every listed row in the seed', () => {
    expect(validatePieceSpiceGramsPerPiece(pool)).toEqual([])
  })

  it('weighs a bay leaf under 1 g in the seed', () => {
    expect(pool.find((ing) => ing.name === 'bay leaves')?.gramsPerPiece).toBe(0.2)
  })
})
