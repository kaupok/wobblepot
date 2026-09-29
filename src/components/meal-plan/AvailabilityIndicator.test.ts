import { describe, it, expect } from 'vitest'
import { getIngredientAvailabilitySets, hasPantryData } from './AvailabilityIndicator'
import type { PantryIngredient } from './types'

describe('getIngredientAvailabilitySets', () => {
  it('returns empty sets for empty pantry', () => {
    const result = getIngredientAvailabilitySets([])
    expect(result.availableIds.size).toBe(0)
    expect(result.stapleIds.size).toBe(0)
  })

  it('returns all ingredient IDs as available', () => {
    const pantry: PantryIngredient[] = [
      { ingredientId: 'a', isStaple: false },
      { ingredientId: 'b', isStaple: false },
    ]
    const result = getIngredientAvailabilitySets(pantry)
    expect(result.availableIds.has('a')).toBe(true)
    expect(result.availableIds.has('b')).toBe(true)
    expect(result.availableIds.has('c')).toBe(false)
  })

  it('returns only staple IDs in stapleIds set', () => {
    const pantry: PantryIngredient[] = [
      { ingredientId: 'a', isStaple: true },
      { ingredientId: 'b', isStaple: false },
      { ingredientId: 'c', isStaple: true },
    ]
    const result = getIngredientAvailabilitySets(pantry)
    expect(result.stapleIds.has('a')).toBe(true)
    expect(result.stapleIds.has('b')).toBe(false)
    expect(result.stapleIds.has('c')).toBe(true)
  })

  it('includes staples in both availableIds and stapleIds', () => {
    const pantry: PantryIngredient[] = [{ ingredientId: 'a', isStaple: true }]
    const result = getIngredientAvailabilitySets(pantry)
    expect(result.availableIds.has('a')).toBe(true)
    expect(result.stapleIds.has('a')).toBe(true)
  })
})

describe('hasPantryData', () => {
  it('is false without a pantry', () => {
    expect(hasPantryData(undefined)).toBe(false)
    expect(hasPantryData([])).toBe(false)
  })

  it('is false when the pantry holds only staples (HON-769 defaults)', () => {
    expect(hasPantryData([{ ingredientId: 'salt', isStaple: true }])).toBe(false)
  })

  it('is true once the pantry holds a non-staple', () => {
    expect(
      hasPantryData([
        { ingredientId: 'salt', isStaple: true },
        { ingredientId: 'rice', isStaple: false },
      ]),
    ).toBe(true)
  })
})
