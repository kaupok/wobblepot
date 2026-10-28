import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { addLeftoverLunch, LeftoverLunchError, type LeftoverLunchRefusal } from './leftover-lunch'

// "Cook for tomorrow's lunch too" (HON-1396). Runs against PGlite through the
// `unit-db` project, with no mocks.

// Wednesday the 21st's dinner feeds Thursday's lunch. Friday the 23rd's dinner
// would feed Saturday's, and Alder plans no lunch at weekends.
const WEDNESDAY = '2026-10-21'
const THURSDAY = '2026-10-22'
const FRIDAY = '2026-10-23'

const household = {
  id: 'household-alder',
  preferences: {
    weekdayMealTypes: ['lunch' as const, 'dinner' as const],
    weekendMealTypes: ['dinner' as const],
  },
}

async function world() {
  await prisma.household.create({
    data: { id: household.id, name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  await prisma.meal.create({ data: { id: 'meal-stew', name: 'Stew' } })
  await prisma.meal.create({ data: { id: 'meal-soup', name: 'Soup' } })
  await prisma.ingredient.create({
    data: {
      id: 'ing-peas',
      name: 'peas',
      category: 'vegetable',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
  await entry('dinner', WEDNESDAY)
  await entry('friday-dinner', FRIDAY)
}

function entry(
  id: string,
  date: string,
  data: Record<string, unknown> = {},
  planId = 'plan-alder',
) {
  return prisma.mealPlanEntry.create({
    data: {
      id,
      planId,
      date: parseLocalDate(date),
      mealType: 'dinner',
      mealId: 'meal-stew',
      status: 'planned',
      ...data,
    },
  })
}

function thursdayLunch() {
  return prisma.mealPlanEntry.findFirst({
    where: { date: parseLocalDate(THURSDAY), mealType: 'lunch' },
    select: {
      kind: true,
      status: true,
      note: true,
      items: {
        orderBy: { position: 'asc' },
        select: { ingredientId: true, sourceEntryId: true, servings: true, label: true },
      },
    },
  })
}

async function refusal(promise: Promise<unknown>): Promise<LeftoverLunchRefusal | null> {
  try {
    await promise
    return null
  } catch (error) {
    if (error instanceof LeftoverLunchError) return error.reason
    throw error
  }
}

describe('addLeftoverLunch', () => {
  it("plans a fridge meal with one leftover item when tomorrow's lunch is empty", async () => {
    await world()

    expect(await addLeftoverLunch(household, 'plan-alder', 'dinner', 2.5)).toEqual({
      outcome: 'planned',
      date: THURSDAY,
    })

    expect(await thursdayLunch()).toEqual({
      kind: 'fridge',
      status: 'planned',
      note: null,
      items: [{ ingredientId: null, sourceEntryId: 'dinner', servings: 2.5, label: null }],
    })
  })

  it('adds the item to a fridge-meal lunch and keeps the other items, in order', async () => {
    await world()
    await entry('lunch', THURSDAY, {
      mealType: 'lunch',
      mealId: null,
      kind: 'fridge',
      items: {
        create: [
          { ingredientId: 'ing-peas', position: 0 },
          { label: 'bread', position: 1 },
        ],
      },
    })

    expect(await addLeftoverLunch(household, 'plan-alder', 'dinner', 2.5)).toEqual({
      outcome: 'added',
      date: THURSDAY,
    })

    expect((await thursdayLunch())?.items).toEqual([
      { ingredientId: 'ing-peas', sourceEntryId: null, servings: null, label: null },
      { ingredientId: null, sourceEntryId: null, servings: null, label: 'bread' },
      { ingredientId: null, sourceEntryId: 'dinner', servings: 2.5, label: null },
    ])
  })

  it('makes a note-only lunch a fridge meal and keeps its note', async () => {
    await world()
    await entry('lunch', THURSDAY, { mealType: 'lunch', mealId: null, note: 'Office' })

    await addLeftoverLunch(household, 'plan-alder', 'dinner', 1)

    expect(await thursdayLunch()).toMatchObject({ kind: 'fridge', note: 'Office' })
  })

  it.each<[string, Record<string, unknown>, LeftoverLunchRefusal]>([
    ['a recipe meal', { mealId: 'meal-soup' }, 'recipeLunch'],
    ['a skipped recipe meal', { mealId: 'meal-soup', status: 'skipped' }, 'recipeLunch'],
    ['cooked', { mealId: null, kind: 'fridge', status: 'completed' }, 'cooked'],
  ])("refuses when tomorrow's lunch is %s, and changes nothing", async (_case, data, reason) => {
    await world()
    await entry('lunch', THURSDAY, { mealType: 'lunch', ...data })
    const before = await thursdayLunch()

    expect(await refusal(addLeftoverLunch(household, 'plan-alder', 'dinner', 2))).toBe(reason)
    expect(await thursdayLunch()).toEqual(before)
  })

  it('refuses when the lunch already takes leftovers from this dinner', async () => {
    await world()
    await entry('lunch', THURSDAY, {
      mealType: 'lunch',
      mealId: null,
      kind: 'fridge',
      items: { create: [{ sourceEntryId: 'dinner', servings: 1, position: 0 }] },
    })

    expect(await refusal(addLeftoverLunch(household, 'plan-alder', 'dinner', 2))).toBe(
      'alreadyLinked',
    )
  })

  it('refuses when the lunch already holds 30 items, the most a fridge meal takes', async () => {
    await world()
    await entry('lunch', THURSDAY, {
      mealType: 'lunch',
      mealId: null,
      kind: 'fridge',
      items: {
        create: Array.from({ length: 30 }, (_, position) => ({
          label: `thing ${position}`,
          position,
        })),
      },
    })

    expect(await refusal(addLeftoverLunch(household, 'plan-alder', 'dinner', 2))).toBe('lunchFull')
    expect((await thursdayLunch())?.items).toHaveLength(30)
  })

  it('refuses when lunch is off for the next day', async () => {
    await world()

    expect(await refusal(addLeftoverLunch(household, 'plan-alder', 'friday-dinner', 2))).toBe(
      'lunchOff',
    )
    // No household preferences: dinner only.
    expect(
      await refusal(
        addLeftoverLunch({ ...household, preferences: null }, 'plan-alder', 'dinner', 2),
      ),
    ).toBe('lunchOff')
  })

  it('refuses a dinner that is cooked, a fridge meal or not a dinner, and another household’s', async () => {
    await world()
    await entry('cooked', '2026-10-19', { status: 'completed' })
    await entry('fridge', '2026-10-19', { mealType: 'lunch', mealId: null, kind: 'fridge' })
    await entry('birch-dinner', WEDNESDAY, {}, 'plan-birch')

    const add = (id: string, planId = 'plan-alder') =>
      refusal(addLeftoverLunch(household, planId, id, 2))
    expect(await add('cooked')).toBe('notPlannedDinner')
    expect(await add('fridge')).toBe('notPlannedDinner')
    expect(await add('birch-dinner', 'plan-birch')).toBe('dinnerNotFound')
  })
})
