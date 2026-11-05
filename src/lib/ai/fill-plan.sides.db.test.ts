import { describe, expect, it, vi } from 'vitest'

// AI fill on a plan whose slot holds a main and a side (HON-1609). Runs on
// PGlite through the `unit-db` project, with real candidates and slots. Only
// the model call is mocked, so the test reads which dinners the prompt offers.
// The `unit-db` project shares one module cache (`isolate: false`), so this
// file mocks nothing another db test reads.

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn().mockRejectedValue(new Error('stop after the call')),
}))

import { generateObject } from 'ai'

import { prisma } from '@/lib/prisma'

import { fillEmptySlots } from './fill-plan'
import { date, fillOptions } from './fill-plan.fixtures'

describe('fillEmptySlots with a side dish (HON-1609)', () => {
  it("leaves the main's meal out of the pool, and not its side's", async () => {
    await prisma.household.create({
      data: { id: 'household-1', name: 'Alder', mealPlans: { create: { id: 'plan-1' } } },
    })
    for (const id of ['kept-curry', 'side-salad', 'shared-soup']) {
      await prisma.meal.create({ data: { id, name: id, suitableFor: ['dinner'] } })
    }
    // Monday's dinner is planned with a side; Tuesday's is empty.
    const slot = { planId: 'plan-1', date: date('2026-01-12'), mealType: 'dinner' as const }
    await prisma.mealPlanEntry.create({ data: { id: 'main', ...slot, mealId: 'kept-curry' } })
    await prisma.mealPlanEntry.create({
      data: { id: 'side', ...slot, mealId: 'side-salad', mainEntryId: 'main' },
    })

    await expect(fillEmptySlots({ ...fillOptions, endDate: date('2026-01-14') })).rejects.toThrow(
      'stop after the call',
    )

    const prompt = (vi.mocked(generateObject).mock.calls.at(-1)![0] as { prompt: string }).prompt
    expect(prompt).not.toContain('kept-curry')
    expect(prompt).toContain('side-salad')
    expect(prompt).toContain('shared-soup')
  })
})
