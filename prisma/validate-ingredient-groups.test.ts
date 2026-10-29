import { describe, expect, it } from 'vitest'

import { INGREDIENT_GROUPS } from '../src/lib/household/ingredient-groups'
import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import { validateIngredientGroups } from './validate-ingredient-groups'

const pool = new Set(['frankfurter', 'hot dog', 'smoked sausage'])

describe('validateIngredientGroups', () => {
  it('passes when every member exists and every word is lower case and unique', () => {
    const result = validateIngredientGroups(pool, [
      { en: ['sausage'], et: ['vorst'], members: ['frankfurter', 'smoked sausage'] },
      { en: ['wiener'], et: ['viiner'], members: ['frankfurter', 'hot dog'] },
    ])
    expect(result.errors).toEqual([])
  })

  it('fails a member that is not an ingredient name', () => {
    const result = validateIngredientGroups(pool, [
      { en: ['sausage'], et: [], members: ['frankfurter', 'bratwurst'] },
    ])
    expect(result.errors).toEqual([
      expect.stringContaining('group "sausage" lists "bratwurst", which is not an ingredient name'),
    ])
  })

  it('fails a member whose case differs from the ingredient name', () => {
    const result = validateIngredientGroups(pool, [
      { en: ['sausage'], et: [], members: ['Frankfurter'] },
    ])
    expect(result.errors).toEqual([expect.stringContaining('lists "Frankfurter"')])
  })

  it('fails a group word that is not lower case', () => {
    const result = validateIngredientGroups(pool, [
      { en: ['Sausage'], et: [], members: ['frankfurter'] },
    ])
    expect(result.errors).toEqual([
      expect.stringContaining('group word "Sausage" is not lower case'),
    ])
  })

  it('fails a group word that is in two groups', () => {
    const result = validateIngredientGroups(pool, [
      { en: ['sausage'], et: ['vorst'], members: ['smoked sausage'] },
      { en: ['wiener'], et: ['vorst'], members: ['frankfurter'] },
    ])
    expect(result.errors).toEqual([
      expect.stringContaining('"vorst" is in the groups "sausage" and "wiener"'),
    ])
  })

  it('accepts the real table against the seeded pool', () => {
    const names = new Set(
      [
        ...baseIngredients,
        ...newIngredients,
        ...comprehensiveIngredients,
        ...importCoverageIngredients,
      ].map((ingredient) => ingredient.name),
    )
    expect(validateIngredientGroups(names, INGREDIENT_GROUPS).errors).toEqual([])
  })
})
