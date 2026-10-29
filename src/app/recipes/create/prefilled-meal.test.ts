import { describe, it, expect } from 'vitest'
import { parsePrefilledMeal } from './prefilled-meal'

const lentils = {
  id: 'ing-lentils',
  name: 'Red lentils',
  category: 'carb',
  defaultUnit: 'g',
  proteinType: null,
}

const importStash = {
  name: 'Lentil stew',
  description: null,
  preparationNotes: null,
  sourceUrl: 'https://example.com/stew',
  timeMinutes: 25,
  servings: 4,
  mealTypes: ['lunch', 'dinner'],
  kidFriendly: true,
  prefilledIngredients: [
    { type: 'matched', ingredient: lentils, convertedQuantity: 200 },
    {
      type: 'low-confidence',
      ingredient: lentils,
      lowConfidence: true,
      alternatives: [{ ...lentils, id: 'ing-green', name: 'Green lentils', similarity: 0.7 }],
    },
    { type: 'unmatched', originalText: '1 onion', extractedName: 'onion', extractedQuantity: 1 },
  ],
  originalRecipeText: 'Stew the lentils.',
  origin: 'import',
}

describe('parsePrefilledMeal', () => {
  it('reads a stash the import flow wrote', () => {
    expect(parsePrefilledMeal(JSON.stringify(importStash))).toEqual(importStash)
  })

  it("reads a stash imagine's Edit details wrote", () => {
    const stash = {
      name: 'Lentil stew',
      description: 'Warm and quick.',
      timeMinutes: null,
      servings: 2,
      mealTypes: ['dinner'],
      kidFriendly: false,
      prefilledIngredients: [],
      returnTo: '/recipes/imagine',
      origin: 'imagine',
    }
    expect(parsePrefilledMeal(JSON.stringify(stash))).toEqual(stash)
  })

  it('returns null for text that is not JSON', () => {
    expect(parsePrefilledMeal('{"name":')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    const { name: _name, ...noName } = importStash
    expect(parsePrefilledMeal(JSON.stringify(noName))).toBeNull()
  })

  it('returns null for a meal type the app does not have', () => {
    expect(parsePrefilledMeal(JSON.stringify({ ...importStash, mealTypes: ['supper'] }))).toBeNull()
  })

  it('returns null for an ingredient with an unknown unit', () => {
    const stash = {
      ...importStash,
      prefilledIngredients: [
        { type: 'matched', ingredient: { ...lentils, defaultUnit: 'bucket' } },
      ],
    }
    expect(parsePrefilledMeal(JSON.stringify(stash))).toBeNull()
  })
})
