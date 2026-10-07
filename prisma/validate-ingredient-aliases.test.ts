import { describe, it, expect } from 'vitest'
import { validateIngredientAliases } from './validate-ingredient-aliases'
import { INGREDIENT_ALIASES, INGREDIENT_SYNONYMS } from '../src/lib/ingredient-aliases'

const pool = new Set(['plain flour', 'black pepper', 'icing sugar'])

describe('validateIngredientAliases', () => {
  it('passes when every target exists and no key is a pool name', () => {
    const result = validateIngredientAliases(
      pool,
      { pepper: 'black pepper' },
      { 'all-purpose flour': 'plain flour', 'powdered sugar': 'icing sugar' },
    )
    expect(result.errors).toEqual([])
  })

  it('fails an alias whose target is missing', () => {
    const result = validateIngredientAliases(pool, { rice: 'white rice' }, {})
    expect(result.errors).toEqual([expect.stringContaining('alias "rice" → "white rice"')])
  })

  it('fails a synonym whose target is missing', () => {
    const result = validateIngredientAliases(pool, {}, { cornstarch: 'cornflour' })
    expect(result.errors).toEqual([expect.stringContaining('synonym "cornstarch" → "cornflour"')])
  })

  it('fails a synonym key that is itself a pool name', () => {
    const result = validateIngredientAliases(pool, {}, { 'black pepper': 'plain flour' })
    expect(result.errors).toEqual([
      expect.stringContaining('"black pepper" is itself an ingredient name'),
    ])
  })

  it('fails a key that is in both tables', () => {
    const result = validateIngredientAliases(
      pool,
      { 'all-purpose flour': 'plain flour' },
      { 'all-purpose flour': 'plain flour' },
    )
    expect(result.errors).toEqual([
      expect.stringContaining('"all-purpose flour" is both an ingredient alias and a synonym'),
    ])
  })

  it('accepts the real tables against a pool of their targets', () => {
    const targets = new Set([
      ...Object.values(INGREDIENT_ALIASES),
      ...Object.values(INGREDIENT_SYNONYMS),
    ])
    expect(
      validateIngredientAliases(targets, INGREDIENT_ALIASES, INGREDIENT_SYNONYMS).errors,
    ).toEqual([])
  })
})
