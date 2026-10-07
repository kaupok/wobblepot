import { describe, expect, it } from 'vitest'
import { macroEnergyShares, macroSplitStyle } from './macro-energy-shares'

const sum = (shares: Record<string, number>) => Object.values(shares).reduce((a, b) => a + b, 0)

describe('macroEnergyShares', () => {
  it('weighs protein and carbs at 4 kcal a gram and fat at 9', () => {
    // 72, 36 and 36 kcal: 18g of protein, 9g of carbs, 4g of fat.
    expect(macroEnergyShares({ protein: 18, carbs: 9, fat: 4 })).toEqual({
      protein: 50,
      carbs: 25,
      fat: 25,
    })
    expect(macroEnergyShares({ protein: 0, carbs: 9, fat: 4 })).toEqual({
      protein: 0,
      carbs: 50,
      fat: 50,
    })
  })

  it('gives the issue example: 42g / 30g / 28g → 31 / 22 / 47', () => {
    expect(macroEnergyShares({ protein: 42, carbs: 30, fat: 28 })).toEqual({
      protein: 31,
      carbs: 22,
      fat: 47,
    })
  })

  it('sums to 100 by largest-remainder rounding', () => {
    // Exact shares 33.3 / 33.3 / 33.3: flooring loses one point, and it goes
    // to the first macro on a tie.
    const shares = macroEnergyShares({ protein: 9, carbs: 9, fat: 4 })
    expect(shares).toEqual({ protein: 34, carbs: 33, fat: 33 })
    for (const grams of [
      { protein: 38, carbs: 6, fat: 48 },
      { protein: 18, carbs: 104, fat: 14 },
      { protein: 1, carbs: 1, fat: 1 },
      { protein: 0.4, carbs: 250, fat: 0.3 },
    ]) {
      expect(sum(macroEnergyShares(grams))).toBe(100)
    }
  })

  it('gives a macro at 0g a share of 0', () => {
    expect(macroEnergyShares({ protein: 20, carbs: 30, fat: 0 })).toEqual({
      protein: 40,
      carbs: 60,
      fat: 0,
    })
  })

  it('returns all 0 when every macro is 0', () => {
    expect(macroEnergyShares({ protein: 0, carbs: 0, fat: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    })
  })

  it('reads a negative or non-finite value as 0', () => {
    expect(macroEnergyShares({ protein: Number.NaN, carbs: -5, fat: 10 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 100,
    })
  })
})

describe('macroSplitStyle', () => {
  it('builds one fr track per part, each at least 4px', () => {
    expect(macroSplitStyle([31, 22, 47])).toEqual({
      '--macro-split': 'minmax(4px, 31fr) minmax(4px, 22fr) minmax(4px, 47fr)',
    })
    expect(macroSplitStyle([100])).toEqual({ '--macro-split': 'minmax(4px, 100fr)' })
  })
})
