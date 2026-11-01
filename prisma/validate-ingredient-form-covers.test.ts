import { describe, expect, it } from 'vitest'

import { INGREDIENT_FORM_COVERS } from '../src/lib/ingredient-form-covers'
import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import { validateIngredientFormCovers } from './validate-ingredient-form-covers'

const pool = new Set(['basil', 'dried basil', 'fresh basil'])

describe('validateIngredientFormCovers', () => {
  it('passes when both names of every cover exist', () => {
    expect(
      validateIngredientFormCovers(pool, { 'dried basil': 'basil', 'fresh basil': 'basil' }),
    ).toEqual([])
  })

  it('fails a cover whose form row is missing', () => {
    expect(validateIngredientFormCovers(pool, { 'dried coriander': 'basil' })).toEqual([
      expect.stringContaining('non-existent ingredient "dried coriander"'),
    ])
  })

  it('fails a cover whose bare row is missing', () => {
    expect(validateIngredientFormCovers(pool, { 'dried basil': 'sweet basil' })).toEqual([
      expect.stringContaining('non-existent ingredient "sweet basil"'),
    ])
  })

  it('passes the real table against the seed catalogue', () => {
    const names = new Set(
      [
        ...baseIngredients,
        ...newIngredients,
        ...comprehensiveIngredients,
        ...importCoverageIngredients,
      ].map((i) => i.name),
    )
    expect(validateIngredientFormCovers(names, INGREDIENT_FORM_COVERS)).toEqual([])
  })
})
