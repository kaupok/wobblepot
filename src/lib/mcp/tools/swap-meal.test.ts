import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => {
  const prisma = {
    mealPlanEntry: { findFirst: vi.fn(), findMany: vi.fn(), updateManyAndReturn: vi.fn() },
    // A swap drops the entry's ingredient changes in its own transaction (HON-1243).
    mealPlanEntryComponent: { deleteMany: vi.fn() },
    // And a fridge meal's items, since it is a recipe meal after (HON-1277).
    mealPlanEntryItem: { deleteMany: vi.fn() },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(prisma)),
    $queryRaw: vi.fn(),
    favoriteMeal: { findMany: vi.fn() },
    meal: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  }
  return { prisma }
})
vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
  NO_REPEAT_DAYS: 14,
}))
// The avoided ingredients resolve from the tags at read time (HON-1321).
vi.mock('@/lib/household/excluded-ingredients', () => ({
  getExcludedIngredientIds: vi.fn((_householdId: string, tags: string[]) =>
    Promise.resolve(tags.includes('cilantro') ? ['ing-cilantro'] : []),
  ),
}))
vi.mock('@/lib/meal-planning/pantry', () => ({
  getPantryIngredientNames: vi.fn(() => Promise.resolve([])),
}))
// Only the jitter is replaced, as in the suggestion route tests: the ranking
// stays real, so the tool and the routes are compared on the same draw.
vi.mock('@/lib/meal-planning/candidate-score', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meal-planning/candidate-score')>()
  return { ...actual, randomScoreJitter: vi.fn(() => 0) }
})

import { prisma } from '@/lib/prisma'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'
import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { swapMeal } from './swap-meal'

const household = mcpHousehold({
  id: 'household-a',
  preferences: {
    dietaryType: null,
    allergensToAvoid: ['peanuts'],
    excludedIngredients: ['cilantro'],
  } as never,
})
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(swapMeal, caller, swapMeal.inputSchema.parse(input))
}

const DATE = '2026-10-15'

const MEALS: Record<string, { name: string; timeMinutes: number; kidFriendly: boolean }> = {
  'meal-current': { name: 'Fish tacos', timeMinutes: 30, kidFriendly: true },
  'meal-pasta': { name: 'Tomato pasta', timeMinutes: 25, kidFriendly: true },
  'meal-curry': { name: 'Chickpea curry', timeMinutes: 40, kidFriendly: false },
  'meal-soup': { name: 'Lentil soup', timeMinutes: 35, kidFriendly: true },
  'meal-salad': { name: 'Salmon salad', timeMinutes: 15, kidFriendly: false },
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: MEALS[id]!.name,
    kidFriendly: MEALS[id]!.kidFriendly,
    primaryProteinType: 'legumes',
    topIngredients: [],
    isFavorite: false,
    isCustom: false,
    netRating: 0,
    ...overrides,
  }
}

/** The pool `getCandidates` returns: the current meal is in it, as it is in the app. */
const POOL = [
  candidate('meal-current', { primaryProteinType: 'fish' }),
  candidate('meal-pasta', { isFavorite: true }),
  candidate('meal-curry', { isCustom: true, netRating: 2 }),
  candidate('meal-soup'),
  candidate('meal-salad', { primaryProteinType: 'fish' }),
]

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    mealType: 'dinner',
    mealId: 'meal-current',
    status: 'planned',
    rating: 'up',
    meal: {
      id: 'meal-current',
      name: 'Fish tacos',
      timeMinutes: 30,
      primaryProteinType: 'fish',
    },
    ...overrides,
  }
}

const EMPTY_SLOT = { mealId: null, meal: null, rating: null }

describe('swap_meal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot() as never)
    vi.mocked(prisma.mealPlanEntry.findMany).mockResolvedValue([{ mealId: 'meal-recent' }] as never)
    vi.mocked(prisma.favoriteMeal.findMany).mockResolvedValue([{ mealId: 'meal-pasta' }] as never)
    vi.mocked(getCandidates).mockResolvedValue(POOL as never)
    vi.mocked(prisma.meal.findMany).mockImplementation((async ({ where }: never) => {
      const ids = (where as { id: { in: string[] } }).id.in
      return ids.map((id) => ({
        id,
        ...MEALS[id],
        description: null,
        suitableFor: ['dinner'],
        components: [],
        imageStatus: 'none',
        imageUrl: null,
        imageHue: null,
        imagePromptVersion: null,
      }))
    }) as never)
    vi.mocked(prisma.meal.findFirst).mockImplementation((async ({ where }: never) => ({
      id: (where as { id: string }).id,
      components: [],
    })) as never)
    vi.mocked(prisma.meal.findUniqueOrThrow).mockImplementation((async ({ where }: never) => ({
      name: MEALS[(where as { id: string }).id]!.name,
    })) as never)
    vi.mocked(prisma.mealPlanEntry.updateManyAndReturn).mockImplementation((async ({
      data,
    }: never) => [{ ...slot(), meal: undefined, ...(data as object) }]) as never)
  })

  it('answers a read-only token with the reconnect message and reads nothing', async () => {
    const result = await call(
      { date: DATE, mealType: 'dinner', mealId: 'meal-pasta' },
      { ...ctx, scopes: READ_SCOPES },
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.mealPlanEntry.findFirst).not.toHaveBeenCalled()
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it("finds the slot in the caller's own plan by day and meal type", async () => {
    await call({ date: DATE, mealType: 'dinner' })

    const day = parseLocalDate(DATE)
    const nextDay = new Date(day)
    nextDay.setDate(nextDay.getDate() + 1)
    expect(prisma.mealPlanEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          plan: { householdId: 'household-a' },
          date: { gte: day, lt: nextDay },
          mealType: 'dinner',
        },
      }),
    )
  })

  describe('without mealId', () => {
    it('returns the suggestions /regenerate shows for a slot with a meal, and writes nothing', async () => {
      const result = await call({ date: DATE, mealType: 'dinner' })

      expect(result.isError).toBeFalsy()
      const output = result.structuredContent as {
        outcome: string
        meal: unknown
        suggestions: { id: string; isOwnRecipe: boolean; householdRating: string | null }[]
      }
      expect(output.outcome).toBe('suggestions')
      expect(output.meal).toEqual({ id: 'meal-current', name: 'Fish tacos' })

      const app = await suggestForSlot(household, slot() as never, 'swap', 'en')
      expect(output.suggestions.map((s) => s.id)).toEqual(app.map((s) => s.id))
      expect(output.suggestions).toHaveLength(3)
      expect(output.suggestions.map((s) => s.id)).not.toContain('meal-current')
      expect(output.suggestions.find((s) => s.id === 'meal-curry')).toMatchObject({
        isOwnRecipe: true,
        householdRating: 'liked',
      })
      expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
    })

    it('returns the suggestions /suggestions shows for an empty slot', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot(EMPTY_SLOT) as never)

      const result = await call({ date: DATE, mealType: 'dinner' })

      const output = result.structuredContent as {
        meal: unknown
        suggestions: { id: string }[]
      }
      expect(output.meal).toBeNull()
      const app = await suggestForSlot(household, slot(EMPTY_SLOT) as never, 'add', 'en')
      expect(output.suggestions.map((s) => s.id)).toEqual(app.map((s) => s.id))
    })

    it("filters candidates by the household's diet, allergens and avoided ingredients", async () => {
      await call({ date: DATE, mealType: 'dinner' })

      expect(getCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          mealType: 'dinner',
          householdId: 'household-a',
          dietaryType: null,
          allergensToAvoid: ['peanuts'],
          excludedIngredientIds: ['ing-cilantro'],
          recentMealIds: ['meal-recent'],
          favoriteMealIds: ['meal-pasta'],
        }),
      )
    })

    it('returns an empty list when no meal fits the slot', async () => {
      vi.mocked(getCandidates).mockResolvedValue([])

      const result = await call({ date: DATE, mealType: 'dinner' })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ outcome: 'suggestions', suggestions: [] })
    })
  })

  describe('with mealId', () => {
    it('swaps to a suggested meal with the same write as the app route', async () => {
      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-soup' })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({
        outcome: 'swapped',
        date: DATE,
        mealType: 'dinner',
        meal: { id: 'meal-soup', name: 'Lentil soup' },
        suggestions: [],
      })
      // The route test's "clears the rating when the meal is swapped" asserts
      // this exact data shape, and the guard that refuses a completed entry.
      expect(prisma.mealPlanEntry.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: 'entry-1', status: { not: 'completed' } },
        data: {
          mealId: 'meal-soup',
          kind: 'meal',
          preparationTips: null,
          servingOverride: null,
          rating: null,
          adjustmentNote: null,
        },
      })
      // The route's visibility rule: global meals and the household's own.
      expect(prisma.meal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'meal-soup',
            deletedAt: null,
            OR: [{ householdId: null }, { householdId: 'household-a' }],
          },
        }),
      )
    })

    it('fills an empty slot with a meal from the pool', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot(EMPTY_SLOT) as never)

      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-pasta' })

      expect(result.structuredContent).toMatchObject({
        outcome: 'swapped',
        meal: { id: 'meal-pasta', name: 'Tomato pasta' },
      })
      expect(prisma.mealPlanEntry.updateManyAndReturn).toHaveBeenCalledTimes(1)
    })

    it('refuses a meal the suggestions would not offer, and changes nothing', async () => {
      // Not in the pool: an allergen, the diet, or another meal type kept it out.
      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-peanut-stew' })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining('Nothing was changed.'),
      })
      expect(prisma.meal.findFirst).not.toHaveBeenCalled()
      expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
    })

    it('answers unchanged for the meal already planned, and writes nothing', async () => {
      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-current' })

      expect(result.structuredContent).toMatchObject({
        outcome: 'unchanged',
        meal: { id: 'meal-current', name: 'Fish tacos' },
      })
      expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
    })

    it('refuses a meal already cooked', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(
        slot({ status: 'completed' }) as never,
      )

      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-soup' })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining('already cooked') })
      expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
    })

    // The app un-skips the card when it swaps a skipped meal (HON-1125), so
    // the new meal does not show as skipped.
    it('plans the new meal when it swaps a skipped entry', async () => {
      vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(
        slot({ status: 'skipped' }) as never,
      )

      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-soup' })

      expect(result.isError).toBeFalsy()
      expect(prisma.mealPlanEntry.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: 'entry-1', status: { not: 'completed' } },
        data: {
          mealId: 'meal-soup',
          kind: 'meal',
          preparationTips: null,
          servingOverride: null,
          rating: null,
          adjustmentNote: null,
          status: 'planned',
        },
      })
    })

    it('refuses when the meal was cooked while the swap ran', async () => {
      vi.mocked(prisma.mealPlanEntry.updateManyAndReturn).mockResolvedValue([] as never)

      const result = await call({ date: DATE, mealType: 'dinner', mealId: 'meal-soup' })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining('cooked while this ran'),
      })
    })
  })

  it('refuses a slot with no entry, which is how another household sees this one', async () => {
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(null)
    const other = mcpHousehold({ id: 'household-b' })

    const result = await call(
      { date: DATE, mealType: 'dinner', mealId: 'meal-soup' },
      { userId: 'user-b', household: other, scopes: WRITE_SCOPES },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('Nothing is planned for dinner on 2026-10-15'),
    })
    expect(prisma.mealPlanEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ plan: { householdId: 'household-b' } }),
      }),
    )
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })
})
