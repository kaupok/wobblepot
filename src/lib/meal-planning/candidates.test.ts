import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCandidates,
  getExcludedProteinTypes,
  MAX_TIME_MINUTES,
  NO_REPEAT_DAYS,
} from './candidates'
import type { CandidateFilters } from './candidates'
import { DietaryType, IngredientCategory, ProteinType } from '@/generated/prisma/enums'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    meal: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const mockFindMany = vi.mocked(prisma.meal.findMany)

// Helper to create mock meal data matching Prisma's select return shape
function createMockMeal(overrides: {
  id?: string
  name?: string
  kidFriendly?: boolean
  primaryProteinType?: ProteinType
  householdId?: string | null
  components?: { ingredient: { name: string; category: IngredientCategory } }[]
}) {
  return {
    id: overrides.id ?? 'meal-1',
    name: overrides.name ?? 'Test Meal',
    kidFriendly: overrides.kidFriendly ?? false,
    primaryProteinType: overrides.primaryProteinType ?? ProteinType.none,
    householdId: overrides.householdId ?? null,
    components: overrides.components ?? [
      { ingredient: { name: 'Chicken', category: IngredientCategory.protein } },
      { ingredient: { name: 'Rice', category: IngredientCategory.carb } },
      { ingredient: { name: 'Broccoli', category: IngredientCategory.vegetable } },
    ],
  }
}

// Base filters for testing
const baseFilters: CandidateFilters = {
  mealType: 'dinner',
  allergensToAvoid: [],
  excludedIngredientIds: [],
  recentMealIds: [],
}

describe('getCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic functionality', () => {
    it('returns transformed meals with correct structure', async () => {
      const mockMeal = createMockMeal({
        id: 'meal-123',
        name: 'Grilled Chicken',
        kidFriendly: true,
        primaryProteinType: ProteinType.poultry,
        householdId: 'household-1', // Custom meal
        components: [
          { ingredient: { name: 'Chicken breast', category: IngredientCategory.protein } },
          { ingredient: { name: 'Olive oil', category: IngredientCategory.fat } },
        ],
      })
      // Type assertion needed because Prisma's findMany return type expects full model,
      // but our select clause returns only selected fields
      mockFindMany.mockResolvedValue([mockMeal] as never)

      const result = await getCandidates(baseFilters)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'meal-123',
        name: 'Grilled Chicken',
        kidFriendly: true,
        primaryProteinType: ProteinType.poultry,
        topIngredients: [
          { name: 'Chicken breast', category: IngredientCategory.protein },
          { name: 'Olive oil', category: IngredientCategory.fat },
        ],
        isFavorite: false,
        isCustom: true,
      })
    })

    it('returns empty array when no meals match', async () => {
      mockFindMany.mockResolvedValue([])

      const result = await getCandidates(baseFilters)

      expect(result).toEqual([])
    })

    it('returns multiple meals', async () => {
      mockFindMany.mockResolvedValue([
        createMockMeal({ id: 'meal-1', name: 'Meal 1' }),
        createMockMeal({ id: 'meal-2', name: 'Meal 2' }),
        createMockMeal({ id: 'meal-3', name: 'Meal 3' }),
      ] as never)

      const result = await getCandidates(baseFilters)

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.name)).toEqual(['Meal 1', 'Meal 2', 'Meal 3'])
    })
  })

  describe('meal type filter', () => {
    it('filters by meal type', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, mealType: 'breakfast' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            suitableFor: { has: 'breakfast' },
          }),
        }),
      )
    })

    it.each(['breakfast', 'lunch', 'dinner'] as const)(
      'supports %s meal type',
      async (mealType) => {
        mockFindMany.mockResolvedValue([])

        await getCandidates({ ...baseFilters, mealType })

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              suitableFor: { has: mealType },
            }),
          }),
        )
      },
    )
  })

  describe('allergen filter', () => {
    it('excludes meals with allergens when allergensToAvoid is not empty', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({
        ...baseFilters,
        allergensToAvoid: ['gluten', 'dairy'],
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              {
                NOT: {
                  components: {
                    some: {
                      ingredient: {
                        allergens: { hasSome: ['gluten', 'dairy'] },
                      },
                    },
                  },
                },
              },
            ]),
          }),
        }),
      )
    })

    it('does not add allergen filter when allergensToAvoid is empty', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, allergensToAvoid: [] })

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain allergen filter
      expect(andClause).not.toContainEqual(
        expect.objectContaining({
          NOT: expect.objectContaining({
            components: expect.objectContaining({
              some: expect.objectContaining({
                ingredient: expect.objectContaining({
                  allergens: expect.anything(),
                }),
              }),
            }),
          }),
        }),
      )
    })
  })

  describe('excluded ingredients filter', () => {
    it('excludes meals with excluded ingredients', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({
        ...baseFilters,
        excludedIngredientIds: ['ing-1', 'ing-2'],
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              {
                NOT: {
                  components: {
                    some: { ingredientId: { in: ['ing-1', 'ing-2'] } },
                  },
                },
              },
            ]),
          }),
        }),
      )
    })

    it('does not add excluded ingredients filter when empty', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, excludedIngredientIds: [] })

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain excluded ingredients filter
      expect(andClause).not.toContainEqual(
        expect.objectContaining({
          NOT: expect.objectContaining({
            components: expect.objectContaining({
              some: expect.objectContaining({
                ingredientId: expect.anything(),
              }),
            }),
          }),
        }),
      )
    })
  })

  describe('time constraint filter', () => {
    it('uses default MAX_TIME_MINUTES when not specified', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ timeMinutes: { lte: MAX_TIME_MINUTES } }, { timeMinutes: null }],
          }),
        }),
      )
    })

    it('uses custom maxTimeMinutes when provided', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, maxTimeMinutes: 30 })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ timeMinutes: { lte: 30 } }, { timeMinutes: null }],
          }),
        }),
      )
    })

    it('includes meals with null timeMinutes', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ timeMinutes: null }]),
          }),
        }),
      )
    })
  })

  describe('recent meals filter', () => {
    it('excludes recent meal IDs', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({
        ...baseFilters,
        recentMealIds: ['meal-a', 'meal-b', 'meal-c'],
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ id: { notIn: ['meal-a', 'meal-b', 'meal-c'] } }]),
          }),
        }),
      )
    })

    it('does not add recent meals filter when empty', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, recentMealIds: [] })

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain id filter
      expect(andClause).not.toContainEqual(expect.objectContaining({ id: expect.anything() }))
    })
  })

  describe('protein type filter', () => {
    it('filters by protein type when specified', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({
        ...baseFilters,
        primaryProteinType: 'fish',
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ primaryProteinType: 'fish' }]),
          }),
        }),
      )
    })

    it('does not filter by protein type when not specified', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain protein type filter
      expect(andClause).not.toContainEqual(
        expect.objectContaining({ primaryProteinType: expect.anything() }),
      )
    })

    it.each([
      'poultry',
      'beef',
      'pork',
      'lamb',
      'fish',
      'eggs',
      'legume',
      'dairy',
      'none',
    ] as const)('supports %s protein type', async (proteinType) => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, primaryProteinType: proteinType })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ primaryProteinType: proteinType }]),
          }),
        }),
      )
    })
  })

  describe('dietary type filter', () => {
    it('does not filter by protein type for omnivore', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, dietaryType: 'omnivore' })

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain protein type notIn filter for omnivore
      expect(andClause).not.toContainEqual(
        expect.objectContaining({
          primaryProteinType: expect.objectContaining({ notIn: expect.anything() }),
        }),
      )
    })

    it('excludes meat, poultry, and fish for vegetarian', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, dietaryType: 'vegetarian' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { primaryProteinType: { notIn: ['poultry', 'beef', 'pork', 'lamb', 'fish'] } },
            ]),
          }),
        }),
      )
    })

    it('excludes all animal products for vegan', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, dietaryType: 'vegan' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              {
                primaryProteinType: {
                  notIn: ['poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'dairy'],
                },
              },
            ]),
          }),
        }),
      )
    })

    it('excludes meat and poultry but allows fish for pescatarian', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, dietaryType: 'pescatarian' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { primaryProteinType: { notIn: ['poultry', 'beef', 'pork', 'lamb'] } },
            ]),
          }),
        }),
      )
    })

    it('does not filter by dietary type when not specified', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain protein type notIn filter when dietary type not specified
      expect(andClause).not.toContainEqual(
        expect.objectContaining({
          primaryProteinType: expect.objectContaining({ notIn: expect.anything() }),
        }),
      )
    })
  })

  describe('combined filters', () => {
    it('applies all filters together', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({
        mealType: 'dinner',
        allergensToAvoid: ['gluten'],
        excludedIngredientIds: ['ing-1'],
        recentMealIds: ['meal-old'],
        primaryProteinType: 'poultry',
        maxTimeMinutes: 45,
      })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            suitableFor: { has: 'dinner' },
            AND: expect.arrayContaining([
              {
                NOT: {
                  components: {
                    some: {
                      ingredient: {
                        allergens: { hasSome: ['gluten'] },
                      },
                    },
                  },
                },
              },
              {
                NOT: {
                  components: {
                    some: { ingredientId: { in: ['ing-1'] } },
                  },
                },
              },
              { id: { notIn: ['meal-old'] } },
              { primaryProteinType: 'poultry' },
            ]),
            OR: [{ timeMinutes: { lte: 45 } }, { timeMinutes: null }],
          }),
        }),
      )
    })
  })

  describe('select clause', () => {
    it('selects minimal payload fields', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            kidFriendly: true,
            primaryProteinType: true,
            householdId: true,
            components: {
              orderBy: { quantityPerServing: 'desc' },
              take: 3,
              select: {
                ingredient: {
                  select: { name: true, category: true },
                },
              },
            },
          },
        }),
      )
    })

    it('orders components by quantityPerServing descending', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            components: expect.objectContaining({
              orderBy: { quantityPerServing: 'desc' },
            }),
          }),
        }),
      )
    })

    it('limits to top 3 components', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            components: expect.objectContaining({
              take: 3,
            }),
          }),
        }),
      )
    })
  })
})

describe('constants', () => {
  it('exports MAX_TIME_MINUTES as 60', () => {
    expect(MAX_TIME_MINUTES).toBe(60)
  })

  it('exports NO_REPEAT_DAYS as 14', () => {
    expect(NO_REPEAT_DAYS).toBe(14)
  })
})

describe('getExcludedProteinTypes', () => {
  it('returns empty array for omnivore', () => {
    expect(getExcludedProteinTypes('omnivore')).toEqual([])
  })

  it('excludes meat, poultry, and fish for vegetarian', () => {
    const excluded = getExcludedProteinTypes('vegetarian')
    expect(excluded).toEqual(['poultry', 'beef', 'pork', 'lamb', 'fish'])
    // Verify allowed types are not excluded
    expect(excluded).not.toContain('eggs')
    expect(excluded).not.toContain('dairy')
    expect(excluded).not.toContain('legume')
    expect(excluded).not.toContain('none')
  })

  it('excludes all animal products for vegan', () => {
    const excluded = getExcludedProteinTypes('vegan')
    expect(excluded).toEqual(['poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'dairy'])
    // Verify allowed types are not excluded
    expect(excluded).not.toContain('legume')
    expect(excluded).not.toContain('none')
  })

  it('excludes meat and poultry but allows fish for pescatarian', () => {
    const excluded = getExcludedProteinTypes('pescatarian')
    expect(excluded).toEqual(['poultry', 'beef', 'pork', 'lamb'])
    // Verify fish is allowed
    expect(excluded).not.toContain('fish')
    // Verify other allowed types
    expect(excluded).not.toContain('eggs')
    expect(excluded).not.toContain('dairy')
    expect(excluded).not.toContain('legume')
    expect(excluded).not.toContain('none')
  })

  it('handles all DietaryType values', () => {
    const dietaryTypes: DietaryType[] = ['omnivore', 'vegetarian', 'vegan', 'pescatarian']
    for (const type of dietaryTypes) {
      expect(() => getExcludedProteinTypes(type)).not.toThrow()
    }
  })
})
