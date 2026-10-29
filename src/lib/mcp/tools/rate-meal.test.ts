import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: { findFirst: vi.fn(), updateManyAndReturn: vi.fn() },
  },
}))

import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { rateMeal } from './rate-meal'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(rateMeal, caller, rateMeal.inputSchema.parse(input))
}

const DATE = '2026-10-12'

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    mealType: 'dinner',
    mealId: 'meal-1',
    status: 'completed',
    rating: null,
    meal: { id: 'meal-1', name: 'Fish tacos', timeMinutes: 30, primaryProteinType: 'fish' },
    ...overrides,
  }
}

describe('rate_meal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot() as never)
    vi.mocked(prisma.mealPlanEntry.updateManyAndReturn).mockImplementation((async ({
      data,
    }: never) => [{ ...slot(), meal: undefined, ...(data as object) }]) as never)
  })

  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const result = await call(
      { date: DATE, mealType: 'dinner', rating: 'up' },
      { ...ctx, scopes: READ_SCOPES },
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })

  // The same column the route writes for `{ rating }` (route test: "allows
  // rating update", "allows clearing rating with null").
  it.each([
    ['sets', null, 'up'],
    ['changes', 'up', 'down'],
    ['clears', 'down', null],
  ] as const)('%s the rating', async (_verb, before, after) => {
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot({ rating: before }) as never)

    const result = await call({ date: DATE, mealType: 'dinner', rating: after })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      date: DATE,
      mealType: 'dinner',
      meal: { id: 'meal-1', name: 'Fish tacos' },
      rating: after,
    })
    expect(prisma.mealPlanEntry.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'entry-1', planId: 'plan-a', mealId: 'meal-1', status: 'completed' },
      data: { rating: after },
    })
  })

  it('requires a rating, so a call cannot clear one by leaving it out', () => {
    expect(() => rateMeal.inputSchema.parse({ date: DATE, mealType: 'dinner' })).toThrow()
  })

  it('refuses a slot with no meal', async () => {
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(
      slot({ mealId: null, meal: null }) as never,
    )

    const result = await call({ date: DATE, mealType: 'dinner', rating: 'up' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('nothing to rate') })
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })

  // The app shows the thumbs on a cooked entry only, so a rating anywhere else
  // could be neither seen nor cleared, yet would move the swap ranking.
  it.each(['planned', 'skipped'])('refuses a %s entry', async (status) => {
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(slot({ status }) as never)

    const result = await call({ date: DATE, mealType: 'dinner', rating: 'up' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('not marked as cooked'),
    })
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('Mark it cooked with set_meal_status'),
    })
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('refuses when the meal was swapped or reverted while the rating ran', async () => {
    vi.mocked(prisma.mealPlanEntry.updateManyAndReturn).mockResolvedValue([] as never)

    const result = await call({ date: DATE, mealType: 'dinner', rating: 'up' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('changed while this ran'),
    })
  })

  it("finds only the caller's own entry, so another household's is untouched", async () => {
    vi.mocked(prisma.mealPlanEntry.findFirst).mockResolvedValue(null)
    const other = mcpHousehold({ id: 'household-b' })

    const result = await call(
      { date: DATE, mealType: 'dinner', rating: 'down' },
      { userId: 'user-b', household: other, scopes: WRITE_SCOPES },
    )

    expect(result.isError).toBe(true)
    expect(prisma.mealPlanEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ plan: { householdId: 'household-b' } }),
      }),
    )
    expect(prisma.mealPlanEntry.updateManyAndReturn).not.toHaveBeenCalled()
  })
})
