import { describe, expect, it } from 'vitest'

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

  it('leaves a ran-out row, staple or not, out of both sets (HON-1578)', () => {
    const pantry: PantryIngredient[] = [
      { ingredientId: 'acai', isStaple: false, ranOut: true },
      { ingredientId: 'salt', isStaple: true, ranOut: true },
      { ingredientId: 'oats', isStaple: false },
    ]
    const result = getIngredientAvailabilitySets(pantry)
    expect([...result.availableIds]).toEqual(['oats'])
    expect([...result.stapleIds]).toEqual([])
  })

  it('still counts a ran-out row as pantry data (HON-1578)', () => {
    expect(hasPantryData([{ ingredientId: 'acai', isStaple: false, ranOut: true }])).toBe(true)
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
