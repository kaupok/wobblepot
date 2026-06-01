import { describe, it, expect } from 'vitest'
import { normalizeIngredientKey } from './ingredient-key'

describe('normalizeIngredientKey', () => {
  it('lowercases', () => {
    expect(normalizeIngredientKey('Chicken Breast')).toBe('chicken breast')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeIngredientKey('  olive oil  ')).toBe('olive oil')
  })

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeIngredientKey('white  rice')).toBe('white rice')
    expect(normalizeIngredientKey('white\trice')).toBe('white rice')
  })

  it('folds curly apostrophes to the straight ASCII variant', () => {
    // The exact bug class that dropped meal rows in HON-507.
    expect(normalizeIngredientKey('bird’s eye chilli')).toBe("bird's eye chilli")
    expect(normalizeIngredientKey('bird‘s eye chilli')).toBe("bird's eye chilli")
  })

  it('treats curly- and straight-apostrophe variants as the same key', () => {
    expect(normalizeIngredientKey('Shepherd’s Pie')).toBe(normalizeIngredientKey("shepherd's pie"))
  })

  it('is idempotent', () => {
    const once = normalizeIngredientKey('  Bird’s  Eye   Chilli ')
    expect(normalizeIngredientKey(once)).toBe(once)
  })
})
