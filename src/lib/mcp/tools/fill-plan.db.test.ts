import { afterAll, describe, expect, it, vi } from 'vitest'

// `fill_plan` against PGlite with real slots, candidates and writes (HON-1649).
// Only the model call is mocked. The `unit-db` project shares one module cache
// (`isolate: false`), and another db test may load `fill-plan` with the real
// `ai` first, so the test imports the tool fresh (`load`), as
// `generate-plan.over.db.test.ts` does. The `plan-generation` limiter would
// call Upstash, so it is mocked as allowed; `fill-plan.test.ts` covers its
// refusal. Vitest runs in UTC, so the household does too, and the range starts
// tomorrow so no slot is over.

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn().mockRejectedValue(new Error('no answer queued')),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 5, remaining: 5 }),
}))

import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, WRITE_SCOPES } from '@/test/mcp'

async function load() {
  vi.resetModules()
  const [{ runTool }, { fillPlan }, { generateObject }] = await Promise.all([
    import('@/lib/mcp/context'),
    import('./fill-plan'),
    import('ai'),
  ])
  return { runTool, fillPlan, generateObject: vi.mocked(generateObject) }
}

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone('UTC'))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder has a planned dinner tomorrow, a note on day 3's dinner, and day 2's
 * dinner empty. Its recipes are all dinners, so a breakfast slot has no candidate.
 */
async function world(mealTypes: Array<'breakfast' | 'dinner'> = ['dinner']) {
  for (const id of ['kept-curry', 'new-soup', 'new-stew']) {
    await prisma.meal.create({
      data: {
        id,
        name: id,
        suitableFor: ['dinner'],
        translations: { create: { locale: 'et', name: `${id} et` } },
      },
    })
  }
  const household = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'et',
      timezone: 'UTC',
      preferences: { create: { weekdayMealTypes: mealTypes, weekendMealTypes: mealTypes } },
      mealPlans: { create: { id: 'plan-alder' } },
    },
    include: { preferences: true },
  })
  const slot = { planId: 'plan-alder', mealType: 'dinner' as const }
  await prisma.mealPlanEntry.create({
    data: { id: 'kept', ...slot, date: parseLocalDate(day(1)), mealId: 'kept-curry' },
  })
  await prisma.mealPlanEntry.create({
    data: { id: 'note-slip', ...slot, date: parseLocalDate(day(3)), note: 'Grandma visits' },
  })
  return mcpHousehold({ ...household, locale: 'et', timezone: 'UTC' })
}

function rows() {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-alder' },
    select: { id: true, date: true, mealId: true, note: true, status: true },
    orderBy: { date: 'asc' },
  })
}

describe('fill_plan on the database (HON-1649)', () => {
  // The fresh `fill-plan` is bound to this file's `ai` mock; drop it, so a later
  // file that imports `fill-plan` loads its own.
  afterAll(() => {
    vi.resetModules()
  })

  it('fills only the empty slots, keeps every earlier entry, and returns what it wrote', async () => {
    const { runTool, fillPlan, generateObject } = await load()
    const household = await world(['breakfast', 'dinner'])
    generateObject.mockResolvedValueOnce({
      object: {
        entries: [
          { date: day(2), mealType: 'dinner', mealId: 'new-soup' },
          { date: day(3), mealType: 'dinner', mealId: 'new-stew' },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runTool(
      fillPlan,
      { userId: 'user-1', household, scopes: WRITE_SCOPES },
      { startDate: day(1), days: 3 },
    )

    expect(result.isError).toBeUndefined()
    const written = await rows()
    const newId = written.find((row) => row.mealId === 'new-soup')!.id
    expect(result.structuredContent).toEqual({
      outcome: 'filled',
      entries: [
        {
          date: day(2),
          mealType: 'dinner',
          entryId: newId,
          meal: { id: 'new-soup', name: 'new-soup et' },
        },
        {
          date: day(3),
          mealType: 'dinner',
          entryId: 'note-slip',
          meal: { id: 'new-stew', name: 'new-stew et' },
        },
      ],
      unfilled: [1, 2, 3].map((offset) => ({ date: day(offset), mealType: 'breakfast' })),
    })
    expect(written.map(({ id, mealId, note }) => ({ id, mealId, note }))).toEqual([
      { id: 'kept', mealId: 'kept-curry', note: null },
      { id: newId, mealId: 'new-soup', note: null },
      { id: 'note-slip', mealId: 'new-stew', note: 'Grandma visits' },
    ])
  })

  it('answers unchanged with no model call when every slot has a meal', async () => {
    const { runTool, fillPlan, generateObject } = await load()
    const household = await world()
    const before = await rows()
    const callsBefore = generateObject.mock.calls.length

    const result = await runTool(
      fillPlan,
      { userId: 'user-1', household, scopes: WRITE_SCOPES },
      { startDate: day(1), days: 1 },
    )

    expect(result.structuredContent).toEqual({ outcome: 'unchanged', entries: [], unfilled: [] })
    expect(generateObject.mock.calls).toHaveLength(callsBefore)
    expect(await rows()).toEqual(before)
  })

  it('names the empty slots no recipe fits, with no model call', async () => {
    const { runTool, fillPlan, generateObject } = await load()
    const household = await world(['breakfast', 'dinner'])
    const before = await rows()
    const callsBefore = generateObject.mock.calls.length

    const result = await runTool(
      fillPlan,
      { userId: 'user-1', household, scopes: WRITE_SCOPES },
      { startDate: day(1), days: 1 },
    )

    expect(result.structuredContent).toEqual({
      outcome: 'unchanged',
      entries: [],
      unfilled: [{ date: day(1), mealType: 'breakfast' }],
    })
    expect(generateObject.mock.calls).toHaveLength(callsBefore)
    expect(await rows()).toEqual(before)
  })
})
