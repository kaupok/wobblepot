import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/meals/load-meals', () => ({
  loadMeals: vi.fn(),
  MEALS_DEFAULT_LIMIT: 20,
  MEALS_MAX_LIMIT: 50,
}))

import { loadMeals, type LoadMealsResult } from '@/lib/meals/load-meals'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { listMeals } from './list-meals'

const household = mcpHousehold({ id: 'household-1' })
const ctx = { userId: 'user-1', household, scopes: READ_SCOPES }

const RESULT = {
  total: 2,
  hasMore: false,
  meals: [
    {
      id: 'meal-1',
      name: 'Oat porridge',
      suitableFor: ['breakfast'],
      primaryProteinType: 'none',
      isFavorite: true,
      isCustom: false,
    },
    {
      id: 'meal-2',
      name: 'Grandma’s stew',
      suitableFor: ['lunch', 'dinner'],
      primaryProteinType: 'beef',
      isFavorite: false,
      isCustom: true,
    },
  ],
} as unknown as LoadMealsResult

function call(input: Record<string, unknown> = {}) {
  return runTool(listMeals, ctx, listMeals.inputSchema.parse(input))
}

describe('list_meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadMeals).mockResolvedValue(RESULT)
  })

  it('returns the compact meal shape and the total', async () => {
    const result = await call()

    expect(result.structuredContent).toEqual({
      total: 2,
      meals: [
        {
          id: 'meal-1',
          name: 'Oat porridge',
          mealTypes: ['breakfast'],
          proteinType: 'none',
          isFavorite: true,
          isOwnRecipe: false,
        },
        {
          id: 'meal-2',
          name: 'Grandma’s stew',
          mealTypes: ['lunch', 'dinner'],
          proteinType: 'beef',
          isFavorite: false,
          isOwnRecipe: true,
        },
      ],
    })
    expect(listMeals.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('passes the filters to the shared meal query for this household', async () => {
    await call({ search: '  soup ', mealType: 'dinner', limit: 5 })

    expect(loadMeals).toHaveBeenCalledWith(household, {
      search: 'soup',
      mealType: 'dinner',
      limit: 5,
    })
  })

  it.each([
    ['own', 'custom'],
    ['favourites', 'favorites'],
  ])('passes source %s to the shared meal query as %s', async (source, loadSource) => {
    await call({ source })

    expect(vi.mocked(loadMeals).mock.calls[0]![1]).toEqual({
      search: undefined,
      mealType: undefined,
      limit: 20,
      source: loadSource,
    })
  })

  it('passes no source when the input has none, so every meal is listed as before', async () => {
    await call({})

    expect(vi.mocked(loadMeals).mock.calls[0]![1]).not.toHaveProperty('source')
  })

  it('refuses a source it does not know', () => {
    expect(listMeals.inputSchema.safeParse({ source: 'system' }).success).toBe(false)
  })

  it('defaults the limit to 20 and caps it at 50', () => {
    expect(listMeals.inputSchema.parse({}).limit).toBe(20)
    expect(listMeals.inputSchema.safeParse({ limit: 51 }).success).toBe(false)
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(
      listMeals,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      { limit: 20 },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(loadMeals).not.toHaveBeenCalled()
  })
})
