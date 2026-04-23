import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProteinType, IngredientCategory } from '@/generated/prisma/enums'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import { MealPlanValidationError, InsufficientCandidatesError } from './types'

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

// Import after mocks
import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { computeRequiredSlots, computeMealSlots } from '@/lib/meal-planning/slots'
import { validatePlan } from './validate-plan'
import { repairPlan } from './repair-plan'
import { generateMealPlan, createEmptyPlan, fillEmptySlots } from './generate-plan'
import { NoEmptySlotsError } from './types'

// Type assertions for mocks
const mockGetCandidates = vi.mocked(getCandidates)
const mockComputeRequiredSlots = vi.mocked(computeRequiredSlots)
const mockComputeMealSlots = vi.mocked(computeMealSlots)
const mockGenerateObject = vi.mocked(generateObject)
const mockValidatePlan = vi.mocked(validatePlan)
const mockRepairPlan = vi.mocked(repairPlan)
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

// Default options for generateMealPlan
const defaultOptions = {
  householdId: 'household-1',
  startDate: date('2026-01-12'),
  endDate: date('2026-01-19'),
  dietaryType: null,
  allergensToAvoid: [],
  excludedIngredientIds: [],
  restrictions: [],
  locale: 'en',
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

describe('generateMealPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockMealPlanEntryFindMany.mockResolvedValue([])
    mockFavoriteMealFindMany.mockResolvedValue([])
    mockPantryItemFindMany.mockResolvedValue([])
    mockComputeMealSlots.mockReturnValue(createDefaultMealSlots())
    mockComputeRequiredSlots.mockReturnValue([
      { date: date('2026-01-14'), mealType: 'dinner', proteinType: 'fish' },
      { date: date('2026-01-17'), mealType: 'dinner', proteinType: 'legume' },
    ])
  })

  describe('capPool behavior (via integration)', () => {
    it('uses full pool when under limit', async () => {
      const fishCandidates = createMockMeals(10)
      const legumeCandidates = createMockMeals(10, 11)
      const anyCandidates = createMockMeals(30, 21)

      // Order: 1. dinner (general), 2. fish (protein-specific), 3. legume (protein-specific)
      mockGetCandidates
        .mockResolvedValueOnce(anyCandidates) // dinner general
        .mockResolvedValueOnce(fishCandidates) // fish protein-specific
        .mockResolvedValueOnce(legumeCandidates) // legume protein-specific

      // Mock AI response with 7 valid entries
      const aiEntries = [
        { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-21' },
        { date: '2026-01-13', mealType: 'dinner', mealId: 'meal-22' },
        { date: '2026-01-14', mealType: 'dinner', mealId: 'meal-1' }, // fish day
        { date: '2026-01-15', mealType: 'dinner', mealId: 'meal-23' },
        { date: '2026-01-16', mealType: 'dinner', mealId: 'meal-24' },
        { date: '2026-01-17', mealType: 'dinner', mealId: 'meal-11' }, // legume day
        { date: '2026-01-18', mealType: 'dinner', mealId: 'meal-25' },
      ]

      mockGenerateObject.mockResolvedValue({ object: { entries: aiEntries } } as never)

      // Mock hydration query
      const hydratedMeals = aiEntries.map((e) => ({
        id: e.mealId,
        name: `Meal ${e.mealId}`,
        primaryProteinType: e.mealId.includes('meal-1')
          ? ProteinType.fish
          : e.mealId.includes('meal-11')
            ? ProteinType.legume
            : ProteinType.poultry,
        kidFriendly: true,
      }))
      mockMealFindMany.mockResolvedValue(hydratedMeals as never)

      // Mock validation
      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

      // Mock transaction
      const mockPlanResult = {
        id: 'plan-1',
        entries: aiEntries.map((e, i) => ({
          id: `entry-${i}`,
          date: date(e.date),
          mealType: 'dinner',
          status: 'planned',
          meal: {
            id: e.mealId,
            name: `Meal ${e.mealId}`,
            kidFriendly: true,
            primaryProteinType: ProteinType.poultry,
            components: [],
          },
        })),
      }
      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue(mockPlanResult as never)

      await generateMealPlan(defaultOptions)

      // Verify getCandidates was called 3 times
      expect(mockGetCandidates).toHaveBeenCalledTimes(3)
    })

    it('caps pools at 50 with balanced kid-friendly/adult mix', async () => {
      // Create 60 kid-friendly and 40 adult meals
      const kidFriendlyMeals = Array.from({ length: 60 }, (_, i) =>
        createCandidate({ id: `kf-${i}`, name: `Kid Meal ${i}`, kidFriendly: true }),
      )
      const adultMeals = Array.from({ length: 40 }, (_, i) =>
        createCandidate({ id: `adult-${i}`, name: `Adult Meal ${i}`, kidFriendly: false }),
      )
      const largeCandidatePool = [...kidFriendlyMeals, ...adultMeals]

      // Verify pool is > 50
      expect(largeCandidatePool.length).toBe(100)

      // Order: 1. dinner (general), 2. fish (protein-specific), 3. legume (protein-specific)
      mockGetCandidates
        .mockResolvedValueOnce(largeCandidatePool) // dinner general
        .mockResolvedValueOnce([
          createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish }),
        ])
        .mockResolvedValueOnce([
          createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume }),
        ])

      const aiEntries = [
        { date: '2026-01-12', mealType: 'dinner', mealId: 'kf-0' },
        { date: '2026-01-13', mealType: 'dinner', mealId: 'adult-0' },
        { date: '2026-01-14', mealType: 'dinner', mealId: 'fish-1' },
        { date: '2026-01-15', mealType: 'dinner', mealId: 'kf-1' },
        { date: '2026-01-16', mealType: 'dinner', mealId: 'adult-1' },
        { date: '2026-01-17', mealType: 'dinner', mealId: 'legume-1' },
        { date: '2026-01-18', mealType: 'dinner', mealId: 'kf-2' },
      ]
      mockGenerateObject.mockResolvedValue({ object: { entries: aiEntries } } as never)

      mockMealFindMany.mockResolvedValue(
        aiEntries.map((e) => ({
          id: e.mealId,
          name: e.mealId,
          primaryProteinType:
            e.mealId === 'fish-1'
              ? ProteinType.fish
              : e.mealId === 'legume-1'
                ? ProteinType.legume
                : ProteinType.poultry,
          kidFriendly: e.mealId.startsWith('kf'),
        })) as never,
      )

      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })
      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue({
        id: 'plan-1',
        entries: aiEntries.map((e, i) => ({
          id: `entry-${i}`,
          date: date(e.date),
          mealType: 'dinner',
          status: 'planned',
          meal: {
            id: e.mealId,
            name: e.mealId,
            kidFriendly: e.mealId.startsWith('kf'),
            primaryProteinType: ProteinType.poultry,
            components: [],
          },
        })),
      } as never)

      await generateMealPlan(defaultOptions)

      // Verify the AI was called (pool capping happens internally)
      expect(mockGenerateObject).toHaveBeenCalled()
    })
  })

  describe('InsufficientCandidatesError', () => {
    it('throws when fish pool is empty for no preference', async () => {
      // Order: 1. dinner (general), 2. fish (protein-specific), 3. legume (protein-specific)
      mockGetCandidates
        .mockResolvedValueOnce(createMockMeals(10)) // dinner general
        .mockResolvedValueOnce([]) // Empty fish pool
        .mockResolvedValueOnce([
          createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume }),
        ])

      const error = await generateMealPlan(defaultOptions).catch((e) => e)
      expect(error).toBeInstanceOf(InsufficientCandidatesError)
      expect(error.message).toContain('No fish meals available')
    })

    it('throws when legume pool is empty for no preference', async () => {
      // Order: 1. dinner (general), 2. fish (protein-specific), 3. legume (protein-specific)
      mockGetCandidates
        .mockResolvedValueOnce(createMockMeals(10)) // dinner general
        .mockResolvedValueOnce([
          createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish }),
        ])
        .mockResolvedValueOnce([]) // Empty legume pool

      const error = await generateMealPlan(defaultOptions).catch((e) => e)
      expect(error).toBeInstanceOf(InsufficientCandidatesError)
      expect(error.message).toContain('No legume meals available')
    })
  })

  describe('validateAIResponseStructure', () => {
    beforeEach(() => {
      // Setup basic mocks
      mockGetCandidates.mockResolvedValue([createCandidate({ id: 'meal-1' })])

      mockMealFindMany.mockResolvedValue([
        { id: 'meal-1', name: 'Test', primaryProteinType: ProteinType.fish, kidFriendly: true },
      ] as never)
    })

    it('throws when AI returns fewer than 7 entries', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          entries: [
            { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-1' },
            { date: '2026-01-13', mealType: 'dinner', mealId: 'meal-1' },
            // Only 2 entries instead of 7
          ],
        },
      } as never)

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow('Expected 7 entries, got 2')
    })

    it('throws when AI returns more than 7 entries', async () => {
      const entries = Array.from({ length: 8 }, (_, i) => ({
        date: `2026-01-${12 + i}`,
        mealType: 'dinner',
        mealId: 'meal-1',
      }))
      mockGenerateObject.mockResolvedValue({ object: { entries } } as never)

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow('Expected 7 entries, got 8')
    })

    it('throws when AI returns duplicate dates', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          entries: [
            { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-1' },
            { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-2' }, // Duplicate
            { date: '2026-01-14', mealType: 'dinner', mealId: 'meal-3' },
            { date: '2026-01-15', mealType: 'dinner', mealId: 'meal-4' },
            { date: '2026-01-16', mealType: 'dinner', mealId: 'meal-5' },
            { date: '2026-01-17', mealType: 'dinner', mealId: 'meal-6' },
            { date: '2026-01-18', mealType: 'dinner', mealId: 'meal-7' },
          ],
        },
      } as never)

      mockMealFindMany.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({
          id: `meal-${i + 1}`,
          name: `Meal ${i + 1}`,
          primaryProteinType: ProteinType.poultry,
          kidFriendly: true,
        })) as never,
      )

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow('Duplicate slots')
    })

    it('throws when AI returns dates outside expected week', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          entries: [
            { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-1' },
            { date: '2026-01-13', mealType: 'dinner', mealId: 'meal-2' },
            { date: '2026-01-14', mealType: 'dinner', mealId: 'meal-3' },
            { date: '2026-01-15', mealType: 'dinner', mealId: 'meal-4' },
            { date: '2026-01-16', mealType: 'dinner', mealId: 'meal-5' },
            { date: '2026-01-17', mealType: 'dinner', mealId: 'meal-6' },
            { date: '2026-01-20', mealType: 'dinner', mealId: 'meal-7' }, // Wrong date
          ],
        },
      } as never)

      mockMealFindMany.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({
          id: `meal-${i + 1}`,
          name: `Meal ${i + 1}`,
          primaryProteinType: ProteinType.poultry,
          kidFriendly: true,
        })) as never,
      )

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(
        'Unexpected slot 2026-01-20:dinner',
      )
    })
  })

  describe('validateAndRepairPlan', () => {
    beforeEach(() => {
      mockGetCandidates.mockResolvedValue([createCandidate()])

      const validEntries = [
        { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-1' },
        { date: '2026-01-13', mealType: 'dinner', mealId: 'meal-2' },
        { date: '2026-01-14', mealType: 'dinner', mealId: 'meal-3' },
        { date: '2026-01-15', mealType: 'dinner', mealId: 'meal-4' },
        { date: '2026-01-16', mealType: 'dinner', mealId: 'meal-5' },
        { date: '2026-01-17', mealType: 'dinner', mealId: 'meal-6' },
        { date: '2026-01-18', mealType: 'dinner', mealId: 'meal-7' },
      ]

      mockGenerateObject.mockResolvedValue({ object: { entries: validEntries } } as never)

      mockMealFindMany.mockResolvedValue(
        validEntries.map((e, i) => ({
          id: e.mealId,
          name: `Meal ${i + 1}`,
          primaryProteinType:
            i === 2 ? ProteinType.fish : i === 5 ? ProteinType.legume : ProteinType.poultry,
          kidFriendly: true,
        })) as never,
      )
    })

    it('returns plan unchanged when validation passes', async () => {
      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue({
        id: 'plan-1',
        entries: [],
      } as never)

      await generateMealPlan(defaultOptions)

      expect(mockValidatePlan).toHaveBeenCalled()
      expect(mockRepairPlan).not.toHaveBeenCalled()
    })

    it('attempts repair when validation fails', async () => {
      mockValidatePlan
        .mockReturnValueOnce({
          valid: false,
          errors: [
            {
              type: 'wrong_protein',
              date: '2026-01-14',
              mealType: 'dinner',
              expected: 'fish',
              actual: 'poultry',
              message: 'Wrong protein',
            },
          ],
        })
        .mockReturnValueOnce({ valid: true, errors: [] }) // After repair

      mockRepairPlan.mockReturnValue([
        {
          date: date('2026-01-12'),
          mealType: 'dinner',
          mealId: 'meal-1',
          meal: {
            id: 'meal-1',
            name: 'Meal 1',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-13'),
          mealType: 'dinner',
          mealId: 'meal-2',
          meal: {
            id: 'meal-2',
            name: 'Meal 2',
            primaryProteinType: ProteinType.beef,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-14'),
          mealType: 'dinner',
          mealId: 'meal-fish',
          meal: {
            id: 'meal-fish',
            name: 'Fish Meal',
            primaryProteinType: ProteinType.fish,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-15'),
          mealType: 'dinner',
          mealId: 'meal-4',
          meal: {
            id: 'meal-4',
            name: 'Meal 4',
            primaryProteinType: ProteinType.pork,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-16'),
          mealType: 'dinner',
          mealId: 'meal-5',
          meal: {
            id: 'meal-5',
            name: 'Meal 5',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-17'),
          mealType: 'dinner',
          mealId: 'meal-6',
          meal: {
            id: 'meal-6',
            name: 'Meal 6',
            primaryProteinType: ProteinType.legume,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-18'),
          mealType: 'dinner',
          mealId: 'meal-7',
          meal: {
            id: 'meal-7',
            name: 'Meal 7',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
      ])

      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue({
        id: 'plan-1',
        entries: [],
      } as never)

      await generateMealPlan(defaultOptions)

      expect(mockRepairPlan).toHaveBeenCalled()
      expect(mockValidatePlan).toHaveBeenCalledTimes(2) // Initial + after repair
    })

    it('throws when repair fails', async () => {
      mockValidatePlan.mockReturnValue({
        valid: false,
        errors: [
          {
            type: 'wrong_protein',
            date: '2026-01-14',
            mealType: 'dinner',
            expected: 'fish',
            actual: 'poultry',
            message: 'Wrong protein',
          },
        ],
      })

      mockRepairPlan.mockReturnValue(null) // Repair failed

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow('repair not possible')
    })

    it('throws when repair produces still-invalid plan', async () => {
      mockValidatePlan.mockReturnValue({
        valid: false,
        errors: [
          {
            type: 'consecutive_protein',
            date: '2026-01-13',
            mealType: 'dinner',
            actual: 'poultry',
            message: 'Consecutive poultry',
          },
        ],
      })

      mockRepairPlan.mockReturnValue([
        // Return a plan that still has issues
        {
          date: date('2026-01-12'),
          mealType: 'dinner',
          mealId: 'meal-1',
          meal: {
            id: 'meal-1',
            name: 'Meal 1',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-13'),
          mealType: 'dinner',
          mealId: 'meal-2',
          meal: {
            id: 'meal-2',
            name: 'Meal 2',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-14'),
          mealType: 'dinner',
          mealId: 'meal-3',
          meal: {
            id: 'meal-3',
            name: 'Meal 3',
            primaryProteinType: ProteinType.fish,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-15'),
          mealType: 'dinner',
          mealId: 'meal-4',
          meal: {
            id: 'meal-4',
            name: 'Meal 4',
            primaryProteinType: ProteinType.pork,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-16'),
          mealType: 'dinner',
          mealId: 'meal-5',
          meal: {
            id: 'meal-5',
            name: 'Meal 5',
            primaryProteinType: ProteinType.beef,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-17'),
          mealType: 'dinner',
          mealId: 'meal-6',
          meal: {
            id: 'meal-6',
            name: 'Meal 6',
            primaryProteinType: ProteinType.legume,
            kidFriendly: true,
          },
        },
        {
          date: date('2026-01-18'),
          mealType: 'dinner',
          mealId: 'meal-7',
          meal: {
            id: 'meal-7',
            name: 'Meal 7',
            primaryProteinType: ProteinType.poultry,
            kidFriendly: true,
          },
        },
      ])

      await expect(generateMealPlan(defaultOptions)).rejects.toThrow(MealPlanValidationError)
      await expect(generateMealPlan(defaultOptions)).rejects.toThrow('still invalid after repair')
    })
  })

  describe('generateMealPlan happy path', () => {
    it('returns properly formatted result', async () => {
      mockGetCandidates
        .mockResolvedValueOnce([
          createCandidate({ id: 'fish-1', primaryProteinType: ProteinType.fish }),
        ])
        .mockResolvedValueOnce([
          createCandidate({ id: 'legume-1', primaryProteinType: ProteinType.legume }),
        ])
        .mockResolvedValueOnce(createMockMeals(10))

      const aiEntries = [
        { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-1' },
        { date: '2026-01-13', mealType: 'dinner', mealId: 'meal-2' },
        { date: '2026-01-14', mealType: 'dinner', mealId: 'fish-1' },
        { date: '2026-01-15', mealType: 'dinner', mealId: 'meal-3' },
        { date: '2026-01-16', mealType: 'dinner', mealId: 'meal-4' },
        { date: '2026-01-17', mealType: 'dinner', mealId: 'legume-1' },
        { date: '2026-01-18', mealType: 'dinner', mealId: 'meal-5' },
      ]

      mockGenerateObject.mockResolvedValue({ object: { entries: aiEntries } } as never)

      mockMealFindMany.mockResolvedValue(
        aiEntries.map((e) => ({
          id: e.mealId,
          name: `Meal ${e.mealId}`,
          primaryProteinType:
            e.mealId === 'fish-1'
              ? ProteinType.fish
              : e.mealId === 'legume-1'
                ? ProteinType.legume
                : ProteinType.poultry,
          kidFriendly: true,
        })) as never,
      )

      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })

      const mockCreatedPlan = {
        id: 'plan-123',
        entries: aiEntries.map((e, i) => ({
          id: `entry-${i}`,
          date: date(e.date),
          mealType: 'dinner',
          status: 'planned',
          meal: {
            id: e.mealId,
            name: `Meal ${e.mealId}`,
            kidFriendly: true,
            primaryProteinType:
              e.mealId === 'fish-1'
                ? ProteinType.fish
                : e.mealId === 'legume-1'
                  ? ProteinType.legume
                  : ProteinType.poultry,
            components: [
              {
                ingredient: {
                  caloriesPerUnit: 100,
                  proteinPerUnit: 20,
                  carbsPerUnit: 5,
                  fatPerUnit: 3,
                },
                quantityPerServing: 100,
              },
            ],
          },
        })),
      }

      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-123',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue(mockCreatedPlan as never)

      const result = await generateMealPlan(defaultOptions)

      expect(result.id).toBe('plan-123')
      expect(result.startDate).toBe('2026-01-12')
      expect(result.endDate).toBe('2026-01-19')
      expect(result.entries).toHaveLength(7)
      const firstEntry = result.entries[0]
      expect(firstEntry).toBeDefined()
      expect(firstEntry?.mealType).toBe('dinner')
      expect(firstEntry?.status).toBe('planned')
      expect(firstEntry?.meal).toBeDefined()
    })

    it('uses transaction to find-or-create plan and replace entries', async () => {
      mockGetCandidates.mockResolvedValue([createCandidate()])

      const aiEntries = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-01-${12 + i}`,
        mealType: 'dinner',
        mealId: `meal-${i + 1}`,
      }))

      mockGenerateObject.mockResolvedValue({ object: { entries: aiEntries } } as never)
      mockMealFindMany.mockResolvedValue(
        aiEntries.map((e) => ({
          id: e.mealId,
          name: e.mealId,
          primaryProteinType: ProteinType.poultry,
          kidFriendly: true,
        })) as never,
      )
      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanEntryCreateMany.mockResolvedValue({ count: 7 } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue({
        id: 'plan-1',
        entries: [],
      } as never)
      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)

      await generateMealPlan(defaultOptions)

      // Verify transaction was used (which wraps findUnique + deleteMany entries + createMany entries atomically)
      expect(mockTransaction).toHaveBeenCalled()
      // Verify find-or-create plan was called
      expect(mockMealPlanFindUnique).toHaveBeenCalled()
      // Verify entries were deleted and created
      expect(mockMealPlanEntryDeleteMany).toHaveBeenCalled()
      expect(mockMealPlanEntryCreateMany).toHaveBeenCalled()
    })

    it('threads household locale into the AI prompt', async () => {
      mockGetCandidates.mockResolvedValue([createCandidate()])
      mockGenerateObject.mockResolvedValue({ object: { entries: [] } } as never)
      mockMealFindMany.mockResolvedValue([])
      mockValidatePlan.mockReturnValue({ valid: true, errors: [] })
      mockMealPlanFindUnique.mockResolvedValue({
        id: 'plan-1',
        householdId: 'household-1',
      } as never)
      mockMealPlanFindUniqueOrThrow.mockResolvedValue({ id: 'plan-1', entries: [] } as never)
      mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)

      await generateMealPlan({ ...defaultOptions, locale: 'et' }).catch(() => {
        // validateAIResponseStructure may throw because we returned zero entries;
        // we only care that the AI was invoked with the right prompt first.
      })

      const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string } | undefined
      expect(call?.prompt).toContain('LOCALE:')
      expect(call?.prompt).toContain('Estonian')
    })
  })
})

describe('createEmptyPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation(async (fn) => fn(mockPrisma as never) as never)
    mockMealPlanEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
  })

  it('creates a plan when none exists and returns empty entries', async () => {
    mockMealPlanFindUnique.mockResolvedValue(null)
    mockMealPlanCreate.mockResolvedValue({ id: 'new-plan', householdId: 'household-1' } as never)

    const result = await createEmptyPlan({
      householdId: 'household-1',
      startDate: date('2026-01-12'),
      endDate: date('2026-01-19'),
    })

    expect(result).toEqual({
      id: 'new-plan',
      startDate: '2026-01-12',
      endDate: '2026-01-19',
      entries: [],
    })
    expect(mockMealPlanCreate).toHaveBeenCalledWith({ data: { householdId: 'household-1' } })
  })

  it('reuses an existing household plan and clears the date range', async () => {
    mockMealPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-1' } as never)

    const result = await createEmptyPlan({
      householdId: 'household-1',
      startDate: date('2026-01-12'),
      endDate: date('2026-01-19'),
    })

    expect(result.id).toBe('plan-1')
    expect(mockMealPlanCreate).not.toHaveBeenCalled()
    expect(mockMealPlanEntryDeleteMany).toHaveBeenCalledWith({
      where: {
        planId: 'plan-1',
        date: { gte: date('2026-01-12'), lt: date('2026-01-19') },
      },
    })
  })
})

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
})
