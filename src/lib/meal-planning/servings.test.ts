import { describe, it, expect } from 'vitest'
import { getEffectiveServings } from './servings'

describe('getEffectiveServings', () => {
  it('uses the per-entry override when one is set', () => {
    expect(getEffectiveServings({ servingOverride: 6 }, 2)).toBe(6)
  })

  it('falls back to the household size when no override is set', () => {
    expect(getEffectiveServings({ servingOverride: null }, 2)).toBe(2)
  })

  it('returns the same number when the override equals the household size', () => {
    expect(getEffectiveServings({ servingOverride: 2 }, 2)).toBe(2)
  })

  it('honours an override smaller than the household', () => {
    expect(getEffectiveServings({ servingOverride: 1 }, 4)).toBe(1)
  })
})
