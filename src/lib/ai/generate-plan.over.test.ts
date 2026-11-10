import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProteinType } from '@/generated/prisma/enums'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

// Slots that are over on today (HON-1523). The real slot module runs here, so the
// over rule and the protein requirements are computed, not mocked.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    meal: { findMany: vi.fn() },
    mealPlan: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
    favoriteMeal: { findMany: vi.fn() },
    pantryItem: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/env', () => ({ serverEnv: { ANTHROPIC_API_KEY: 'test-api-key' } }))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}))

vi.mock('@/lib/meal-planning/candidates', () => ({ getCandidates: vi.fn() }))
vi.mock('./validate-plan', () => ({ validatePlan: vi.fn() }))
vi.mock('./sampling', () => ({ logAiSample: vi.fn() }))
// Spied, not replaced: the test reads the slots the generator is asked for.
vi.mock('./prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./prompts')>()
  return { ...actual, buildMealPlanRequest: vi.fn(actual.buildMealPlanRequest) }
})

import { generateObject } from 'ai'

import { getCandidates } from '@/lib/meal-planning/candidates'
import { prisma } from '@/lib/prisma'

import { generateMealPlan } from './generate-plan'
import { buildMealPlanRequest } from './prompts'
import type { GeneratePlanOptions } from './types'
import { validatePlan } from './validate-plan'

const mockGenerateObject = vi.mocked(generateObject)
const mockGetCandidates = vi.mocked(getCandidates)
const mockValidatePlan = vi.mocked(validatePlan)
const mockEntryFindMany = vi.mocked(prisma.mealPlanEntry.findMany)
const mockEntryDeleteMany = vi.mocked(prisma.mealPlanEntry.deleteMany)
const mockEntryCreateMany = vi.mocked(prisma.mealPlanEntry.createMany)
const mockMealFindMany = vi.mocked(prisma.meal.findMany)
const mockPlanFindUnique = vi.mocked(prisma.mealPlan.findUnique)
const mockPlanFindUniqueOrThrow = vi.mocked(prisma.mealPlan.findUniqueOrThrow)
const mockTransaction = vi.mocked(prisma.$transaction)

const date = parseLocalDate

// Monday 12 January 2026. Tallinn is UTC+2 in January.
const MONDAY = date('2026-01-12')
const tallinn = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 0, 12, h! - 2, m!))
}

function candidate(id: string, primaryProteinType: ProteinType): CandidateMeal {
  return {
    id,
    name: id,
    kidFriendly: true,
    primaryProteinType,
    topIngredients: [],
  } as unknown as CandidateMeal
}

function options(overrides: Partial<GeneratePlanOptions>): GeneratePlanOptions {
  return {
    householdId: 'household-1',
    startDate: MONDAY,
    endDate: date('2026-01-13'),
    dietaryType: null,
    allergensToAvoid: [],
    excludedIngredientIds: [],
    restrictions: [],
    locale: 'en',
    timezone: 'Europe/Tallinn',
    weekdayMealTypes: ['breakfast', 'lunch', 'dinner'],
    weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
    ...overrides,
  }
}

/** The AI fills every slot it was asked for. */
function answerEverySlotAsked() {
  mockGenerateObject.mockImplementation((async () => {
    const asked = vi.mocked(buildMealPlanRequest).mock.lastCall![0].slots
    const entries = asked.map((slot, i) => ({
      date: toDateString(slot.date),
      mealType: slot.mealType,
      mealId: `meal-${i}`,
    }))
    mockMealFindMany.mockResolvedValue(
      entries.map((e) => ({
        id: e.mealId,
        name: e.mealId,
        primaryProteinType: ProteinType.poultry,
        kidFriendly: true,
      })) as never,
    )
    return { object: { entries } }
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEntryFindMany.mockResolvedValue([])
  vi.mocked(prisma.favoriteMeal.findMany).mockResolvedValue([])
  vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([])
  mockGetCandidates.mockImplementation(async ({ primaryProteinType }) =>
    primaryProteinType === 'fish'
      ? [candidate('fish-1', ProteinType.fish)]
      : primaryProteinType === 'legume'
        ? [candidate('legume-1', ProteinType.legume)]
        : Array.from({ length: 10 }, (_, i) => candidate(`any-${i}`, ProteinType.poultry)),
  )
  mockValidatePlan.mockReturnValue({ valid: true, errors: [] })
  mockTransaction.mockImplementation(async (fn) => fn(prisma as never) as never)
  mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-1' } as never)
  mockEntryDeleteMany.mockResolvedValue({ count: 0 } as never)
  mockEntryCreateMany.mockResolvedValue({ count: 0 } as never)
  mockPlanFindUniqueOrThrow.mockResolvedValue({ id: 'plan-1', entries: [] } as never)
})

describe('generateMealPlan on a day with slots that are over (HON-1523)', () => {
  // The rows a Generate keeps are read back in `generate-plan.over.db.test.ts`.
  it("at 20:16 generates today's dinner only", async () => {
    answerEverySlotAsked()

    await generateMealPlan(options({ now: tallinn('20:16') }))

    const created = mockEntryCreateMany.mock.calls[0]![0] as {
      data: Array<{ date: Date; mealType: string }>
    }
    expect(created.data.map((e) => e.mealType)).toEqual(['dinner'])
  })

  it.each([
    ['10:59', ['breakfast', 'lunch', 'dinner']],
    ['11:00', ['lunch', 'dinner']],
    ['14:59', ['lunch', 'dinner']],
    ['15:00', ['dinner']],
    ['20:59', ['dinner']],
  ])('at %s generates %j', async (hhmm, expected) => {
    answerEverySlotAsked()

    await generateMealPlan(options({ now: tallinn(hhmm) }))

    const created = mockEntryCreateMany.mock.calls[0]![0] as { data: Array<{ mealType: string }> }
    expect(created.data.map((e) => e.mealType)).toEqual(expected)
  })

  it('makes no AI call at 21:00', async () => {
    await generateMealPlan(options({ now: tallinn('21:00') }))

    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(mockEntryCreateMany).not.toHaveBeenCalled()
  })

  it('places the fish and legume dinners over the dinner dates that are left', async () => {
    answerEverySlotAsked()

    await generateMealPlan(
      options({
        endDate: date('2026-01-19'),
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner'],
        now: tallinn('21:00'),
      }),
    )

    const requirements = mockValidatePlan.mock.calls[0]![1] as Array<{
      date: Date
      proteinType: string
    }>
    // Placed over Tuesday 13 to Sunday 18: fish midweek on Thursday, legume on Saturday.
    // Over the whole week, fish would land on Wednesday 14.
    expect(requirements.map((r) => [r.proteinType, toDateString(r.date)]).sort()).toEqual([
      ['fish', '2026-01-15'],
      ['legume', '2026-01-17'],
    ])
    const created = mockEntryCreateMany.mock.calls[0]![0] as { data: Array<{ date: Date }> }
    expect(created.data).toHaveLength(6)
    expect(created.data.map((e) => e.date.getTime())).not.toContain(MONDAY.getTime())
  })
})
