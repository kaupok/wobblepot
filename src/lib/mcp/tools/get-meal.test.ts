import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    meal: { findFirst: vi.fn() },
    mealPlanEntry: { findFirst: vi.fn() },
    mealPlanEntryComponent: { findMany: vi.fn() },
  },
}))

import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { getMeal } from './get-meal'

const household = mcpHousehold({ id: 'household-1', locale: 'en' })
const ctx = { userId: 'user-1', household, scopes: READ_SCOPES }

function ingredient(overrides: Record<string, unknown>) {
  return {
    id: 'ing',
    name: 'Ingredient',
    defaultUnit: 'g',
    measuredByVolume: false,
    gramsPerPiece: null,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    translations: [],
    ...overrides,
  }
}

const MEAL = {
  id: 'meal-1',
  name: 'Chicken and rice',
  description: 'A quick dinner.',
  preparationNotes: 'Cook the rice. Fry the chicken.',
  timeMinutes: 30,
  servings: 4,
  suitableFor: ['dinner'],
  householdId: null,
  primaryProteinType: 'poultry',
  proteinTypeOverride: null,
  translations: [],
  favoritedBy: [{ id: 'fav-1' }],
  components: [
    {
      ingredientId: 'ing-chicken',
      quantityPerServing: 150,
      isVague: false,
      originalPhrase: null,
      ingredient: ingredient({
        id: 'ing-chicken',
        name: 'Chicken breast',
        calories: 120,
        protein: 22,
      }),
    },
    {
      ingredientId: 'ing-stock',
      quantityPerServing: 200,
      isVague: false,
      originalPhrase: null,
      ingredient: ingredient({ id: 'ing-stock', name: 'Stock', measuredByVolume: true }),
    },
    {
      ingredientId: 'ing-salt',
      quantityPerServing: 1,
      isVague: true,
      originalPhrase: 'a pinch',
      ingredient: ingredient({ id: 'ing-salt', name: 'Salt' }),
    },
  ],
}

function call(mealId = 'meal-1') {
  return runTool(getMeal, ctx, getMeal.inputSchema.parse({ mealId }))
}

describe('get_meal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.meal.findFirst).mockResolvedValue(MEAL as never)
  })

  it("returns the meal with ingredients scaled to the household's servings", async () => {
    const result = await call()

    expect(result.structuredContent).toEqual({
      meal: {
        id: 'meal-1',
        name: 'Chicken and rice',
        description: 'A quick dinner.',
        mealTypes: ['dinner'],
        timeMinutes: 30,
        servings: 2,
        recipeServings: 4,
        ingredients: [
          { name: 'Chicken breast', quantity: 300, unit: 'g', note: null },
          { name: 'Stock', quantity: 400, unit: 'ml', note: null },
          { name: 'Salt', quantity: null, unit: 'g', note: 'a pinch' },
        ],
        preparationNotes: 'Cook the rice. Fry the chicken.',
        // 150 g chicken at 120 kcal and 22 g protein per 100 g; the vague
        // component is skipped.
        nutritionPerServing: { calories: 180, protein: 33, carbs: 0, fat: 0 },
        isOwnRecipe: false,
        isFavorite: true,
        mainProtein: { type: 'poultry', setBy: 'automatic' },
      },
    })
    expect(getMeal.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('answers the servings the amounts are for and the recipe’s stored servings apart (HON-1472)', async () => {
    const threePortions = mcpHousehold({
      id: 'household-1',
      locale: 'en',
      members: Array.from({ length: 3 }, () => ({ preferences: { portionMultiplier: 1 } })),
    } as never)

    const result = await runTool(
      getMeal,
      { ...ctx, household: threePortions },
      getMeal.inputSchema.parse({ mealId: 'meal-1' }),
    )

    const { meal } = result.structuredContent as {
      meal: { servings: number; recipeServings: number; ingredients: { quantity: number }[] }
    }
    expect(meal.recipeServings).toBe(4)
    expect(meal.servings).toBe(3)
    // 150 g chicken a serving, for 3 servings.
    expect(meal.ingredients[0]?.quantity).toBe(450)
  })

  it.each([
    ['with the household’s choice', 'beef', { type: 'beef', setBy: 'household' }],
    ['without a choice', null, { type: 'legume', setBy: 'automatic' }],
  ])('returns the main protein of an own recipe %s', async (_label, override, expected) => {
    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      ...MEAL,
      householdId: 'household-1',
      primaryProteinType: override ?? 'legume',
      proteinTypeOverride: override,
    } as never)

    const result = await call()

    expect(result.structuredContent).toMatchObject({ meal: { mainProtein: expected } })
    expect(vi.mocked(prisma.meal.findFirst).mock.calls[0]![0]!.select).toMatchObject({
      primaryProteinType: true,
      proteinTypeOverride: true,
    })
  })

  it("scales to the servings the caller passes, such as a planned entry's override", async () => {
    const result = await runTool(
      getMeal,
      ctx,
      getMeal.inputSchema.parse({ mealId: 'meal-1', servings: 8 }),
    )

    const meal = (
      result.structuredContent as { meal: { servings: number; ingredients: unknown[] } }
    ).meal
    expect(meal.servings).toBe(8)
    expect(meal.ingredients[0]).toEqual({
      name: 'Chicken breast',
      quantity: 1200,
      unit: 'g',
      note: null,
    })
  })

  describe('for a planned entry', () => {
    const slot = {
      id: 'entry-1',
      mealId: 'meal-1',
      status: 'planned',
      servingOverride: 3,
      cookedServings: null,
      leftoverItems: [],
      meal: null,
    }
    const planned = (input: Record<string, unknown> = {}) =>
      runTool(
        getMeal,
        ctx,
        getMeal.inputSchema.parse({
          mealId: 'meal-1',
          date: '2026-10-20',
          mealType: 'dinner',
          ...input,
        }),
      )
    const ingredientsOf = (result: { structuredContent?: unknown }) =>
      (result.structuredContent as { meal: { servings: number; ingredients: unknown[] } }).meal

    beforeEach(() => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot as never)
      vi.mocked(prisma.mealPlanEntryComponent.findMany).mockResolvedValue([
        // Tofu instead of chicken, no stock, and lime added.
        {
          id: 'c1',
          originalIngredientId: 'ing-chicken',
          replacementIngredientId: 'ing-tofu',
          quantityPerServing: 120,
          replacementIngredient: ingredient({ id: 'ing-tofu', name: 'Tofu' }),
        },
        {
          id: 'c2',
          originalIngredientId: 'ing-stock',
          replacementIngredientId: null,
          quantityPerServing: null,
          replacementIngredient: null,
        },
        {
          id: 'c3',
          originalIngredientId: null,
          replacementIngredientId: 'ing-lime',
          quantityPerServing: 0.5,
          replacementIngredient: ingredient({ id: 'ing-lime', name: 'Lime', defaultUnit: 'piece' }),
        },
      ] as never)
    })

    it("lists the entry's ingredients with its changes merged, at the entry's servings", async () => {
      const meal = ingredientsOf(await planned())

      expect(meal.servings).toBe(3)
      expect(meal.ingredients).toEqual([
        { name: 'Tofu', quantity: 360, unit: 'g', note: null },
        { name: 'Salt', quantity: null, unit: 'g', note: 'a pinch' },
        { name: 'Lime', quantity: 1.5, unit: 'piece', note: null },
      ])
      expect(vi.mocked(prisma.mealPlanEntryComponent.findMany).mock.calls[0]![0]!.where).toEqual({
        entryId: 'entry-1',
      })
    })

    it('scales to the cook servings when a lunch takes 2.5 of the leftovers (HON-1394)', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue({
        ...slot,
        leftoverItems: [{ servings: 2.5 }],
      } as never)

      const meal = ingredientsOf(await planned())

      // 3 own servings plus 2.5: 5.5 × 120 g tofu.
      expect(meal.servings).toBe(5.5)
      expect(meal.ingredients[0]).toEqual({ name: 'Tofu', quantity: 660, unit: 'g', note: null })
    })

    it('answers isError when the slot holds another meal', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue({
        ...slot,
        mealId: 'meal-2',
      } as never)

      const result = await planned()

      expect(result.isError).toBe(true)
      expect(prisma.mealPlanEntryComponent.findMany).not.toHaveBeenCalled()
    })

    it('answers isError for a date without a meal type', async () => {
      const result = await planned({ mealType: undefined })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining('together') })
    })
  })

  it('rejects servings outside 1..50', () => {
    expect(getMeal.inputSchema.safeParse({ mealId: 'meal-1', servings: 0 }).success).toBe(false)
    expect(getMeal.inputSchema.safeParse({ mealId: 'meal-1', servings: 51 }).success).toBe(false)
  })

  it('looks the meal up only among those the household may see or has planned', async () => {
    await call('meal-1')

    const where = vi.mocked(prisma.meal.findFirst).mock.calls[0]![0]!.where
    expect(where).toEqual({
      id: 'meal-1',
      OR: [
        { deletedAt: null, OR: [{ householdId: null }, { householdId: 'household-1' }] },
        // A deleted recipe still on this household's plan stays readable.
        { planEntries: { some: { plan: { householdId: 'household-1' } } } },
      ],
    })
  })

  it('answers isError, not a failure, for a meal it cannot see', async () => {
    vi.mocked(prisma.meal.findFirst).mockResolvedValue(null)

    const result = await call('meal-of-another-household')

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('list_meals') })
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(
      getMeal,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      { mealId: 'meal-1' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(prisma.meal.findFirst).not.toHaveBeenCalled()
  })
})
