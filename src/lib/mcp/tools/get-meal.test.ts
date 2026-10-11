import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { meal: { findFirst: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { mcpHousehold } from '@/test/mcp'
import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { getMeal } from './get-meal'

const household = mcpHousehold({ id: 'household-1', locale: 'en' })
const ctx = { userId: 'user-1', household }

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
  suitableFor: ['dinner'],
  householdId: null,
  translations: [],
  favoritedBy: [{ id: 'fav-1' }],
  components: [
    {
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
      quantityPerServing: 200,
      isVague: false,
      originalPhrase: null,
      ingredient: ingredient({ id: 'ing-stock', name: 'Stock', measuredByVolume: true }),
    },
    {
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
      },
    })
    expect(getMeal.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('looks the meal up only among those the household may see', async () => {
    await call('meal-1')

    const where = vi.mocked(prisma.meal.findFirst).mock.calls[0]![0]!.where
    expect(where).toEqual({
      AND: [
        { id: 'meal-1' },
        { deletedAt: null, OR: [{ householdId: null }, { householdId: 'household-1' }] },
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
      { userId: 'user-1', household: null },
      { mealId: 'meal-1' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(prisma.meal.findFirst).not.toHaveBeenCalled()
  })
})
