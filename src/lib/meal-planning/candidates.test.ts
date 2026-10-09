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
  const components = overrides.components ?? [
    { ingredient: { name: 'Chicken', category: IngredientCategory.protein } },
    { ingredient: { name: 'Rice', category: IngredientCategory.carb } },
    { ingredient: { name: 'Broccoli', category: IngredientCategory.vegetable } },
  ]
  return {
    id: overrides.id ?? 'meal-1',
    name: overrides.name ?? 'Test Meal',
    kidFriendly: overrides.kidFriendly ?? false,
    primaryProteinType: overrides.primaryProteinType ?? ProteinType.none,
    householdId: overrides.householdId ?? null,
    components: components.map((c) => ({
      ingredientId: `ing-${c.ingredient.name}`,
      ingredient: { ...c.ingredient, allergens: [] as string[] },
    })),
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
    it('does not filter by time (all meals included regardless of timeMinutes)', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates(baseFilters)

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      // Should not contain time filter
      expect(calledWith?.where?.OR).toBeUndefined()
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

    // HON-1143: a vegan household has 3 seed breakfasts, so one week can use every one of them.
    describe('when the no-repeat window empties the pool', () => {
      type WhereArg = { where: { AND: unknown[] } }
      const andOfCall = (n: number) =>
        (mockFindMany.mock.calls[n]![0] as unknown as WhereArg).where.AND
      const recentMealIds = ['oats', 'toast', 'smoothie']

      it.each(['breakfast', 'lunch'] as const)(
        'falls back to every allowed %s, since breakfast and lunch may repeat',
        async (mealType) => {
          mockFindMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([createMockMeal({ id: 'oats' })] as never)

          const result = await getCandidates({ ...baseFilters, mealType, recentMealIds })

          expect(result.map((m) => m.id)).toEqual(['oats'])
          expect(mockFindMany).toHaveBeenCalledTimes(2)
          expect(andOfCall(0)).toContainEqual({ id: { notIn: recentMealIds } })
          expect(andOfCall(1)).not.toContainEqual(
            expect.objectContaining({ id: expect.anything() }),
          )
        },
      )

      it('falls back when the diet check, not the query, empties the pool', async () => {
        const porridgeWithMilk = createMockMeal({
          id: 'porridge',
          components: [{ ingredient: { name: 'milk', category: IngredientCategory.dairy } }],
        })
        mockFindMany.mockResolvedValueOnce([porridgeWithMilk] as never).mockResolvedValueOnce([
          porridgeWithMilk,
          createMockMeal({
            id: 'oats',
            components: [
              { ingredient: { name: 'rolled oats', category: IngredientCategory.carb } },
            ],
          }),
        ] as never)

        const result = await getCandidates({
          ...baseFilters,
          mealType: 'breakfast',
          dietaryType: 'vegan',
          recentMealIds,
        })

        expect(result.map((m) => m.id)).toEqual(['oats'])
      })

      it('keeps the dinner pool empty, because dinners must not repeat', async () => {
        mockFindMany.mockResolvedValue([])

        const result = await getCandidates({ ...baseFilters, mealType: 'dinner', recentMealIds })

        expect(result).toEqual([])
        expect(mockFindMany).toHaveBeenCalledTimes(1)
      })

      it('does not query again when nothing was excluded', async () => {
        mockFindMany.mockResolvedValue([])

        await getCandidates({ ...baseFilters, mealType: 'breakfast', recentMealIds: [] })

        expect(mockFindMany).toHaveBeenCalledTimes(1)
      })

      it('does not query again when the pool still has a meal', async () => {
        mockFindMany.mockResolvedValue([createMockMeal({ id: 'granola' })] as never)

        await getCandidates({ ...baseFilters, mealType: 'breakfast', recentMealIds })

        expect(mockFindMany).toHaveBeenCalledTimes(1)
      })
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
    it('does not filter by protein type for no preference', async () => {
      mockFindMany.mockResolvedValue([])

      await getCandidates({ ...baseFilters, dietaryType: null })

      const calledWith = mockFindMany.mock.calls[0]?.[0]
      const andClause = calledWith?.where?.AND as unknown[]
      // Should not contain protein type notIn filter for no preference
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

    // HON-1143: the protein-type filter misses a forbidden ingredient that is not the primary protein.
    describe('by ingredient', () => {
      const ingredient = (name: string, category: IngredientCategory) => ({
        ingredient: { name, category },
      })
      const dalWithButter = createMockMeal({
        id: 'dal-butter',
        name: 'Red Lentil Dal',
        primaryProteinType: ProteinType.legume,
        components: [
          ingredient('red lentils', IngredientCategory.protein),
          ingredient('butter', IngredientCategory.dairy),
          ingredient('onion', IngredientCategory.vegetable),
        ],
      })
      const chickpeaCurry = createMockMeal({
        id: 'chickpea-curry',
        name: 'Chickpea Curry',
        primaryProteinType: ProteinType.legume,
        components: [
          ingredient('chickpeas', IngredientCategory.protein),
          ingredient('coconut milk', IngredientCategory.fat),
          ingredient('onion', IngredientCategory.vegetable),
        ],
      })
      const mapoTofu = createMockMeal({
        id: 'mapo-tofu',
        name: 'Mapo Tofu',
        primaryProteinType: ProteinType.legume,
        components: [
          ingredient('firm tofu', IngredientCategory.protein),
          ingredient('pork mince', IngredientCategory.protein),
          ingredient('doubanjiang', IngredientCategory.condiment),
        ],
      })
      const salmon = createMockMeal({
        id: 'salmon',
        name: 'Baked Salmon',
        primaryProteinType: ProteinType.fish,
        components: [
          ingredient('salmon fillet', IngredientCategory.protein),
          ingredient('potato', IngredientCategory.vegetable),
        ],
      })

      it('drops a legume meal with butter for a vegan household', async () => {
        mockFindMany.mockResolvedValue([dalWithButter, chickpeaCurry] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: 'vegan' })

        expect(result.map((m) => m.id)).toEqual(['chickpea-curry'])
      })

      it('drops Mapo Tofu with pork mince for a vegetarian household', async () => {
        mockFindMany.mockResolvedValue([mapoTofu, chickpeaCurry] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: 'vegetarian' })

        expect(result.map((m) => m.id)).toEqual(['chickpea-curry'])
      })

      it('drops Mapo Tofu but keeps fish for a pescatarian household', async () => {
        mockFindMany.mockResolvedValue([mapoTofu, salmon] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: 'pescatarian' })

        expect(result.map((m) => m.id)).toEqual(['salmon'])
      })

      it('keeps every meal when the household has no diet', async () => {
        mockFindMany.mockResolvedValue([dalWithButter, mapoTofu, salmon] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: null })

        expect(result).toHaveLength(3)
      })

      it('ignores allergens, which the database filter owns', async () => {
        const peanutNoodles = createMockMeal({
          id: 'peanut-noodles',
          name: 'Peanut Noodles',
          primaryProteinType: ProteinType.legume,
          components: [ingredient('peanut butter', IngredientCategory.protein)],
        })
        mockFindMany.mockResolvedValue([peanutNoodles] as never)

        const result = await getCandidates({
          ...baseFilters,
          dietaryType: 'vegan',
          allergensToAvoid: ['peanuts'],
        })

        expect(result.map((m) => m.id)).toEqual(['peanut-noodles'])
      })

      it('reads every component with a diet, and shows the AI only the top 3', async () => {
        const fourComponents = createMockMeal({
          components: [
            ingredient('chickpeas', IngredientCategory.protein),
            ingredient('rice', IngredientCategory.carb),
            ingredient('spinach', IngredientCategory.vegetable),
            ingredient('honey', IngredientCategory.condiment),
          ],
        })
        mockFindMany.mockResolvedValue([fourComponents] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: 'vegan' })

        // The fourth component is the forbidden one: a `take: 3` query would have missed it.
        expect(result).toEqual([])
        const components = (
          mockFindMany.mock.calls[0]![0] as unknown as { select: { components: object } }
        ).select.components
        expect(components).not.toHaveProperty('take')
      })

      it('keeps topIngredients to 3 when every component is read', async () => {
        const fourComponents = createMockMeal({
          components: [
            ingredient('chickpeas', IngredientCategory.protein),
            ingredient('rice', IngredientCategory.carb),
            ingredient('spinach', IngredientCategory.vegetable),
            ingredient('garlic', IngredientCategory.vegetable),
          ],
        })
        mockFindMany.mockResolvedValue([fourComponents] as never)

        const result = await getCandidates({ ...baseFilters, dietaryType: 'vegan' })

        expect(result[0]!.topIngredients.map((i) => i.name)).toEqual([
          'chickpeas',
          'rice',
          'spinach',
        ])
      })
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
                ingredientId: true,
                ingredient: {
                  select: { name: true, category: true, allergens: true },
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

describe('preference sorting', () => {
  it('sorts favorites before non-favorites', async () => {
    const systemMeal = createMockMeal({ id: 'system-1', name: 'System Meal', householdId: null })
    const favoriteMeal = createMockMeal({
      id: 'favorite-1',
      name: 'Favorite Meal',
      householdId: null,
    })

    mockFindMany.mockResolvedValue([systemMeal, favoriteMeal] as never)

    const result = await getCandidates({
      ...baseFilters,
      favoriteMealIds: ['favorite-1'],
    })

    expect(result[0]!.name).toBe('Favorite Meal')
    expect(result[0]!.isFavorite).toBe(true)
    expect(result[1]!.name).toBe('System Meal')
    expect(result[1]!.isFavorite).toBe(false)
  })

  it('sorts household meals before system meals', async () => {
    const systemMeal = createMockMeal({ id: 'system-1', name: 'System Meal', householdId: null })
    const customMeal = createMockMeal({
      id: 'custom-1',
      name: 'Custom Meal',
      householdId: 'household-1',
    })

    mockFindMany.mockResolvedValue([systemMeal, customMeal] as never)

    const result = await getCandidates({
      ...baseFilters,
      householdId: 'household-1',
    })

    expect(result[0]!.name).toBe('Custom Meal')
    expect(result[0]!.isCustom).toBe(true)
    expect(result[1]!.name).toBe('System Meal')
    expect(result[1]!.isCustom).toBe(false)
  })

  it('sorts favorites first, then household meals, then system meals', async () => {
    const systemMeal = createMockMeal({ id: 'system-1', name: 'System Meal', householdId: null })
    const customMeal = createMockMeal({
      id: 'custom-1',
      name: 'Custom Meal',
      householdId: 'household-1',
    })
    const favoriteMeal = createMockMeal({
      id: 'favorite-1',
      name: 'Favorite Meal',
      householdId: null,
    })

    // Return in "wrong" order to test sorting
    mockFindMany.mockResolvedValue([systemMeal, favoriteMeal, customMeal] as never)

    const result = await getCandidates({
      ...baseFilters,
      householdId: 'household-1',
      favoriteMealIds: ['favorite-1'],
    })

    // Favorites first (regardless of system vs custom)
    expect(result[0]!.name).toBe('Favorite Meal')
    expect(result[0]!.isFavorite).toBe(true)
    // Then custom meals
    expect(result[1]!.name).toBe('Custom Meal')
    expect(result[1]!.isCustom).toBe(true)
    // Then system meals
    expect(result[2]!.name).toBe('System Meal')
    expect(result[2]!.isCustom).toBe(false)
    expect(result[2]!.isFavorite).toBe(false)
  })

  it('prioritizes favorite custom meals over favorite system meals', async () => {
    const favoriteSystemMeal = createMockMeal({
      id: 'fav-system',
      name: 'Favorite System',
      householdId: null,
    })
    const favoriteCustomMeal = createMockMeal({
      id: 'fav-custom',
      name: 'Favorite Custom',
      householdId: 'household-1',
    })

    mockFindMany.mockResolvedValue([favoriteSystemMeal, favoriteCustomMeal] as never)

    const result = await getCandidates({
      ...baseFilters,
      householdId: 'household-1',
      favoriteMealIds: ['fav-system', 'fav-custom'],
    })

    // Both are favorites, but custom should come first
    expect(result[0]!.name).toBe('Favorite Custom')
    expect(result[1]!.name).toBe('Favorite System')
  })
})

describe('net rating (HON-340)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  type SelectArg = { select: Record<string, unknown> }
  const selectOf = () => (mockFindMany.mock.calls[0]![0] as unknown as SelectArg).select

  it("reads ratings only from the requesting household's own plan entries", async () => {
    mockFindMany.mockResolvedValue([] as never)

    await getCandidates({ ...baseFilters, householdId: 'household-1', includeNetRating: true })

    // The where on the nested relation is the whole cross-household guarantee: a system meal
    // is shared, so an unscoped planEntries read would pull in every household's thumbs.
    expect(selectOf().planEntries).toEqual({
      where: { plan: { householdId: 'household-1' }, rating: { not: null } },
      select: { rating: true },
    })
  })

  it('nets thumbs-up against thumbs-down per meal', async () => {
    mockFindMany.mockResolvedValue([
      {
        ...createMockMeal({ id: 'liked' }),
        planEntries: [{ rating: 'up' }, { rating: 'up' }, { rating: 'down' }],
      },
      {
        ...createMockMeal({ id: 'disliked' }),
        planEntries: [{ rating: 'down' }, { rating: 'down' }],
      },
      { ...createMockMeal({ id: 'unrated' }), planEntries: [] },
    ] as never)

    const result = await getCandidates({
      ...baseFilters,
      householdId: 'household-1',
      includeNetRating: true,
    })

    expect(Object.fromEntries(result.map((c) => [c.id, c.netRating]))).toEqual({
      liked: 1,
      disliked: -2,
      unrated: 0,
    })
  })

  it('does not join ratings unless asked, so plan generation pays nothing for them', async () => {
    mockFindMany.mockResolvedValue([createMockMeal({})] as never)

    const result = await getCandidates({ ...baseFilters, householdId: 'household-1' })

    expect(selectOf()).not.toHaveProperty('planEntries')
    expect(result[0]).not.toHaveProperty('netRating')
  })

  it('never reads ratings without a household to scope them to', async () => {
    mockFindMany.mockResolvedValue([createMockMeal({})] as never)

    const result = await getCandidates({ ...baseFilters, includeNetRating: true })

    expect(selectOf()).not.toHaveProperty('planEntries')
    expect(result[0]).not.toHaveProperty('netRating')
  })
})

describe('constants', () => {
  it('exports MAX_TIME_MINUTES as 60 (deprecated, no longer used)', () => {
    expect(MAX_TIME_MINUTES).toBe(60)
  })

  it('exports NO_REPEAT_DAYS as 14', () => {
    expect(NO_REPEAT_DAYS).toBe(14)
  })
})

describe('getExcludedProteinTypes', () => {
  it('returns empty array for no preference', () => {
    expect(getExcludedProteinTypes(null)).toEqual([])
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
    const dietaryTypes: (DietaryType | null)[] = [null, 'vegetarian', 'vegan', 'pescatarian']
    for (const type of dietaryTypes) {
      expect(() => getExcludedProteinTypes(type)).not.toThrow()
    }
  })
})
