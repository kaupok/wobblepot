import { describe, it, expect, vi, beforeEach } from 'vitest'
import { groupByCategory, computeShoppingList, categoryConfig } from './shopping-list'
import type { ShoppingListItem } from './shopping-list'
import { IngredientCategory, Unit } from '@/generated/prisma/enums'

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findMany: vi.fn(),
    },
    householdMember: {
      count: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
    },
  },
}))

// Mock dates module to control "today" in tests
vi.mock('./dates', () => ({
  getStartOfTodayInTimezone: vi.fn(),
}))

// Import mocked prisma for test setup
import { prisma } from '@/lib/prisma'
import { getStartOfTodayInTimezone } from './dates'

const mockFindManyEntries = vi.mocked(prisma.mealPlanEntry.findMany)
const mockCountMembers = vi.mocked(prisma.householdMember.count)
const mockFindManyPantry = vi.mocked(prisma.pantryItem.findMany)
const mockGetStartOfToday = vi.mocked(getStartOfTodayInTimezone)

// Test timezone constant
const TEST_TIMEZONE = 'Europe/Tallinn'

// Helper to create ingredient data
function createIngredient(overrides: Partial<ShoppingListItem['ingredient']> = {}) {
  return {
    id: 'ing-1',
    name: 'Chicken breast',
    category: 'protein' as IngredientCategory,
    defaultUnit: 'g' as Unit,
    gramsPerPiece: null as number | null,
    ...overrides,
  }
}

// Helper to create shopping list item
function createShoppingListItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    ingredientId: 'ing-1',
    ingredient: createIngredient(),
    neededQuantity: 500,
    pantryQuantity: null,
    shoppingQuantity: 500,
    mealCount: 2,
    earliestNeededDate: new Date('2026-01-20'),
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

describe('categoryConfig', () => {
  it('has correct labels for all categories', () => {
    expect(categoryConfig.protein.label).toBe('Proteins')
    expect(categoryConfig.vegetable.label).toBe('Vegetables')
    expect(categoryConfig.fruit.label).toBe('Fruits')
    expect(categoryConfig.dairy.label).toBe('Dairy')
    expect(categoryConfig.carb.label).toBe('Carbs & grains')
    expect(categoryConfig.legume.label).toBe('Legumes')
    expect(categoryConfig.fat.label).toBe('Oils & fats')
    expect(categoryConfig.condiment.label).toBe('Condiments')
    expect(categoryConfig.spice.label).toBe('Spices & seasonings')
  })

  it('has correct ordering (proteins first, spices last)', () => {
    expect(categoryConfig.protein.order).toBe(1)
    expect(categoryConfig.spice.order).toBe(9)
  })
})

describe('groupByCategory', () => {
  it('groups items by ingredient category', () => {
    const items: ShoppingListItem[] = [
      createShoppingListItem({
        ingredientId: 'ing-1',
        ingredient: createIngredient({ id: 'ing-1', name: 'Chicken', category: 'protein' }),
      }),
      createShoppingListItem({
        ingredientId: 'ing-2',
        ingredient: createIngredient({ id: 'ing-2', name: 'Broccoli', category: 'vegetable' }),
      }),
      createShoppingListItem({
        ingredientId: 'ing-3',
        ingredient: createIngredient({ id: 'ing-3', name: 'Salmon', category: 'protein' }),
      }),
    ]

    const result = groupByCategory(items)

    expect(result).toHaveLength(2)
    expect(result[0]!.category).toBe('protein')
    expect(result[0]!.items).toHaveLength(2)
    expect(result[1]!.category).toBe('vegetable')
    expect(result[1]!.items).toHaveLength(1)
  })

  it('sorts groups by category order', () => {
    const items: ShoppingListItem[] = [
      createShoppingListItem({
        ingredient: createIngredient({ category: 'spice', name: 'Paprika' }),
      }),
      createShoppingListItem({
        ingredient: createIngredient({ category: 'protein', name: 'Chicken' }),
      }),
      createShoppingListItem({
        ingredient: createIngredient({ category: 'vegetable', name: 'Carrot' }),
      }),
    ]

    const result = groupByCategory(items)

    expect(result[0]!.category).toBe('protein')
    expect(result[1]!.category).toBe('vegetable')
    expect(result[2]!.category).toBe('spice')
  })

  it('sorts items within a category by earliest needed date', () => {
    const items: ShoppingListItem[] = [
      createShoppingListItem({
        ingredientId: 'ing-1',
        ingredient: createIngredient({ id: 'ing-1', name: 'Zucchini', category: 'vegetable' }),
        earliestNeededDate: new Date('2026-01-22'), // Latest
      }),
      createShoppingListItem({
        ingredientId: 'ing-2',
        ingredient: createIngredient({ id: 'ing-2', name: 'Asparagus', category: 'vegetable' }),
        earliestNeededDate: new Date('2026-01-20'), // Earliest
      }),
      createShoppingListItem({
        ingredientId: 'ing-3',
        ingredient: createIngredient({ id: 'ing-3', name: 'Carrot', category: 'vegetable' }),
        earliestNeededDate: new Date('2026-01-21'), // Middle
      }),
    ]

    const result = groupByCategory(items)

    // Should be sorted by date, not alphabetically
    expect(result[0]!.items[0]!.ingredient.name).toBe('Asparagus') // Jan 20
    expect(result[0]!.items[1]!.ingredient.name).toBe('Carrot') // Jan 21
    expect(result[0]!.items[2]!.ingredient.name).toBe('Zucchini') // Jan 22
  })

  it('includes correct category labels', () => {
    const items: ShoppingListItem[] = [
      createShoppingListItem({
        ingredient: createIngredient({ category: 'dairy' }),
      }),
    ]

    const result = groupByCategory(items)

    expect(result[0]!.categoryLabel).toBe('Dairy')
  })

  it('returns empty array for empty input', () => {
    const result = groupByCategory([])
    expect(result).toEqual([])
  })
})

describe('computeShoppingList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: set "today" to a fixed date for consistent testing
    mockGetStartOfToday.mockReturnValue(new Date('2026-01-20'))
  })

  it('returns full amount for ingredients not in pantry', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Chicken Stir Fry',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-1',
              quantityPerServing: 150,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-1',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    expect(result[0]!.items[0]!.shoppingQuantity).toBe(300) // 150g * 2 people
    expect(result[0]!.items[0]!.neededQuantity).toBe(300)
    expect(result[0]!.items[0]!.pantryQuantity).toBeNull()
  })

  it('skips staple items entirely', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Salad',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-oil',
              quantityPerServing: 15,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-oil',
                name: 'Olive oil',
                category: 'fat',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([
      {
        id: 'pantry-1',
        householdId: 'household-1',
        ingredientId: 'ing-oil',
        quantity: null,
        isStaple: true,
        expiresAt: null,
        updatedAt: new Date(),
      },
    ])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(0)
  })

  it('skips items with quantity = null (assume sufficient)', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Rice Bowl',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-rice',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-rice',
                name: 'Rice',
                category: 'carb',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([
      {
        id: 'pantry-1',
        householdId: 'household-1',
        ingredientId: 'ing-rice',
        quantity: null, // "have some, assume sufficient"
        isStaple: false,
        expiresAt: null,
        updatedAt: new Date(),
      },
    ])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(0)
  })

  it('returns full amount when pantry quantity = 0 (ran out)', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Eggs',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-eggs',
              quantityPerServing: 2,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-eggs',
                name: 'Eggs',
                category: 'protein',
                defaultUnit: 'piece',
                gramsPerPiece: 50,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([
      {
        id: 'pantry-1',
        householdId: 'household-1',
        ingredientId: 'ing-eggs',
        quantity: 0, // "ran out"
        isStaple: false,
        expiresAt: null,
        updatedAt: new Date(),
      },
    ])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    expect(result[0]!.items[0]!.shoppingQuantity).toBe(4) // 2 * 2 people
    expect(result[0]!.items[0]!.pantryQuantity).toBe(0)
  })

  it('calculates difference for partial pantry stock', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Chicken',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-chicken',
              quantityPerServing: 200,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-chicken',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([
      {
        id: 'pantry-1',
        householdId: 'household-1',
        ingredientId: 'ing-chicken',
        quantity: 100, // Have 100g
        isStaple: false,
        expiresAt: null,
        updatedAt: new Date(),
      },
    ])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    // Need 400g (200 * 2), have 100g, so need 300g
    expect(result[0]!.items[0]!.neededQuantity).toBe(400)
    expect(result[0]!.items[0]!.pantryQuantity).toBe(100)
    expect(result[0]!.items[0]!.shoppingQuantity).toBe(300)
  })

  it('skips items when pantry has more than needed', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Rice',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-rice',
              quantityPerServing: 50,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-rice',
                name: 'Rice',
                category: 'carb',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([
      {
        id: 'pantry-1',
        householdId: 'household-1',
        ingredientId: 'ing-rice',
        quantity: 1000, // Have 1kg
        isStaple: false,
        expiresAt: null,
        updatedAt: new Date(),
      },
    ])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    // Need 100g, have 1000g - nothing to buy
    expect(result).toHaveLength(0)
  })

  it('aggregates quantities across multiple meals', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Chicken Meal 1',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-chicken',
              quantityPerServing: 150,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-chicken',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
      {
        id: 'entry-2',
        planId: 'plan-1',
        mealId: 'meal-2',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-2',
          name: 'Chicken Meal 2',
          components: [
            {
              id: 'comp-2',
              mealId: 'meal-2',
              ingredientId: 'ing-chicken',
              quantityPerServing: 200,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-chicken',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    // (150 + 200) * 2 = 700g
    expect(result[0]!.items[0]!.neededQuantity).toBe(700)
    expect(result[0]!.items[0]!.shoppingQuantity).toBe(700)
    expect(result[0]!.items[0]!.mealCount).toBe(2)
  })

  it('only includes planned entries from today or future (excludes completed, skipped, and past)', async () => {
    // The mock will only return planned entries because the query filters by status and date
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date('2026-01-20'), // Today
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Planned Meal',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-1',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-1',
                name: 'Ingredient',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    // Verify the query filtered by planned status AND date within 14-day window
    expect(mockFindManyEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          planId: 'plan-1',
          status: 'planned',
          date: {
            gte: new Date('2026-01-20'),
            lt: new Date('2026-02-03'),
          },
        },
      }),
    )
  })

  it('returns empty result for empty plan', async () => {
    mockFindManyEntries.mockResolvedValue([])
    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(0)
  })

  it('uses default household size when no members found', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Test Meal',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-1',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-1',
                name: 'Test ingredient',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(0) // No members
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    // Default size is 2, so 100 * 2 = 200g
    expect(result[0]!.items[0]!.neededQuantity).toBe(200)
  })

  it('handles entries without a meal (null meal)', async () => {
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: null,
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: null, // No meal assigned
      },
      {
        id: 'entry-2',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: new Date(),
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Real Meal',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-1',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-1',
                name: 'Test ingredient',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    // Should only include ingredients from the entry with a meal
    expect(result).toHaveLength(1)
    expect(result[0]!.items[0]!.neededQuantity).toBe(200)
  })

  it('tracks the earliest needed date for single-meal ingredients', async () => {
    const mealDate = new Date('2026-01-22')
    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: mealDate,
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Test Meal',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-1',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-1',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    expect(result[0]!.items[0]!.earliestNeededDate).toEqual(mealDate)
  })

  it('tracks the earliest needed date when ingredient appears in multiple meals', async () => {
    const earlierDate = new Date('2026-01-20')
    const laterDate = new Date('2026-01-25')

    mockFindManyEntries.mockResolvedValue([
      {
        id: 'entry-1',
        planId: 'plan-1',
        mealId: 'meal-1',
        date: laterDate, // Later meal
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-1',
          name: 'Chicken Stir Fry',
          components: [
            {
              id: 'comp-1',
              mealId: 'meal-1',
              ingredientId: 'ing-chicken',
              quantityPerServing: 150,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-chicken',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
      {
        id: 'entry-2',
        planId: 'plan-1',
        mealId: 'meal-2',
        date: earlierDate, // Earlier meal
        mealType: 'dinner',
        status: 'planned',
        meal: {
          id: 'meal-2',
          name: 'Chicken Salad',
          components: [
            {
              id: 'comp-2',
              mealId: 'meal-2',
              ingredientId: 'ing-chicken',
              quantityPerServing: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
              ingredient: {
                id: 'ing-chicken',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
      },
    ] as never)

    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    const result = await computeShoppingList('plan-1', 'household-1', TEST_TIMEZONE)

    expect(result).toHaveLength(1)
    // Should use the earlier date
    expect(result[0]!.items[0]!.earliestNeededDate).toEqual(earlierDate)
    // Should aggregate quantities from both meals
    expect(result[0]!.items[0]!.mealCount).toBe(2)
  })

  it('passes the timezone to getStartOfTodayInTimezone', async () => {
    mockFindManyEntries.mockResolvedValue([])
    mockCountMembers.mockResolvedValue(2)
    mockFindManyPantry.mockResolvedValue([])

    await computeShoppingList('plan-1', 'household-1', 'America/New_York')

    expect(mockGetStartOfToday).toHaveBeenCalledWith('America/New_York')
  })
})
