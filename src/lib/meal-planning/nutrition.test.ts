import { describe, expect, it } from 'vitest'

import { baseIngredients } from '../../../prisma/seed'
import { newIngredients } from '../../../prisma/seed-expansion'
import { componentGramsPerServing, computeMealNutrition } from './nutrition'

describe('computeMealNutrition', () => {
  // Recipes give pasta in dry grams, so the seed row holds dry values (HON-1473)
  it('counts 100 g of seed pasta at its dry values', () => {
    const pasta = baseIngredients.find((ing) => ing.name === 'pasta')!
    const result = computeMealNutrition([
      { quantityPerServing: 100, ingredient: { ...pasta, defaultUnit: 'g' } },
    ])

    expect(result.calories).toBe(371)
    expect(result.carbs).toBe(75)
  })

  // Meat rows hold raw values, bone-in cuts per 100 g as bought (HON-1479)
  it('counts 100 g of seed chicken breast at USDA raw values', () => {
    const breast = baseIngredients.find((ing) => ing.name === 'chicken breast')!
    const result = computeMealNutrition([
      { quantityPerServing: 100, ingredient: { ...breast, defaultUnit: 'g' } },
    ])

    expect(result.calories).toBe(120)
    expect(result.protein).toBe(22.5)
  })

  it('counts a bone-in thigh recipe at 45-55 g protein a serving', () => {
    // "Kanakintsud potis" for 3: 1000 g bone-in thighs, the vegetables, 15 ml oil
    const seed = (name: string) => ({
      ...[...baseIngredients, ...newIngredients].find((ing) => ing.name === name)!,
      defaultUnit: 'g' as const,
    })
    const recipe: [string, number][] = [
      ['chicken thigh', 1000],
      ['potato', 600],
      ['beetroot', 300],
      ['carrot', 300],
      ['onion', 110],
      ['garlic', 15],
      ['olive oil', 14],
    ]
    const result = computeMealNutrition(
      recipe.map(([name, grams]) => ({ quantityPerServing: grams / 3, ingredient: seed(name) })),
    )

    expect(result.protein).toBeGreaterThanOrEqual(45)
    expect(result.protein).toBeLessThanOrEqual(55)
  })

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
