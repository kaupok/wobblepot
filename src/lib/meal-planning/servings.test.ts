import { describe, it, expect } from 'vitest'
import { getEffectiveServings, sumPortions } from './servings'

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
