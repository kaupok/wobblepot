import { describe, expect, it, vi } from 'vitest'

// Generate leaves the entries in a slot that is over untouched, sides included
// (HON-1523). Runs against PGlite with real candidates and slots. Only the model
// call is mocked. The `unit-db` project shares one module cache (`isolate: false`),
// and another db test may load `generate-plan` with the real `ai` first, so the
// tests import both fresh (`load`). The mock matches `fill-plan.sides.db.test.ts`.

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn().mockRejectedValue(new Error('stop after the call')),
}))

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { prisma } from '@/lib/prisma'

import type { GeneratePlanOptions } from './types'

/** `generateMealPlan` and the mocked `generateObject`, imported past the shared cache. */
async function load() {
  vi.resetModules()
  const [{ generateMealPlan }, { generateObject }] = await Promise.all([
    import('./generate-plan'),
    import('ai'),
  ])
  return { generateMealPlan, generateObject: vi.mocked(generateObject) }
}

const MONDAY = parseLocalDate('2026-01-12')
// Tallinn is UTC+2 in January.
const AT_15 = new Date('2026-01-12T13:00:00Z')
const AT_2130 = new Date('2026-01-12T19:30:00Z')

async function world() {
  for (const id of ['meal-main', 'meal-side', 'meal-old', 'meal-new', 'tuna-salad']) {
    await prisma.meal.create({ data: { id, name: id, suitableFor: ['dinner'] } })
  }
  const household = await prisma.household.create({
    data: {
      name: 'Birch',
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: 'plan-birch' } },
    },
  })
  return household.id
}

async function slotWithSide(
  prefix: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  status: 'planned' | 'skipped',
) {
  const slot = { planId: 'plan-birch', date: MONDAY, mealType }
  await prisma.mealPlanEntry.create({
    data: { id: prefix, ...slot, mealId: 'meal-main', status, note: `${prefix} note` },
  })
  await prisma.mealPlanEntry.create({
    data: { id: `${prefix}-side`, ...slot, mealId: 'meal-side', mainEntryId: prefix, status },
  })
}

function options(
  householdId: string,
  overrides: Partial<GeneratePlanOptions>,
): GeneratePlanOptions {
  return {
    householdId,
    startDate: MONDAY,
    endDate: parseLocalDate('2026-01-13'),
    dietaryType: null,
    allergensToAvoid: [],
    excludedIngredientIds: [],
    restrictions: [],
    locale: 'en',
    timezone: 'Europe/Tallinn',
    ...overrides,
  }
}

const KEPT_ROWS = [
  { id: 'breakfast', status: 'planned', note: 'breakfast note', mealId: 'meal-main' },
  { id: 'breakfast-side', status: 'planned', note: null, mealId: 'meal-side' },
  { id: 'lunch', status: 'skipped', note: 'lunch note', mealId: 'meal-main' },
  { id: 'lunch-side', status: 'skipped', note: null, mealId: 'meal-side' },
]

function rows() {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-birch' },
    select: { id: true, status: true, note: true, mealId: true },
    orderBy: { id: 'asc' },
  })
}

describe('generateMealPlan with slots that are over (HON-1523)', () => {
  it('keeps the over entries with their sides when every configured slot is over', async () => {
    const { generateMealPlan, generateObject } = await load()
    const householdId = await world()
    await slotWithSide('breakfast', 'breakfast', 'planned')
    await slotWithSide('lunch', 'lunch', 'skipped')
    // Dinner is not over at 15:00, so its entry is cleared as before.
    await slotWithSide('dinner', 'dinner', 'planned')
    const callsBefore = generateObject.mock.calls.length

    await generateMealPlan(
      options(householdId, {
        now: AT_15,
        weekdayMealTypes: ['breakfast', 'lunch'],
        weekendMealTypes: ['breakfast', 'lunch'],
      }),
    )

    expect(generateObject.mock.calls).toHaveLength(callsBefore)
    expect(await rows()).toEqual(KEPT_ROWS)
  })

  it('keeps the over entries with their sides when the AI fills the open dinner', async () => {
    const { generateMealPlan, generateObject } = await load()
    const householdId = await world()
    await slotWithSide('breakfast', 'breakfast', 'planned')
    await slotWithSide('lunch', 'lunch', 'skipped')
    await prisma.mealPlanEntry.create({
      data: {
        id: 'dinner',
        planId: 'plan-birch',
        date: MONDAY,
        mealType: 'dinner',
        mealId: 'meal-old',
      },
    })
    generateObject.mockResolvedValueOnce({
      object: { entries: [{ date: '2026-01-12', mealType: 'dinner', mealId: 'meal-new' }] },
    } as never)

    await generateMealPlan(
      options(householdId, {
        now: AT_15,
        weekdayMealTypes: ['breakfast', 'lunch', 'dinner'],
        weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
      }),
    )

    const left = await rows()
    expect(left.filter((row) => row.id !== 'dinner' && row.mealId !== 'meal-new')).toEqual(
      KEPT_ROWS,
    )
    expect(left.map((row) => row.mealId)).not.toContain('meal-old')
    expect(left.filter((row) => row.mealId === 'meal-new')).toHaveLength(1)
  })

  it("does not offer today's kept dinner again for tomorrow", async () => {
    const { generateMealPlan, generateObject } = await load()
    const householdId = await world()
    await prisma.mealPlanEntry.create({
      data: {
        id: 'dinner',
        planId: 'plan-birch',
        date: MONDAY,
        mealType: 'dinner',
        mealId: 'tuna-salad',
      },
    })
    generateObject.mockRejectedValueOnce(new Error('stop after the call'))

    await expect(
      generateMealPlan(
        options(householdId, { now: AT_2130, endDate: parseLocalDate('2026-01-14') }),
      ),
    ).rejects.toThrow('stop after the call')

    const prompt = (generateObject.mock.calls.at(-1)![0] as { prompt: string }).prompt
    expect(prompt).not.toContain('tuna-salad')
    expect(prompt).toContain('meal-new')
  })
})
