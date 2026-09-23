import { describe, it, expect } from 'vitest'
import { componentGramsPerServing, computeMealNutrition } from './nutrition'

describe('computeMealNutrition', () => {
  it('computes nutrition from single component', () => {
    const components = [
      {
        quantityPerServing: 150, // 150g
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 200, // per 100g
          protein: 20,
          carbs: 0,
          fat: 12,
        },
      },
    ]

    const result = computeMealNutrition(components)

    expect(result).toEqual({
      calories: 300, // 200 * 150 / 100
      protein: 30, // 20 * 150 / 100
      carbs: 0,
      fat: 18, // 12 * 150 / 100
    })
  })

  it('computes nutrition from multiple components', () => {
    const components = [
      {
        quantityPerServing: 150, // Salmon
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 200,
          protein: 20,
          carbs: 0,
          fat: 12,
        },
      },
      {
        quantityPerServing: 200, // Rice
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
        },
      },
      {
        quantityPerServing: 100, // Broccoli
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 34,
          protein: 2.8,
          carbs: 7,
          fat: 0.4,
        },
      },
    ]

    const result = computeMealNutrition(components)

    expect(result).toEqual({
      calories: 300 + 260 + 34, // 594
      protein: 30 + 5.4 + 2.8, // 38.2
      carbs: 0 + 56 + 7, // 63
      fat: 18 + 0.6 + 0.4, // 19
    })
  })

  it('returns zeros for empty components array', () => {
    const result = computeMealNutrition([])

    expect(result).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    })
  })

  it('handles components with zero quantity', () => {
    const components = [
      {
        quantityPerServing: 0,
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 200,
          protein: 20,
          carbs: 10,
          fat: 5,
        },
      },
    ]

    const result = computeMealNutrition(components)

    expect(result).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    })
  })

  it('handles fractional quantities correctly', () => {
    const components = [
      {
        quantityPerServing: 75.5, // 75.5g
        ingredient: {
          defaultUnit: 'g' as const,
          calories: 100,
          protein: 10,
          carbs: 20,
          fat: 5,
        },
      },
    ]

    const result = computeMealNutrition(components)

    expect(result).toEqual({
      calories: 75.5, // 100 * 75.5 / 100
      protein: 7.55, // 10 * 75.5 / 100
      carbs: 15.1, // 20 * 75.5 / 100
      fat: 3.775, // 5 * 75.5 / 100
    })
  })

  describe('piece-unit ingredients (HON-713)', () => {
    // 2 eggs per serving, 55 g each, 155 kcal / 13 g protein / 1.1 g carbs / 11 g fat per 100 g
    const eggs = {
      quantityPerServing: 2,
      ingredient: {
        defaultUnit: 'piece' as const,
        gramsPerPiece: 55,
        calories: 155,
        protein: 13,
        carbs: 1.1,
        fat: 11,
      },
    }

    it('converts pieces to grams via gramsPerPiece', () => {
      const result = computeMealNutrition([eggs])

      // (2 * 55) / 100 * 155 — the value the meal form preview shows
      expect(result.calories).toBeCloseTo(170.5)
      expect(result.protein).toBeCloseTo(14.3)
      expect(result.carbs).toBeCloseTo(1.21)
      expect(result.fat).toBeCloseTo(12.1)
    })

    it('falls back to DEFAULT_GRAMS_PER_PIECE when gramsPerPiece is null', () => {
      const result = computeMealNutrition([
        { ...eggs, ingredient: { ...eggs.ingredient, gramsPerPiece: null } },
      ])

      // 2 pieces * 30 g default
      expect(result.calories).toBeCloseTo(93)
    })

    it('skips vague components', () => {
      const result = computeMealNutrition([eggs, { ...eggs, isVague: true }])

      expect(result.calories).toBeCloseTo(170.5)
    })
  })
})

describe('componentGramsPerServing', () => {
  it('returns gram quantities unchanged', () => {
    expect(componentGramsPerServing(150, { defaultUnit: 'g', gramsPerPiece: 55 })).toBe(150)
  })

  it('multiplies piece quantities by gramsPerPiece', () => {
    expect(componentGramsPerServing(2, { defaultUnit: 'piece', gramsPerPiece: 55 })).toBe(110)
  })

  it('uses the 30 g default for a piece ingredient without a usable gramsPerPiece', () => {
    expect(componentGramsPerServing(2, { defaultUnit: 'piece', gramsPerPiece: null })).toBe(60)
    expect(componentGramsPerServing(2, { defaultUnit: 'piece', gramsPerPiece: 0 })).toBe(60)
  })
})
