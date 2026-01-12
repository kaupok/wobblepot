import { describe, it, expect } from 'vitest'
import { computeMealNutrition, formatDate } from './nutrition'

describe('computeMealNutrition', () => {
  it('computes nutrition from single component', () => {
    const components = [
      {
        quantityPerServing: 150, // 150g
        ingredient: {
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
          calories: 200,
          protein: 20,
          carbs: 0,
          fat: 12,
        },
      },
      {
        quantityPerServing: 200, // Rice
        ingredient: {
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
        },
      },
      {
        quantityPerServing: 100, // Broccoli
        ingredient: {
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
})

describe('formatDate', () => {
  it('formats date to YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(formatDate(date)).toBe('2024-01-15')
  })

  it('handles dates at midnight', () => {
    const date = new Date('2024-12-31T00:00:00.000Z')
    expect(formatDate(date)).toBe('2024-12-31')
  })

  it('handles dates at end of day', () => {
    const date = new Date('2024-06-15T23:59:59.999Z')
    expect(formatDate(date)).toBe('2024-06-15')
  })

  it('handles single-digit months and days with zero padding', () => {
    const date = new Date('2024-01-05T12:00:00.000Z')
    expect(formatDate(date)).toBe('2024-01-05')
  })

  it('handles leap year dates', () => {
    const date = new Date('2024-02-29T12:00:00.000Z')
    expect(formatDate(date)).toBe('2024-02-29')
  })
})
