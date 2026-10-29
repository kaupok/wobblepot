import { describe, expect, it, vi } from 'vitest'

// One plan has no dinner twice, but a family plans from a rotation on purpose
// (HON-1393): Fill leaves out only the dinners already in its range. The rest
// of `fillEmptySlots` is in `fill-plan.test.ts`.

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

function dinnerEntry(dateStr: string, mealId: string) {
  return {
    id: `e-${dateStr}`,
    date: date(dateStr),
    mealType: 'dinner',
    mealId,
    planId: 'plan-1',
    status: 'planned',
    note: null,
    meal: { id: mealId, name: mealId, components: [] },
  }
}

describe('fillEmptySlots candidate pools', () => {
  it("leaves the range's dinners out, and keeps a dinner planned before it", async () => {
    vi.mocked(computeMealSlots).mockReturnValue(createDefaultMealSlots())
    vi.mocked(prisma.mealPlan.findUnique).mockResolvedValue({
      id: 'plan-1',
      householdId: 'household-1',
      entries: [
        dinnerEntry('2026-01-05', 'rotation-chili'),
        dinnerEntry('2026-01-12', 'kept-curry'),
      ],
    } as never)
    const dinners = [
      createCandidate({ id: 'rotation-chili' }),
      createCandidate({ id: 'kept-curry' }),
      createCandidate({ id: 'shared-soup' }),
    ]
    vi.mocked(getCandidates).mockImplementation(async ({ primaryProteinType }) =>
      primaryProteinType ? [] : dinners,
    )

    await expect(fillEmptySlots(fillOptions)).rejects.toThrow('stop after the call')

    const prompt = (vi.mocked(generateObject).mock.calls[0]![0] as { prompt: string }).prompt
    expect(prompt).toContain('rotation-chili')
    expect(prompt).toContain('shared-soup')
    expect(prompt).not.toContain('kept-curry')
  })
})
