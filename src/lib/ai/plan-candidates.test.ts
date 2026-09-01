import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProteinType, IngredientCategory } from '@/generated/prisma/enums'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: { findMany: vi.fn() },
    favoriteMeal: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
  NO_REPEAT_DAYS: 14,
}))

import { prisma } from '@/lib/prisma'
import { getCandidates } from '@/lib/meal-planning/candidates'
import {
  capPool,
  getFavoriteMealIds,
  getRecentMealIds,
  loadCandidatePools,
} from './plan-candidates'

const mockGetCandidates = vi.mocked(getCandidates)
const mockEntryFindMany = vi.mocked(prisma.mealPlanEntry.findMany)
const mockFavoriteFindMany = vi.mocked(prisma.favoriteMeal.findMany)

function createCandidate(overrides: Partial<CandidateMeal> = {}): CandidateMeal {
  return {
    id: overrides.id ?? 'meal-1',
    name: overrides.name ?? 'Test Meal',
    kidFriendly: overrides.kidFriendly ?? false,
    primaryProteinType: overrides.primaryProteinType ?? ProteinType.poultry,
    topIngredients: overrides.topIngredients ?? [
      { name: 'Chicken', category: IngredientCategory.protein },
    ],
    isFavorite: overrides.isFavorite ?? false,
    isCustom: overrides.isCustom ?? false,
  }
}

function createMeals(count: number, startIndex = 1, kidFriendly?: boolean): CandidateMeal[] {
  return Array.from({ length: count }, (_, i) =>
    createCandidate({
      id: `meal-${startIndex + i}`,
      name: `Meal ${startIndex + i}`,
      kidFriendly: kidFriendly ?? i % 2 === 0,
    }),
  )
}

const dinnerSlot = (dateStr: string) => ({
  date: parseLocalDate(dateStr),
  mealType: 'dinner' as const,
})

const baseOptions = {
  householdId: 'household-1',
  allergensToAvoid: [],
  excludedIngredientIds: [],
  recentMealIds: [],
  dietaryType: null,
  favoriteMealIds: [],
}

describe('capPool', () => {
  it('returns the pool untouched when it is under the limit', () => {
    const pool = createMeals(10)
    expect(capPool(pool)).toBe(pool)
  })

  it('caps at 50 with a balanced kid-friendly/adult mix', () => {
    const pool = [...createMeals(40, 1, true), ...createMeals(40, 100, false)]

    const capped = capPool(pool)

    expect(capped).toHaveLength(50)
    expect(capped.filter((m) => m.kidFriendly)).toHaveLength(25)
    expect(capped.filter((m) => !m.kidFriendly)).toHaveLength(25)
  })

  it('backfills with kid-friendly meals when adult meals run out', () => {
    const pool = [...createMeals(60, 1, true), ...createMeals(5, 100, false)]

    const capped = capPool(pool)

    expect(capped).toHaveLength(50)
    expect(capped.filter((m) => !m.kidFriendly)).toHaveLength(5)
    // Deduplication is not the concern here — every entry must be a distinct meal.
    expect(new Set(capped.map((m) => m.id)).size).toBe(50)
  })

  it('honours an explicit limit', () => {
    expect(capPool(createMeals(20), 6)).toHaveLength(6)
  })
})

describe('getRecentMealIds', () => {
  it('drops null meal ids from recent entries', async () => {
    mockEntryFindMany.mockResolvedValueOnce([
      { mealId: 'a' },
      { mealId: null },
      { mealId: 'b' },
    ] as never)

    await expect(getRecentMealIds('household-1')).resolves.toEqual(['a', 'b'])
  })
})

describe('getFavoriteMealIds', () => {
  it('maps favorites to their meal ids', async () => {
    mockFavoriteFindMany.mockResolvedValueOnce([{ mealId: 'x' }, { mealId: 'y' }] as never)

    await expect(getFavoriteMealIds('household-1')).resolves.toEqual(['x', 'y'])
  })
})

describe('loadCandidatePools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries one pool per distinct meal type and returns them in slot order', async () => {
    mockGetCandidates
      .mockResolvedValueOnce(createMeals(3, 1)) // dinner
      .mockResolvedValueOnce(createMeals(2, 10)) // breakfast
      .mockResolvedValueOnce([]) // fish
      .mockResolvedValueOnce([]) // legume

    const { candidatesByMealType, mealTypes } = await loadCandidatePools({
      ...baseOptions,
      slots: [
        dinnerSlot('2026-01-12'),
        { date: parseLocalDate('2026-01-13'), mealType: 'breakfast' as const },
        dinnerSlot('2026-01-14'),
      ],
    })

    expect(mealTypes).toEqual(['dinner', 'breakfast'])
    expect(candidatesByMealType.get('dinner')).toHaveLength(3)
    expect(candidatesByMealType.get('breakfast')).toHaveLength(2)
    // 2 meal-type queries + fish + legume
    expect(mockGetCandidates).toHaveBeenCalledTimes(4)
  })

  it('reserves fish and legume meals out of the "any" dinner pool', async () => {
    const fish = createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish })
    const legume = createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume })
    const poultry = createCandidate({ id: 'poultry-1' })

    mockGetCandidates
      .mockResolvedValueOnce([fish, legume, poultry]) // dinner
      .mockResolvedValueOnce([fish]) // fish
      .mockResolvedValueOnce([legume]) // legume

    const { candidatePools, candidatesByMealType } = await loadCandidatePools({
      ...baseOptions,
      slots: [dinnerSlot('2026-01-12')],
    })

    expect(candidatePools.fish.map((m) => m.id)).toEqual(['fish-1'])
    expect(candidatePools.legume.map((m) => m.id)).toEqual(['legume-1'])
    expect(candidatePools.any.map((m) => m.id)).toEqual(['poultry-1'])
    // The non-optional convenience field must be the same Map instance the pools carry.
    expect(candidatePools.byMealType).toBe(candidatesByMealType)
  })

  it('leaves protein pools empty when there are no dinner slots', async () => {
    mockGetCandidates
      .mockResolvedValueOnce(createMeals(3, 1)) // breakfast
      .mockResolvedValueOnce([]) // fish
      .mockResolvedValueOnce([]) // legume

    const { candidatePools } = await loadCandidatePools({
      ...baseOptions,
      slots: [{ date: parseLocalDate('2026-01-12'), mealType: 'breakfast' as const }],
    })

    expect(candidatePools.fish).toEqual([])
    expect(candidatePools.legume).toEqual([])
    expect(candidatePools.any).toEqual([])
  })

  it('threads household filters through to every candidate query', async () => {
    mockGetCandidates.mockResolvedValue([])

    await loadCandidatePools({
      slots: [dinnerSlot('2026-01-12')],
      householdId: 'household-9',
      allergensToAvoid: ['dairy'],
      excludedIngredientIds: ['ing-1'],
      recentMealIds: ['meal-recent'],
      dietaryType: 'vegetarian',
      favoriteMealIds: ['meal-fav'],
    })

    for (const call of mockGetCandidates.mock.calls) {
      expect(call[0]).toMatchObject({
        householdId: 'household-9',
        allergensToAvoid: ['dairy'],
        excludedIngredientIds: ['ing-1'],
        recentMealIds: ['meal-recent'],
        dietaryType: 'vegetarian',
        favoriteMealIds: ['meal-fav'],
      })
    }
  })
})
