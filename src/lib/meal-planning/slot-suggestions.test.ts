import { beforeEach, describe, expect, it, vi } from 'vitest'

// The ranking behind `/regenerate` (`swap`) and `/suggestions` (`add`). These
// tests moved here from the two route tests when the routes went off Prisma
// (HON-1206); the route tests now mock `suggestForSlot` at the seam.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: { findMany: vi.fn() },
    favoriteMeal: { findMany: vi.fn() },
    meal: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
  NO_REPEAT_DAYS: 14,
}))

vi.mock('@/lib/meal-planning/pantry', () => ({
  getPantryIngredientNames: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/meal-planning/nutrition', () => ({
  computeMealNutrition: vi.fn(() => ({ calories: 350, protein: 25, carbs: 35, fat: 12 })),
}))

// Only the jitter is replaced: the weights and scoreCandidate() stay real, so a test that
// stubs the draw pins the ranking the routes actually ship (HON-709).
vi.mock('@/lib/meal-planning/candidate-score', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meal-planning/candidate-score')>()
  return { ...actual, randomScoreJitter: vi.fn(() => 0) }
})

import { randomScoreJitter } from '@/lib/meal-planning/candidate-score'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { prisma } from '@/lib/prisma'

import {
  type SlotSuggestionEntry,
  type SlotSuggestionHousehold,
  type SlotSuggestionMode,
  suggestForSlot,
} from './slot-suggestions'

const mockFindManyEntries = vi.mocked(prisma.mealPlanEntry.findMany)
const mockFindManyFavorites = vi.mocked(prisma.favoriteMeal.findMany)
const mockFindManyMeals = vi.mocked(prisma.meal.findMany)
const mockGetCandidates = vi.mocked(getCandidates)
const mockRandomJitter = vi.mocked(randomScoreJitter)

const household: SlotSuggestionHousehold = { id: 'household-123', preferences: null }

/** The entry each mode gets: `swap` replaces a poultry meal, `add` fills an empty slot. */
const ENTRIES: Record<SlotSuggestionMode, SlotSuggestionEntry> = {
  swap: {
    id: 'entry-123',
    mealType: 'dinner',
    mealId: 'meal-current',
    meal: { timeMinutes: 30, primaryProteinType: 'poultry' },
  },
  add: { id: 'entry-123', mealType: 'dinner', mealId: null, meal: null },
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    kidFriendly: false,
    primaryProteinType: 'beef',
    topIngredients: [],
    isFavorite: false,
    isCustom: false,
    ...overrides,
  }
}

function mealRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    description: null,
    timeMinutes: 30,
    kidFriendly: false,
    primaryProteinType: 'beef',
    suitableFor: ['dinner'],
    components: [],
    ...overrides,
  }
}

/** Answers every `meal.findMany` by id, so the time lookup and the detail read both resolve. */
function mealRows(rows: Record<string, Record<string, unknown>> = {}) {
  mockFindManyMeals.mockImplementation((({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.map((id) => mealRow(id, rows[id])))) as never)
}

function stubDraws(draws: Record<string, number>) {
  mockRandomJitter.mockImplementation(({ candidateId }) => draws[candidateId] ?? 0)
}

const ids = (alternatives: { id: string }[]) => alternatives.map((a) => a.id)

beforeEach(() => {
  vi.clearAllMocks()
  mockFindManyEntries.mockResolvedValue([])
  mockFindManyFavorites.mockResolvedValue([])
  mockRandomJitter.mockReturnValue(0)
  mealRows()
})

describe.each(['swap', 'add'] as const)('suggestForSlot in %s mode', (mode) => {
  const suggest = (h: SlotSuggestionHousehold = household, entry = ENTRIES[mode]) =>
    suggestForSlot(h, entry, mode, 'en')

  it('returns nothing when no candidate passes the filters', async () => {
    mockGetCandidates.mockResolvedValue([])

    expect(await suggest()).toEqual([])
    expect(mockFindManyMeals).not.toHaveBeenCalled()
  })

  it('returns at most 3 suggestions', async () => {
    mockGetCandidates.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => candidate(`meal-${i}`)) as never,
    )

    expect(await suggest()).toHaveLength(3)
  })

  it('carries the image, the own-recipe mark and the nutrition onto each card', async () => {
    mockGetCandidates.mockResolvedValue([
      candidate('meal-1', { isFavorite: true }),
      candidate('meal-2', { isCustom: true }),
    ] as never)
    mealRows({
      'meal-1': {
        imageUrl: 'https://blob/meal-1.png',
        imageStatus: 'ready',
        imageHue: 145,
        imagePromptVersion: 'v4',
      },
      'meal-2': {
        imageUrl: null,
        imageStatus: 'none',
        imageHue: null,
        preparationNotes: 'Rest it for ten minutes.',
      },
    })

    const alternatives = await suggest()
    const byId = Object.fromEntries(alternatives.map((a) => [a.id, a]))

    // The card tint reads these straight off the payload (HON-746).
    expect(byId['meal-1']).toMatchObject({
      imageUrl: 'https://blob/meal-1.png',
      imageStatus: 'ready',
      imageHue: 145,
      isCustom: false,
      nutrition: { calories: 350, protein: 25, carbs: 35, fat: 12 },
    })
    // The selector marks the household's own recipes (HON-948).
    expect(byId['meal-2']).toMatchObject({ imageUrl: null, imageHue: null, isCustom: true })
    // The cook view the card's name opens shows the recipe's notes (HON-1352).
    expect(byId['meal-2']!.preparationNotes).toBe('Rest it for ten minutes.')
    expect(byId['meal-1']!.preparationNotes).toBeNull()
  })

  describe('tie-break jitter', () => {
    // A first-run household: no favourites, custom meals or pantry, so every candidate ties
    // and the jitter alone decides the top 3.
    const tiedPool = ['meal-a', 'meal-b', 'meal-c', 'meal-d', 'meal-e'].map((id) => candidate(id))

    beforeEach(() => {
      mockGetCandidates.mockResolvedValue(tiedPool as never)
    })

    it('ranks a tied pool exactly by the stubbed jitter', async () => {
      stubDraws({ 'meal-a': 0.1, 'meal-b': 0.4, 'meal-c': 0.2, 'meal-d': 0.3, 'meal-e': 0 })

      expect(ids(await suggest())).toEqual(['meal-b', 'meal-d', 'meal-c'])
      for (const { id } of tiedPool) {
        expect(mockRandomJitter).toHaveBeenCalledWith({
          entryId: 'entry-123',
          dateString: expect.any(String),
          candidateId: id,
        })
      }
    })

    it('can return a different top 3 when the same entry is opened again', async () => {
      stubDraws({ 'meal-a': 0.4, 'meal-b': 0.3, 'meal-c': 0.2, 'meal-d': 0.1, 'meal-e': 0 })
      const first = ids(await suggest())

      stubDraws({ 'meal-a': 0, 'meal-b': 0.1, 'meal-c': 0.2, 'meal-d': 0.3, 'meal-e': 0.4 })
      const second = ids(await suggest())

      expect(first).toEqual(['meal-a', 'meal-b', 'meal-c'])
      expect(second).toEqual(['meal-e', 'meal-d', 'meal-c'])
    })

    // HON-340: the household's own ratings move the ranking by more than any jitter draw.
    it('asks for the household-scoped net rating on the candidate query', async () => {
      await suggest()

      expect(mockGetCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: 'household-123', includeNetRating: true }),
      )
    })

    it('lifts a liked meal and drops a disliked one past the jitter, and says why', async () => {
      mockGetCandidates.mockResolvedValue(
        tiedPool.map((c) => ({
          ...c,
          netRating: c.id === 'meal-a' ? -2 : c.id === 'meal-e' ? 1 : 0,
        })) as never,
      )
      // Jitter alone would pick a, b, c — a highest, e lowest.
      stubDraws({ 'meal-a': 0.49, 'meal-b': 0.3, 'meal-c': 0.2, 'meal-d': 0.1, 'meal-e': 0 })

      const alternatives = await suggest()

      expect(ids(alternatives)).toEqual(['meal-e', 'meal-b', 'meal-c'])
      expect(alternatives[0]!.ratingSignal).toBe('liked')
      expect(alternatives[1]!.ratingSignal).toBeUndefined()
    })

    it('surfaces a disliked meal that still makes the top 3 as disliked', async () => {
      mockGetCandidates.mockResolvedValue(
        tiedPool.slice(0, 2).map((c) => (c.id === 'meal-a' ? { ...c, netRating: -1 } : c)) as never,
      )

      const alternatives = await suggest()

      expect(alternatives.map((a) => a.ratingSignal)).toEqual([undefined, 'disliked'])
    })
  })

  // Generation places the required fish dinner by position in its own range (`pickDay`), so a
  // slot cannot know whether it was reserved for fish and must not restrict by protein at all
  // (HON-892). `slots` and `dates` are not mocked in this file, so a reintroduced recompute
  // would reach `getCandidates` here.
  describe('protein slots (HON-892)', () => {
    function candidateFilters() {
      expect(mockGetCandidates).toHaveBeenCalledTimes(1)
      return mockGetCandidates.mock.calls[0]![0]
    }

    it('offers non-fish meals with no protein filter on the candidate query', async () => {
      mockGetCandidates.mockResolvedValue([
        candidate('meal-salmon', { primaryProteinType: 'fish' }),
        candidate('meal-beef', { primaryProteinType: 'beef' }),
      ] as never)

      const alternatives = await suggest()

      expect(candidateFilters()).not.toHaveProperty('primaryProteinType')
      expect(ids(alternatives)).toContain('meal-beef')
    })

    it("passes the household's dietary type to the candidate query as a hard filter", async () => {
      mockGetCandidates.mockResolvedValue([candidate('meal-lentils')] as never)

      await suggest({
        ...household,
        preferences: { dietaryType: 'vegetarian', allergensToAvoid: [], excludedIngredients: [] },
      })

      expect(candidateFilters()).toMatchObject({ dietaryType: 'vegetarian' })
    })
  })
})

describe('suggestForSlot in swap mode only', () => {
  it('leaves the current meal out', async () => {
    mockGetCandidates.mockResolvedValue([candidate('meal-current')] as never)

    expect(await suggestForSlot(household, ENTRIES.swap, 'swap', 'en')).toEqual([])
  })

  it("ranks a candidate sharing the replaced meal's protein above an otherwise-equal one", async () => {
    // Beef is listed first, so only the protein-type similarity can lift the fish meal.
    mockGetCandidates.mockResolvedValue([
      candidate('meal-beef', { primaryProteinType: 'beef' }),
      candidate('meal-salmon', { primaryProteinType: 'fish' }),
    ] as never)

    const alternatives = await suggestForSlot(
      household,
      { ...ENTRIES.swap, meal: { timeMinutes: 30, primaryProteinType: 'fish' } },
      'swap',
      'en',
    )

    expect(ids(alternatives)).toEqual(['meal-salmon', 'meal-beef'])
  })
})

describe('suggestForSlot in add mode only', () => {
  it('keeps every candidate, with no prep-time lookup', async () => {
    mockGetCandidates.mockResolvedValue([candidate('meal-current')] as never)

    expect(ids(await suggestForSlot(household, ENTRIES.add, 'add', 'en'))).toEqual(['meal-current'])
    // Only the detail read: `add` has no meal to compare prep time against.
    expect(mockFindManyMeals).toHaveBeenCalledTimes(1)
  })
})
