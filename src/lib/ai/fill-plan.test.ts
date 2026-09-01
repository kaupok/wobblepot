import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProteinType, IngredientCategory } from '@/generated/prisma/enums'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'

// Mock modules before imports
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    meal: {
      findMany: vi.fn(),
    },
    mealPlan: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
    },
    favoriteMeal: {
      findMany: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/env', () => ({
  serverEnv: {
    ANTHROPIC_API_KEY: 'test-api-key',
  },
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}))

vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
  NO_REPEAT_DAYS: 14,
}))

vi.mock('@/lib/meal-planning/slots', () => ({
  computeRequiredSlots: vi.fn(),
  computeMealSlots: vi.fn(),
}))

vi.mock('./validate-plan', () => ({
  validatePlan: vi.fn(),
}))

vi.mock('./repair-plan', () => ({
  repairPlan: vi.fn(),
}))

vi.mock('./sampling', () => ({
  logAiSample: vi.fn(),
}))

// Import after mocks
import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { computeRequiredSlots, computeMealSlots } from '@/lib/meal-planning/slots'
import { validatePlan } from './validate-plan'
import { fillEmptySlots } from './fill-plan'
import { InsufficientCandidatesError, NoEmptySlotsError } from './types'
import { logAiSample } from './sampling'

// Type assertions for mocks
const mockGetCandidates = vi.mocked(getCandidates)
const mockComputeRequiredSlots = vi.mocked(computeRequiredSlots)
const mockComputeMealSlots = vi.mocked(computeMealSlots)
const mockGenerateObject = vi.mocked(generateObject)
const mockValidatePlan = vi.mocked(validatePlan)
const mockMealPlanEntryFindMany = vi.mocked(prisma.mealPlanEntry.findMany)
const mockMealPlanEntryDeleteMany = vi.mocked(prisma.mealPlanEntry.deleteMany)
const mockMealPlanEntryCreateMany = vi.mocked(prisma.mealPlanEntry.createMany)
const mockMealFindMany = vi.mocked(prisma.meal.findMany)
const mockMealPlanFindUnique = vi.mocked(prisma.mealPlan.findUnique)
const mockMealPlanFindUniqueOrThrow = vi.mocked(prisma.mealPlan.findUniqueOrThrow)
const mockMealPlanCreate = vi.mocked(prisma.mealPlan.create)
const mockFavoriteMealFindMany = vi.mocked(prisma.favoriteMeal.findMany)
const mockPantryItemFindMany = vi.mocked(prisma.pantryItem.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockLogAiSample = vi.mocked(logAiSample)

// Create mock prisma object to pass to transaction callbacks
const mockPrisma = {
  mealPlanEntry: {
    findMany: mockMealPlanEntryFindMany,
    deleteMany: mockMealPlanEntryDeleteMany,
    createMany: mockMealPlanEntryCreateMany,
  },
  meal: { findMany: mockMealFindMany },
  mealPlan: {
    findUnique: mockMealPlanFindUnique,
    findUniqueOrThrow: mockMealPlanFindUniqueOrThrow,
    create: mockMealPlanCreate,
  },
  favoriteMeal: { findMany: mockFavoriteMealFindMany },
}

// Helper functions
function date(dateStr: string): Date {
  return parseLocalDate(dateStr)
}

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

function createMockMeals(count: number, startIndex = 1): CandidateMeal[] {
  return Array.from({ length: count }, (_, i) =>
    createCandidate({
      id: `meal-${startIndex + i}`,
      name: `Meal ${startIndex + i}`,
      kidFriendly: i % 2 === 0, // Alternate kid-friendly
    }),
  )
}

// Helper to create default meal slots for a week (Mon-Sun, dinner only)
function createDefaultMealSlots() {
  return [
    { date: date('2026-01-12'), mealType: 'dinner' as const },
    { date: date('2026-01-13'), mealType: 'dinner' as const },
    { date: date('2026-01-14'), mealType: 'dinner' as const },
    { date: date('2026-01-15'), mealType: 'dinner' as const },
    { date: date('2026-01-16'), mealType: 'dinner' as const },
    { date: date('2026-01-17'), mealType: 'dinner' as const },
    { date: date('2026-01-18'), mealType: 'dinner' as const },
  ]
}

describe('fillEmptySlots', () => {
  const fillOptions = {
    planId: 'plan-1',
    householdId: 'household-1',
    startDate: date('2026-01-12'),
    endDate: date('2026-01-19'),
    dietaryType: null,
    allergensToAvoid: [],
    excludedIngredientIds: [],
    restrictions: [],
    locale: 'en',
    weekdayMealTypes: ['dinner' as const],
    weekendMealTypes: ['dinner' as const],
  }

  // Build a plan entry that looks like Prisma's returned shape for `fillEmptySlots`.
  function entry(
    dateStr: string,
    mealType: 'breakfast' | 'lunch' | 'dinner',
    mealId: string | null,
  ) {
    return {
      id: `e-${dateStr}-${mealType}`,
      date: date(dateStr),
      mealType,
      mealId,
      planId: 'plan-1',
      status: 'planned',
      meal: mealId
        ? {
            id: mealId,
            name: `Meal ${mealId}`,
            components: [],
          }
        : null,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockMealPlanEntryFindMany.mockResolvedValue([])
    mockFavoriteMealFindMany.mockResolvedValue([])
    mockPantryItemFindMany.mockResolvedValue([])
    mockComputeMealSlots.mockReturnValue(createDefaultMealSlots())
    mockComputeRequiredSlots.mockReturnValue([])

    mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
    mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
    mockMealPlanEntryCreateMany.mockResolvedValue({ count: 0 } as never)
  })

  it('throws when the plan does not exist', async () => {
    mockMealPlanFindUnique.mockResolvedValueOnce(null)

    await expect(fillEmptySlots(fillOptions)).rejects.toThrow('Plan not found')
  })

  it('throws when the plan belongs to a different household', async () => {
    mockMealPlanFindUnique.mockResolvedValueOnce({
      id: 'plan-1',
      householdId: 'someone-else',
      entries: [],
    } as never)

    await expect(fillEmptySlots(fillOptions)).rejects.toThrow('Plan not found')
  })

  it('throws NoEmptySlotsError when every expected slot is already filled', async () => {
    mockMealPlanFindUnique.mockResolvedValueOnce({
      id: 'plan-1',
      householdId: 'household-1',
      entries: [
        entry('2026-01-12', 'dinner', 'meal-1'),
        entry('2026-01-13', 'dinner', 'meal-2'),
        entry('2026-01-14', 'dinner', 'meal-3'),
        entry('2026-01-15', 'dinner', 'meal-4'),
        entry('2026-01-16', 'dinner', 'meal-5'),
        entry('2026-01-17', 'dinner', 'meal-6'),
        entry('2026-01-18', 'dinner', 'meal-7'),
      ],
    } as never)

    await expect(fillEmptySlots(fillOptions)).rejects.toBeInstanceOf(NoEmptySlotsError)
  })

  it('throws NoEmptySlotsError when the only empty slot has no candidates', async () => {
    // Switch to lunch so we exercise the non-dinner unfillable path cleanly.
    mockComputeMealSlots.mockReturnValue([{ date: date('2026-01-12'), mealType: 'lunch' as const }])
    mockComputeRequiredSlots.mockReturnValue([])
    mockMealPlanFindUnique.mockResolvedValueOnce({
      id: 'plan-1',
      householdId: 'household-1',
      entries: [],
    } as never)
    // No candidates returned for any meal type — the single lunch slot is unfillable.
    mockGetCandidates.mockResolvedValue([])

    await expect(fillEmptySlots(fillOptions)).rejects.toBeInstanceOf(NoEmptySlotsError)
  })

  it('fills only the empty slot and leaves filled entries untouched', async () => {
    // Six filled dinner entries, one empty slot on 2026-01-18.
    const existing = [
      entry('2026-01-12', 'dinner', 'meal-1'),
      entry('2026-01-13', 'dinner', 'meal-2'),
      entry('2026-01-14', 'dinner', 'meal-3'),
      entry('2026-01-15', 'dinner', 'meal-4'),
      entry('2026-01-16', 'dinner', 'meal-5'),
      entry('2026-01-17', 'dinner', 'meal-6'),
    ]
    mockMealPlanFindUnique
      .mockResolvedValueOnce({
        id: 'plan-1',
        householdId: 'household-1',
        entries: existing,
      } as never)
      // After the transaction, fillEmptySlots re-queries the plan.
      .mockResolvedValueOnce({
        id: 'plan-1',
        entries: [
          ...existing,
          {
            ...entry('2026-01-18', 'dinner', 'meal-new'),
            meal: {
              id: 'meal-new',
              name: 'Meal new',
              kidFriendly: true,
              primaryProteinType: ProteinType.poultry,
              components: [],
            },
          },
        ],
      } as never)

    mockGetCandidates.mockResolvedValue([createCandidate({ id: 'meal-new' })])

    mockGenerateObject.mockResolvedValue({
      object: {
        entries: [{ date: '2026-01-18', mealType: 'dinner', mealId: 'meal-new' }],
      },
    } as never)

    mockMealFindMany.mockResolvedValue([
      {
        id: 'meal-new',
        name: 'Meal new',
        primaryProteinType: ProteinType.poultry,
        kidFriendly: true,
      },
    ] as never)

    mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

    const result = await fillEmptySlots(fillOptions)

    expect(result.entries).toHaveLength(7)
    // Only one new entry gets created by the transaction.
    expect(mockMealPlanEntryCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ mealId: 'meal-new', date: date('2026-01-18') })],
    })
  })

  it('deletes orphan null-mealId entries that overlap with fillable empty slots', async () => {
    const orphanEntry = { ...entry('2026-01-18', 'dinner', null), id: 'orphan-id' }
    const existing = [
      entry('2026-01-12', 'dinner', 'meal-1'),
      entry('2026-01-13', 'dinner', 'meal-2'),
      entry('2026-01-14', 'dinner', 'meal-3'),
      entry('2026-01-15', 'dinner', 'meal-4'),
      entry('2026-01-16', 'dinner', 'meal-5'),
      entry('2026-01-17', 'dinner', 'meal-6'),
      orphanEntry,
    ]

    mockMealPlanFindUnique
      .mockResolvedValueOnce({
        id: 'plan-1',
        householdId: 'household-1',
        entries: existing,
      } as never)
      .mockResolvedValueOnce({
        id: 'plan-1',
        entries: [],
      } as never)

    mockGetCandidates.mockResolvedValue([createCandidate({ id: 'meal-new' })])
    mockGenerateObject.mockResolvedValue({
      object: {
        entries: [{ date: '2026-01-18', mealType: 'dinner', mealId: 'meal-new' }],
      },
    } as never)
    mockMealFindMany.mockResolvedValue([
      {
        id: 'meal-new',
        name: 'Meal new',
        primaryProteinType: ProteinType.poultry,
        kidFriendly: true,
      },
    ] as never)
    mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

    await fillEmptySlots(fillOptions)

    expect(mockMealPlanEntryDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan-id'] } },
    })
  })

  it('throws InsufficientCandidatesError when a required protein pool is empty', async () => {
    mockMealPlanFindUnique.mockResolvedValueOnce({
      id: 'plan-1',
      householdId: 'household-1',
      entries: [],
    } as never)
    mockComputeRequiredSlots.mockReturnValue([
      { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
    ])
    // Order: 1. dinner (general), 2. fish, 3. legume — mirror generateMealPlan order.
    mockGetCandidates
      .mockResolvedValueOnce(createMockMeals(10)) // dinner general
      .mockResolvedValueOnce([]) // fish — empty
      .mockResolvedValueOnce([
        createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume }),
      ])

    await expect(fillEmptySlots(fillOptions)).rejects.toThrow(/fish/i)
  })

  it('logs a fill-empty-slots AI sample when locale is non-default', async () => {
    mockMealPlanFindUnique
      .mockResolvedValueOnce({
        id: 'plan-1',
        householdId: 'household-1',
        entries: [],
      } as never)
      .mockResolvedValueOnce({ id: 'plan-1', entries: [] } as never)

    mockGetCandidates.mockResolvedValue([createCandidate({ id: 'meal-new' })])
    const aiEntries = [{ date: '2026-01-18', mealType: 'dinner', mealId: 'meal-new' }]
    mockGenerateObject.mockResolvedValue({ object: { entries: aiEntries } } as never)
    mockMealFindMany.mockResolvedValue([
      {
        id: 'meal-new',
        name: 'Meal new',
        primaryProteinType: ProteinType.poultry,
        kidFriendly: true,
      },
    ] as never)
    mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

    await fillEmptySlots({ ...fillOptions, locale: 'et' }).catch(() => {})

    expect(mockLogAiSample).toHaveBeenCalledTimes(1)
    const args = mockLogAiSample.mock.calls[0]![0]
    expect(args.callSite).toBe('fill-empty-slots')
    expect(args.locale).toBe('et')
    expect(args.output).toEqual({ entries: aiEntries })
  })
})
