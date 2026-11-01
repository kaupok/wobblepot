import { describe, expect, it, vi } from 'vitest'

// A day can hold a meal type the household does not expect (HON-1518). Fill
// still treats that day's expected slots as empty (HON-1541). The rest of
// `fillEmptySlots` is in `fill-plan.test.ts`.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlan: { findUnique: vi.fn() },
    favoriteMeal: { findMany: vi.fn().mockResolvedValue([]) },
    pantryItem: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { ANTHROPIC_API_KEY: 'test-api-key' },
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn().mockRejectedValue(new Error('stop after the call')),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}))

vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
}))

vi.mock('@/lib/meal-planning/slots', () => ({
  computeRequiredSlots: vi.fn().mockReturnValue([]),
  computeMealSlots: vi.fn(),
}))

import { generateObject } from 'ai'

import { getCandidates } from '@/lib/meal-planning/candidates'
import { computeMealSlots } from '@/lib/meal-planning/slots'
import { prisma } from '@/lib/prisma'

import { fillEmptySlots } from './fill-plan'
import { createCandidate, createDefaultMealSlots, date, fillOptions } from './fill-plan.fixtures'
import { loadCandidatePools } from './plan-candidates'
import { buildMealPlanRequest } from './prompts'

function planEntry(dateStr: string, mealType: 'breakfast' | 'dinner', mealId: string) {
  return {
    id: `e-${dateStr}-${mealType}`,
    date: date(dateStr),
    mealType,
    mealId,
    planId: 'plan-1',
    status: 'planned',
    note: null,
    meal: { id: mealId, name: mealId, components: [] },
  }
}

describe('fillEmptySlots off-type entries', () => {
  it("fills Saturday's dinner when Saturday holds only a breakfast", async () => {
    // Dinner-only slots, Mon 2026-01-12 to Sun 2026-01-18. Saturday is 2026-01-17.
    vi.mocked(computeMealSlots).mockReturnValue(createDefaultMealSlots())
    vi.mocked(prisma.mealPlan.findUnique).mockResolvedValue({
      id: 'plan-1',
      householdId: 'household-1',
      entries: [
        planEntry('2026-01-12', 'dinner', 'meal-1'),
        planEntry('2026-01-13', 'dinner', 'meal-2'),
        planEntry('2026-01-14', 'dinner', 'meal-3'),
        planEntry('2026-01-15', 'dinner', 'meal-4'),
        planEntry('2026-01-16', 'dinner', 'meal-5'),
        planEntry('2026-01-17', 'breakfast', 'porridge'),
        planEntry('2026-01-18', 'dinner', 'meal-7'),
      ],
    } as never)
    vi.mocked(getCandidates).mockResolvedValue([createCandidate({ id: 'meal-new' })])

    await expect(fillEmptySlots(fillOptions)).rejects.toThrow('stop after the call')

    // The request to the model asks for Saturday's dinner and nothing else.
    const slots = [{ date: date('2026-01-17'), mealType: 'dinner' as const }]
    const { candidatePools, candidatesByMealType } = await loadCandidatePools({
      slots,
      householdId: fillOptions.householdId,
      allergensToAvoid: [],
      excludedIngredientIds: [],
      dietaryType: null,
      favoriteMealIds: [],
    })
    expect(vi.mocked(generateObject).mock.calls[0]![0]).toMatchObject(
      buildMealPlanRequest({
        startDate: fillOptions.startDate,
        endDate: fillOptions.endDate,
        slots,
        requiredSlots: [],
        candidatePools,
        candidatesByMealType,
        restrictions: [],
        pantryIngredients: [],
        locale: 'en',
      }),
    )
  })
})
