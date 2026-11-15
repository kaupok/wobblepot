import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { meal: { findMany: vi.fn() } } }))
vi.mock('@/lib/feature-flags', () => ({ getServerFlag: vi.fn() }))
vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
}))
vi.mock('@/lib/meal-plans/fill-empty', () => ({
  MAX_PLAN_DAYS: 14,
  fillHouseholdEmptySlots: vi.fn(),
}))
vi.mock('@/lib/meal-plans/plans', () => ({ findOrCreateMealPlan: vi.fn() }))

import { InsufficientCandidatesError, NoEmptySlotsError } from '@/lib/ai/types'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'
import { runTool, TOOL_FAILED_MESSAGE, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { fillHouseholdEmptySlots } from '@/lib/meal-plans/fill-empty'
import { findOrCreateMealPlan } from '@/lib/meal-plans/plans'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { fillPlan } from './fill-plan'

// 10:00 in Tallinn on Wednesday 2026-10-21, so today is 2026-10-21 and the last
// writable day 2026-11-18.
const NOW = new Date('2026-10-21T07:00:00.000Z')
const household = mcpHousehold({ id: 'household-a', timezone: 'Europe/Tallinn' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }
const RESET_AT = new Date('2026-10-21T18:00:00.000Z')

function call(input: Record<string, unknown> = {}, caller = ctx) {
  return runTool(
    fillPlan,
    caller,
    fillPlan.inputSchema.parse({ startDate: '2026-10-21', days: 7, ...input }),
  )
}

function text(result: Awaited<ReturnType<typeof call>>) {
  return (result.content[0] as { text: string }).text
}

const meal = (id: string) => ({
  id,
  name: id,
  kidFriendly: false,
  primaryProteinType: 'poultry',
  nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    limit: 5,
    remaining: 4,
    resetAt: RESET_AT,
  })
  vi.mocked(getServerFlag).mockResolvedValue(true)
  vi.mocked(assertUnderCap).mockResolvedValue(undefined as never)
  vi.mocked(findOrCreateMealPlan).mockResolvedValue('plan-a')
  vi.mocked(prisma.meal.findMany).mockResolvedValue([
    { id: 'meal-soup', name: 'Soup', translations: [] },
  ] as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fill_plan', () => {
  it('returns only the entries the fill wrote, in the household’s plan and range', async () => {
    vi.mocked(fillHouseholdEmptySlots).mockResolvedValue({
      id: 'plan-a',
      startDate: '2026-10-21',
      endDate: '2026-10-28',
      entries: [
        { id: 'kept', date: '2026-10-21', mealType: 'dinner', status: 'planned', meal: meal('x') },
        {
          id: 'new',
          date: '2026-10-22',
          mealType: 'dinner',
          status: 'planned',
          meal: meal('meal-soup'),
        },
      ],
      filledEntryIds: ['new'],
      unfilledSlots: [{ date: '2026-10-23', mealType: 'breakfast' }],
    } as never)

    const result = await call()

    expect(result.structuredContent).toEqual({
      outcome: 'filled',
      entries: [
        {
          date: '2026-10-22',
          mealType: 'dinner',
          entryId: 'new',
          meal: { id: 'meal-soup', name: 'Soup' },
        },
      ],
      unfilled: [{ date: '2026-10-23', mealType: 'breakfast' }],
    })
    expect(fillHouseholdEmptySlots).toHaveBeenCalledWith(household, {
      planId: 'plan-a',
      startDate: new Date(2026, 9, 21),
      endDate: new Date(2026, 9, 28),
      locale: 'en',
      aiBudgetMs: 40_000,
    })
  })

  it('answers unchanged when no slot is empty', async () => {
    vi.mocked(fillHouseholdEmptySlots).mockRejectedValue(new NoEmptySlotsError())

    const result = await call()

    expect(result.structuredContent).toEqual({ outcome: 'unchanged', entries: [], unfilled: [] })
  })

  it('refuses a start before today', async () => {
    const result = await call({ startDate: '2026-10-20' })

    expect(text(result)).toBe(
      '2026-10-20 is in the past. Start on 2026-10-21 or later. Nothing was changed.',
    )
    expect(checkRateLimit).not.toHaveBeenCalledWith('household-a', 'plan-generation')
    expect(fillHouseholdEmptySlots).not.toHaveBeenCalled()
  })

  it('takes a range whose last day is 28 days ahead and refuses one a day past it', async () => {
    vi.mocked(fillHouseholdEmptySlots).mockRejectedValue(new NoEmptySlotsError())
    expect((await call({ startDate: '2026-11-12', days: 7 })).isError).toBeUndefined()

    const result = await call({ startDate: '2026-11-13', days: 7 })

    expect(text(result)).toBe(
      'The range ends on 2026-11-19, more than 28 days ahead. End it on 2026-11-18 or earlier. Nothing was changed.',
    )
    expect(fillHouseholdEmptySlots).toHaveBeenCalledTimes(1)
  })

  it('refuses more than 14 days in the input schema', () => {
    expect(fillPlan.inputSchema.safeParse({ startDate: '2026-10-21', days: 15 }).success).toBe(
      false,
    )
  })

  it('refuses at the plan-generation rate limit before the fill', async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (_id, feature) =>
      feature === 'plan-generation'
        ? { allowed: false, limit: 5, remaining: 0, resetAt: RESET_AT }
        : { allowed: true, limit: 100, remaining: 99, resetAt: RESET_AT },
    )

    const result = await call()

    expect(text(result)).toBe(
      'This household has planned with AI too often (at most 5 times an hour). Try again after 2026-10-21T18:00:00.000Z. Nothing was changed.',
    )
    expect(fillHouseholdEmptySlots).not.toHaveBeenCalled()
  })

  it('refuses when the AI kill switch is off, before the fill', async () => {
    vi.mocked(getServerFlag).mockImplementation(async (key) => key !== 'ai_generation_enabled')

    const result = await call()

    expect(text(result)).toBe(
      'Planning with AI is turned off in Wobblepot for now. Try again later. Nothing was changed.',
    )
    expect(getServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-a')
    expect(fillHouseholdEmptySlots).not.toHaveBeenCalled()
  })

  it('refuses over the cost cap, before the fill', async () => {
    vi.mocked(assertUnderCap).mockRejectedValue(
      new AiCostCapExceededError(RESET_AT, 'Europe/Tallinn'),
    )

    const result = await call()

    expect(text(result)).toBe(
      'This household has used its AI allowance for this month. It resets on 2026-10-21. Nothing was changed.',
    )
    expect(fillHouseholdEmptySlots).not.toHaveBeenCalled()
  })

  it('names the protein type when a required pool is empty', async () => {
    vi.mocked(fillHouseholdEmptySlots).mockRejectedValue(new InsufficientCandidatesError('fish'))

    const result = await call()

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('No fish meals available')
  })

  it('says to try again when the fill fails, as on a budget timeout', async () => {
    vi.mocked(fillHouseholdEmptySlots).mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    )

    const result = await call()

    expect(text(result)).toBe(TOOL_FAILED_MESSAGE)
  })

  it('refuses a read-only token', async () => {
    const result = await call({}, { ...ctx, scopes: READ_SCOPES })

    expect(text(result)).toBe(WRITE_SCOPE_MESSAGE)
    expect(fillHouseholdEmptySlots).not.toHaveBeenCalled()
  })
})
