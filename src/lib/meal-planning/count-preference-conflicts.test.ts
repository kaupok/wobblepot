import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { mealPlanEntry: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { countConflictingPlannedEntries } from './count-preference-conflicts'

const mockFindMany = vi.mocked(prisma.mealPlanEntry.findMany)

const NUT_ALLERGY = {
  dietaryType: null,
  allergensToAvoid: ['nuts'],
  excludedIngredients: [],
  excludedIngredientIds: [],
}

const entry = (name: string, allergens: string[], changes: unknown[] = []) => ({
  changes,
  meal: {
    name,
    components: [{ ingredientId: name, quantityPerServing: 50, ingredient: { name, allergens } }],
  },
})

describe('countConflictingPlannedEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // 23:30 UTC on 9 October is already 10 October in Tallinn.
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts the planned meals from the household today that break the preferences', async () => {
    mockFindMany.mockResolvedValue([
      entry('Cashews', ['nuts']),
      entry('Rice', []),
      entry('Walnuts', ['nuts']),
    ] as never)

    const count = await countConflictingPlannedEntries(
      { id: 'household-1', timezone: 'Europe/Tallinn' },
      NUT_ALLERGY,
    )

    expect(count).toBe(2)
    const [args] = mockFindMany.mock.calls[0]!
    expect(args?.where).toEqual({
      plan: { householdId: 'household-1' },
      status: 'planned',
      date: { gte: new Date(2026, 9, 10) },
      mealId: { not: null },
    })
  })

  // The cards judge the entry's merged ingredients (HON-1243), so the count
  // does too: a dinner whose nuts were replaced no longer conflicts, and
  // one with peanuts added does.
  it("judges each entry's ingredients with its own changes merged", async () => {
    mockFindMany.mockResolvedValue([
      entry(
        'Stir fry',
        ['nuts'],
        [
          {
            id: 'c1',
            originalIngredientId: 'Stir fry',
            replacementIngredientId: 'Tofu',
            quantityPerServing: 40,
            replacementIngredient: { name: 'Tofu', allergens: [] },
          },
        ],
      ),
      entry(
        'Rice',
        [],
        [
          {
            id: 'c2',
            originalIngredientId: null,
            replacementIngredientId: 'Peanuts',
            quantityPerServing: 20,
            replacementIngredient: { name: 'Peanuts', allergens: ['nuts'] },
          },
        ],
      ),
    ] as never)

    const count = await countConflictingPlannedEntries(
      { id: 'household-1', timezone: 'Europe/Tallinn' },
      NUT_ALLERGY,
    )

    expect(count).toBe(1)
  })
})
