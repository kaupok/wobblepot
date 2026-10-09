import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlan: { findUnique: vi.fn() },
    mealPlanEntry: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { loadPlanEntries } from './load-plan-entries'

const cashews = {
  id: 'ing-cashew',
  name: 'Cashews',
  category: 'nuts_seeds',
  defaultUnit: 'g',
  gramsPerPiece: null,
  measuredByVolume: false,
  allergens: ['nuts'],
  translations: [],
}

function entry(id: string, status: 'planned' | 'completed' | 'skipped') {
  return {
    id,
    date: new Date('2026-10-10T00:00:00Z'),
    mealType: 'dinner',
    status,
    rating: null,
    preparationTips: null,
    note: null,
    noteX: null,
    noteY: null,
    servingOverride: null,
    pantryDeductedAt: null,
    meal: {
      id: 'meal-1',
      name: 'Cashew stir-fry',
      description: null,
      preparationNotes: null,
      kidFriendly: false,
      timeMinutes: 20,
      primaryProteinType: 'legume',
      householdId: null,
      imageUrl: null,
      imageColor: null,
      imagePromptVersion: null,
      translations: [],
      components: [
        {
          ingredientId: cashews.id,
          quantityPerServing: 40,
          isVague: false,
          originalPhrase: null,
          ingredient: cashews,
        },
      ],
    },
  }
}

const NUT_ALLERGY = {
  dietaryType: null,
  allergensToAvoid: ['nuts'],
  excludedIngredients: [],
  excludedIngredientIds: [],
}

const household = { id: 'household-1', locale: 'en', _count: { members: 2 }, members: [] }
const query = {
  startDate: new Date('2026-10-10T00:00:00Z'),
  endDate: new Date('2026-10-17T00:00:00Z'),
}

describe('loadPlanEntries conflicts (HON-1126)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.mealPlan.findUnique).mockResolvedValue({ id: 'plan-1' } as never)
    vi.mocked(prisma.mealPlanEntry.findMany).mockResolvedValue([
      entry('planned', 'planned'),
      entry('cooked', 'completed'),
      entry('skipped', 'skipped'),
    ] as never)
  })

  it('marks a planned entry, and leaves cooked and skipped ones unmarked', async () => {
    const { entries } = await loadPlanEntries({ ...household, preferences: NUT_ALLERGY }, query)

    expect(Object.fromEntries(entries.map((e) => [e.id, e.conflicts]))).toEqual({
      planned: [{ kind: 'allergen', constraint: 'nuts' }],
      cooked: [],
      skipped: [],
    })
  })

  it('marks nothing when the household has no preferences row', async () => {
    const { entries } = await loadPlanEntries({ ...household, preferences: null }, query)

    expect(entries.every((e) => e.conflicts.length === 0)).toBe(true)
  })
})
