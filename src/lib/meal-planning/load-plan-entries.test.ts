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
    changes: [],
    items: [],
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

// The timeline payload. These tests moved here from `api/entries/route.test.ts`
// when that route test went to mocking `loadPlanEntries` at the seam (HON-1206).
describe('loadPlanEntries payload', () => {
  const mockPlanFindUnique = vi.mocked(prisma.mealPlan.findUnique)
  const mockEntriesFindMany = vi.mocked(prisma.mealPlanEntry.findMany)

  const timelineHousehold = {
    id: 'household-123',
    locale: 'en',
    preferences: null,
    // Read to tell which cached tips still fit the entry (HON-1040).
    _count: { members: 2 },
    members: [{ preferences: null }, { preferences: null }],
  }

  const load = (
    h: Parameters<typeof loadPlanEntries>[0] = timelineHousehold,
    extra: Partial<Parameters<typeof loadPlanEntries>[1]> = {},
  ) =>
    loadPlanEntries(h, {
      startDate: new Date(2026, 1, 2),
      endDate: new Date(2026, 1, 9),
      ...extra,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)
  })

  it('returns empty entries when household has no plan yet', async () => {
    mockPlanFindUnique.mockResolvedValue(null)

    const data = await load()

    expect(data.entries).toEqual([])
    expect(data.planId).toBeNull()
    expect(mockPlanFindUnique).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
    })
    expect(mockEntriesFindMany).not.toHaveBeenCalled()
  })

  it('scopes query by the household plan id and date range', async () => {
    mockEntriesFindMany.mockResolvedValue([])

    await load()

    expect(mockEntriesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planId: 'plan-1',
          date: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('applies status filter when provided', async () => {
    mockEntriesFindMany.mockResolvedValue([])

    await load(timelineHousehold, { status: 'planned' })

    expect(mockEntriesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ planId: 'plan-1', status: 'planned' }),
      }),
    )
  })

  it('returns formatted entries with meal and components', async () => {
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        pantryDeductedAt: null,
        meal: {
          id: 'meal-1',
          name: 'Spaghetti Bolognese',
          kidFriendly: true,
          timeMinutes: 45,
          preparationNotes: null,
          primaryProteinType: 'red_meat',
          components: [
            {
              ingredientId: 'ing-1',
              quantityPerServing: 150,
              isVague: false,
              originalPhrase: null,
              ingredient: {
                id: 'ing-1',
                name: 'Ground beef',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
                calories: 250,
                protein: 26,
                carbs: 0,
                fat: 17,
              },
            },
          ],
        },
      },
    ] as never)

    const data = await load()

    expect(data.planId).toBe('plan-1')
    expect(data.entries).toHaveLength(1)
    const entry = data.entries[0]!
    expect(entry.id).toBe('entry-1')
    expect(entry.mealType).toBe('dinner')
    expect(entry.status).toBe('planned')
    expect(entry.pantryDeducted).toBe(false)
    expect(entry.meal).not.toBeNull()
    expect(entry.meal!.name).toBe('Spaghetti Bolognese')
    expect(entry.meal!.components).toHaveLength(1)
    expect(entry.meal!.components[0]!.ingredient.name).toBe('Ground beef')
    expect(entry.meal!.nutrition).toBeDefined()
  })

  it.each([
    { householdId: 'household-123', isCustom: true },
    { householdId: null, isCustom: false },
  ])(
    'sends the meal image state, with isCustom $isCustom for householdId $householdId',
    async ({ householdId, isCustom }) => {
      mockEntriesFindMany.mockResolvedValue([
        {
          id: 'entry-1',
          date: new Date('2026-02-03T00:00:00'),
          mealType: 'dinner',
          changes: [],
          items: [],
          status: 'planned',
          rating: null,
          preparationTips: null,
          note: null,
          servingOverride: null,
          pantryDeductedAt: null,
          meal: {
            id: 'meal-1',
            name: 'Spaghetti Bolognese',
            kidFriendly: true,
            timeMinutes: 45,
            preparationNotes: null,
            primaryProteinType: 'red_meat',
            householdId,
            imageUrl: 'https://store.public.blob.vercel-storage.com/meals/meal-1.png',
            imageStatus: 'ready',
            imageHue: 264,
            imagePromptVersion: 'v4',
            components: [],
          },
        },
      ] as never)

      const data = await load()

      expect(data.entries[0]!.meal).toMatchObject({
        isCustom,
        imageUrl: 'https://store.public.blob.vercel-storage.com/meals/meal-1.png',
        imageStatus: 'ready',
        imageHue: 264,
      })
    },
  )

  it('reports pantryDeducted for an entry that was charged, even after a revert', async () => {
    // The card uses this to skip the deduction preview: the server will not
    // charge the entry again, so a preview would promise a change that never
    // happens (HON-651). The raw timestamp stays server-side.
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        pantryDeductedAt: new Date('2026-02-03T19:00:00Z'),
        meal: null,
      },
    ] as never)

    const data = await load()

    expect(data.entries[0]!.pantryDeducted).toBe(true)
    expect(data.entries[0]).not.toHaveProperty('pantryDeductedAt')
  })

  it('returns description (null) for en households without re-translating', async () => {
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        meal: {
          id: 'meal-1',
          name: 'Spaghetti Bolognese',
          description: 'Classic beef ragù over spaghetti.',
          kidFriendly: true,
          timeMinutes: 45,
          preparationNotes: null,
          primaryProteinType: 'red_meat',
          components: [],
        },
      },
    ] as never)

    const data = await load()

    expect(data.entries[0]!.meal!.name).toBe('Spaghetti Bolognese')
    // English household → canonical description passes through unchanged.
    expect(data.entries[0]!.meal!.description).toBe('Classic beef ragù over spaghetti.')
  })

  it('translates seeded meal name + description into the household locale (et)', async () => {
    const et = { ...timelineHousehold, locale: 'et' }
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        meal: {
          id: 'meal-1',
          name: 'Chicken Curry',
          description: 'Creamy chicken curry.',
          kidFriendly: true,
          timeMinutes: 30,
          preparationNotes: null,
          primaryProteinType: 'poultry',
          // Coalesced over the canonical English fields by translateMeal.
          translations: [
            {
              locale: 'et',
              name: 'Kanakarri',
              description: 'Kreemjas kanakarri aromaatsete vürtsidega.',
              preparationNotes: null,
            },
          ],
          components: [
            {
              ingredientId: 'ing-1',
              quantityPerServing: 200,
              isVague: false,
              originalPhrase: null,
              ingredient: {
                id: 'ing-1',
                name: 'chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
                calories: 165,
                protein: 31,
                carbs: 0,
                fat: 4,
                translations: [{ locale: 'et', name: 'kanafilee' }],
              },
            },
          ],
        },
      },
    ] as never)

    const data = await load(et)

    const meal = data.entries[0]!.meal!
    expect(meal.name).toBe('Kanakarri')
    expect(meal.description).toBe('Kreemjas kanakarri aromaatsete vürtsidega.')
    // Ingredient names are localized too (HON-547 review).
    expect(meal.components[0]!.ingredient.name).toBe('kanafilee')
  })

  it('parses stored preparationTips when present', async () => {
    const tips = { steps: ['Simmer'], pitfalls: ['Over-salt'], tip: 'Stir often' }
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: JSON.stringify(tips),
        note: null,
        servingOverride: null,
        meal: null,
      },
    ] as never)

    const data = await load()

    expect(data.entries[0]!.preparationTips).toEqual(tips)
    expect(data.entries[0]!.meal).toBeNull()
  })

  // A meal with notes cached Watch out and Tip only before HON-1259. Served
  // as the cook view's first steps, they would stop it asking for real ones.
  it('drops stored preparationTips with no steps', async () => {
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: JSON.stringify({ pitfalls: ['Over-salt'], tip: 'Stir often' }),
        note: null,
        servingOverride: null,
        meal: null,
      },
    ] as never)

    const data = await load()

    expect(data.entries[0]!.preparationTips).toBeNull()
  })

  // The cook view shows these tips without asking the tips route, so tips
  // priced at other servings must not reach it either (HON-1040).
  it('drops stored preparationTips priced at other servings', async () => {
    const alder = {
      ...timelineHousehold,
      // Two adults and a toddler at 0.5×: 2.5 servings, 3 members.
      _count: { members: 3 },
      members: [1, 1, 0.5].map((portionMultiplier) => ({ preferences: { portionMultiplier } })),
    }
    const tips = { steps: ['Simmer'], pitfalls: ['Over-salt'], tip: 'Stir often' }
    const entry = (id: string, preparationTips: string) => ({
      id,
      date: new Date('2026-02-03T00:00:00'),
      mealType: 'dinner',
      changes: [],
      items: [],
      status: 'planned',
      rating: null,
      preparationTips,
      note: null,
      servingOverride: null,
      meal: null,
    })
    mockEntriesFindMany.mockResolvedValue([
      // Cached before HON-1040: priced at the 3 members.
      entry('legacy', JSON.stringify(tips)),
      entry('priced-at-3', JSON.stringify({ ...tips, servings: 3 })),
      entry('priced-at-2.5', JSON.stringify({ ...tips, servings: 2.5 })),
    ] as never)

    const data = await load(alder)

    expect(data.entries.map((e: { preparationTips: unknown }) => e.preparationTips)).toEqual([
      null,
      null,
      tips,
    ])
  })

  it('handles entries with no meal assigned', async () => {
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-empty',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        changes: [],
        items: [],
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        meal: null,
      },
    ] as never)

    const data = await load()

    expect(data.entries[0]!.meal).toBeNull()
  })
})
