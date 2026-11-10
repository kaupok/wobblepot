import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProteinType } from '@/generated/prisma/enums'

// Fill days leaves a slot on today that is over untouched (HON-1523). The real
// slot module runs here. The rest of `fillEmptySlots` is in `fill-plan.test.ts`.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlan: { findUnique: vi.fn() },
    meal: { findMany: vi.fn() },
    favoriteMeal: { findMany: vi.fn() },
    pantryItem: { findMany: vi.fn() },
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
vi.mock('@/lib/meal-plans/fill-entries', () => ({ writeFilledSlots: vi.fn() }))
vi.mock('./sampling', () => ({ logAiSample: vi.fn() }))

import { generateObject } from 'ai'

import { getCandidates } from '@/lib/meal-planning/candidates'
import { writeFilledSlots } from '@/lib/meal-plans/fill-entries'
import { prisma } from '@/lib/prisma'

import { fillEmptySlots } from './fill-plan'
import { createCandidate, date, fillOptions } from './fill-plan.fixtures'
import { NoEmptySlotsError } from './types'

const MONDAY = date('2026-01-12')
// Tallinn is UTC+2 in January.
const tallinn = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 0, 12, h! - 2, m!))
}

const options = {
  ...fillOptions,
  endDate: date('2026-01-13'),
  weekdayMealTypes: ['breakfast' as const, 'lunch' as const, 'dinner' as const],
  weekendMealTypes: ['breakfast' as const, 'lunch' as const, 'dinner' as const],
}

/** Monday's lunch holds a note and no meal; breakfast and dinner have no entry. */
const noteOnlyLunch = {
  id: 'lunch-note',
  date: MONDAY,
  mealType: 'lunch',
  mealId: null,
  kind: 'meal',
  planId: 'plan-1',
  status: 'planned',
  note: 'Leftovers at work',
  meal: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mealPlan.findUnique).mockResolvedValue({
    id: 'plan-1',
    householdId: 'household-1',
    entries: [noteOnlyLunch],
  } as never)
  vi.mocked(prisma.favoriteMeal.findMany).mockResolvedValue([])
  vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([])
  vi.mocked(getCandidates).mockResolvedValue([createCandidate({ id: 'meal-new' })])
  vi.mocked(generateObject).mockResolvedValue({
    object: { entries: [{ date: '2026-01-12', mealType: 'dinner', mealId: 'meal-new' }] },
  } as never)
  vi.mocked(prisma.meal.findMany).mockResolvedValue([
    { id: 'meal-new', name: 'New', primaryProteinType: ProteinType.poultry, kidFriendly: true },
  ] as never)
})

describe('fillEmptySlots on a day with slots that are over (HON-1523)', () => {
  it("at 20:16 fills only today's dinner and keeps the note in the lunch slot", async () => {
    await fillEmptySlots({ ...options, now: tallinn('20:16') })

    expect(vi.mocked(writeFilledSlots)).toHaveBeenCalledTimes(1)
    const [, fills, emptyEntries] = vi.mocked(writeFilledSlots).mock.calls[0]!
    expect(fills.map((f) => f.mealType)).toEqual(['dinner'])
    // The note-only lunch entry is not handed to the write, so its note stays.
    expect(emptyEntries).toEqual([])
  })

  it('fills the note-only lunch at 14:59', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        entries: [
          { date: '2026-01-12', mealType: 'lunch', mealId: 'meal-new' },
          { date: '2026-01-12', mealType: 'dinner', mealId: 'meal-new' },
        ],
      },
    } as never)

    await fillEmptySlots({ ...options, now: tallinn('14:59') })

    const [, fills, emptyEntries] = vi.mocked(writeFilledSlots).mock.calls[0]!
    expect(fills.map((f) => f.mealType)).toEqual(['lunch', 'dinner'])
    expect(emptyEntries.map((e) => e.id)).toEqual(['lunch-note'])
  })

  it('throws NoEmptySlotsError with no AI call when every slot is over', async () => {
    await expect(fillEmptySlots({ ...options, now: tallinn('21:00') })).rejects.toBeInstanceOf(
      NoEmptySlotsError,
    )
    expect(vi.mocked(generateObject)).not.toHaveBeenCalled()
  })
})
