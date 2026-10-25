import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/day-extras/day-extras', () => ({ loadDayExtras: vi.fn() }))

import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import { toDateString } from '@/lib/meal-planning/dates'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { getMealPlan } from './get-meal-plan'

type Entries = Awaited<ReturnType<typeof loadPlanEntries>>['entries']

const household = mcpHousehold({ id: 'household-1', timezone: 'Europe/Tallinn' })
const ctx = { userId: 'user-1', household, scopes: READ_SCOPES }

function entry(overrides: Partial<Entries[number]>): Entries[number] {
  return {
    id: 'entry-1',
    date: '2026-10-12',
    mealType: 'dinner',
    status: 'planned',
    servingOverride: null,
    meal: { id: 'meal-1', name: 'Chicken soup' },
    ...overrides,
  } as Entries[number]
}

function call(input: Record<string, unknown> = {}) {
  return runTool(getMealPlan, ctx, getMealPlan.inputSchema.parse(input))
}

describe('get_meal_plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 2026-10-11 21:30 UTC is already 2026-10-12 in Tallinn.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T21:30:00Z'))
    vi.mocked(loadPlanEntries).mockResolvedValue({ entries: [], planId: 'plan-1' })
    vi.mocked(loadDayExtras).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("defaults to today and the next 6 days in the household's timezone", async () => {
    const result = await call()

    expect(result.structuredContent).toMatchObject({ from: '2026-10-12', to: '2026-10-18' })
    const [passedHousehold, query] = vi.mocked(loadPlanEntries).mock.calls[0]!
    expect(passedHousehold).toBe(household)
    expect(toDateString(query.startDate)).toBe('2026-10-12')
    // The loader's end is exclusive.
    expect(toDateString(query.endDate)).toBe('2026-10-19')
  })

  it('maps entries to the compact shape, with servings and cooked state', async () => {
    vi.mocked(loadPlanEntries).mockResolvedValue({
      planId: 'plan-1',
      entries: [
        entry({}),
        entry({
          id: 'entry-2',
          mealType: 'lunch',
          status: 'completed',
          servingOverride: 4,
          meal: { id: 'meal-2', name: 'Pasta' } as Entries[number]['meal'],
        }),
        entry({ id: 'entry-3', mealType: 'breakfast', status: 'skipped', meal: null }),
      ],
    })

    const result = await call({ from: '2026-10-12', to: '2026-10-12' })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      from: '2026-10-12',
      to: '2026-10-12',
      entries: [
        {
          date: '2026-10-12',
          mealType: 'dinner',
          mealId: 'meal-1',
          mealName: 'Chicken soup',
          servings: 2,
          isCooked: false,
          isSkipped: false,
        },
        {
          date: '2026-10-12',
          mealType: 'lunch',
          mealId: 'meal-2',
          mealName: 'Pasta',
          servings: 4,
          isCooked: true,
          isSkipped: false,
        },
        {
          date: '2026-10-12',
          mealType: 'breakfast',
          mealId: null,
          mealName: null,
          servings: 2,
          isCooked: false,
          isSkipped: true,
        },
      ],
      extras: [],
    })
    expect(getMealPlan.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it("returns the range's extras: an ingredient with its amount, and free text with none", async () => {
    vi.mocked(loadDayExtras).mockResolvedValue([
      {
        id: 'extra-1',
        date: '2026-10-17',
        ingredientId: 'ing-wine',
        name: 'Red wine',
        quantity: 750,
        unit: 'ml',
      },
      {
        id: 'extra-2',
        date: '2026-10-17',
        ingredientId: null,
        name: 'chips',
        quantity: null,
        unit: null,
      },
    ])

    const result = await call({ from: '2026-10-12', to: '2026-10-18' })

    expect(result.structuredContent).toMatchObject({
      extras: [
        {
          id: 'extra-1',
          date: '2026-10-17',
          name: 'Red wine',
          kind: 'ingredient',
          quantity: 750,
          unit: 'ml',
        },
        {
          id: 'extra-2',
          date: '2026-10-17',
          name: 'chips',
          kind: 'text',
          quantity: null,
          unit: null,
        },
      ],
    })
    expect(getMealPlan.outputSchema.safeParse(result.structuredContent).success).toBe(true)
    // The same range as the entries, with the same exclusive end.
    const [passedHousehold, query] = vi.mocked(loadDayExtras).mock.calls[0]!
    expect(passedHousehold).toBe(household)
    expect(toDateString(query.startDate)).toBe('2026-10-12')
    expect(toDateString(query.endDate)).toBe('2026-10-19')
  })

  it('refuses a range that ends before it starts, without reading the plan', async () => {
    const result = await call({ from: '2026-10-12', to: '2026-10-10' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('before') })
    expect(loadPlanEntries).not.toHaveBeenCalled()
  })

  it('refuses a range longer than 31 days', async () => {
    const result = await call({ from: '2026-10-01', to: '2026-11-01' })

    expect(result.isError).toBe(true)
    expect(loadPlanEntries).not.toHaveBeenCalled()
  })

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(getMealPlan.inputSchema.safeParse({ from: '12.10.2026' }).success).toBe(false)
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(
      getMealPlan,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      {},
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(loadPlanEntries).not.toHaveBeenCalled()
  })
})
