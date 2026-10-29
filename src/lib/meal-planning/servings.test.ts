import { describe, expect, it } from 'vitest'

import { getCookServings, getEffectiveServings, sumPortions } from './servings'

const member = (portionMultiplier: number) => ({ preferences: { portionMultiplier } })

describe('sumPortions', () => {
  it('cooks for 2.5 when two adults and a toddler eat', () => {
    expect(sumPortions([member(1), member(1), member(0.5)])).toBe(2.5)
  })

  it('adds a large portion to the sum', () => {
    expect(sumPortions([member(1.5), member(1), member(0.5)])).toBe(3)
  })

  it('never goes below one serving', () => {
    expect(sumPortions([member(0.5)])).toBe(1)
  })

  it('rounds the sum to the nearest half', () => {
    expect(sumPortions([member(0.75), member(0.5)])).toBe(1.5)
    expect(sumPortions([member(1.2), member(1)])).toBe(2)
  })

  it('counts a member without a preferences row as one portion', () => {
    expect(sumPortions([{ preferences: null }, member(0.5)])).toBe(1.5)
  })
})

describe('getEffectiveServings', () => {
  it('uses the per-entry override when one is set', () => {
    expect(getEffectiveServings({ servingOverride: 6 }, 2)).toBe(6)
  })

  it('falls back to the household servings when no override is set', () => {
    expect(getEffectiveServings({ servingOverride: null }, 2.5)).toBe(2.5)
  })

  it('returns the same number when the override equals the household servings', () => {
    expect(getEffectiveServings({ servingOverride: 2 }, 2)).toBe(2)
  })

  it('honours an override smaller than the household', () => {
    expect(getEffectiveServings({ servingOverride: 1 }, 4)).toBe(1)
  })
})

// HON-1394: the issue's numbers, not the code's.
describe('getCookServings', () => {
  const planned = (servings: (number | null)[], servingOverride: number | null = null) => ({
    servingOverride,
    status: 'planned',
    cookedServings: null,
    leftoverItems: servings.map((s) => ({ servings: s })),
  })

  it('is the own servings with no leftover lunch', () => {
    expect(getCookServings(planned([]), 3)).toBe(3)
  })

  it('adds one lunch at 2.5 to 3 own servings: 5.5', () => {
    expect(getCookServings(planned([2.5]), 3)).toBe(5.5)
  })

  it('adds two lunches at 2.5 and 2: 7.5', () => {
    expect(getCookServings(planned([2.5, 2]), 3)).toBe(7.5)
  })

  it('adds the lunches to an override', () => {
    expect(getCookServings(planned([2.5], 4), 3)).toBe(6.5)
  })

  it('counts a leftover item with no servings as nothing', () => {
    expect(getCookServings(planned([null, 2]), 3)).toBe(5)
  })

  it('is the stored count once completed, whatever the lunches say now', () => {
    expect(getCookServings({ ...planned([]), status: 'completed', cookedServings: 5.5 }, 3)).toBe(
      5.5,
    )
  })

  it('is the own servings for a completed entry with no stored count', () => {
    expect(getCookServings({ ...planned([2.5]), status: 'completed' }, 3)).toBe(3)
  })
})
