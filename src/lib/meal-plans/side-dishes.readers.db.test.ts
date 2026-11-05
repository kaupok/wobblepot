import { describe, expect, it } from 'vitest'

import { createEmptyPlan } from '@/lib/ai/generate-plan'
import { readMealPlan } from '@/lib/api/v1/meal-plan'
import { findPlanSlot } from '@/lib/mcp/tools/plan-slot'
import { countConflictingPlannedEntries } from '@/lib/meal-planning/count-preference-conflicts'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { countPastMealsToMark } from '@/lib/meal-planning/past-meals'
import { computeRollingWindowShoppingList } from '@/lib/meal-planning/shopping-list'
import { prisma } from '@/lib/prisma'
import { mcpHousehold } from '@/test/mcp'

// The readers of a slot that holds a main and its sides (HON-1609). Runs
// against PGlite through the `unit-db` project, with no mocks. No write path
// creates a side yet, so the sides are written here directly.

const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder: three members, so 3 servings. The dinner in two days is a stew for 4
 * (100 g onion, 50 g rice per serving) with a cucumber salad side that has no
 * override (20 g onion, 80 g cucumber per serving).
 *
 * The main's date is moved away and back after its side is written, so its
 * row and index entries come after the side's, and a read with no order and
 * no `mainEntryId` filter meets the side first.
 */
async function world() {
  for (const id of ['onion', 'rice', 'cucumber']) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      timezone: TIMEZONE,
      members: { create: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const meal = (id: string, name: string, components: Record<string, number>) =>
    prisma.meal.create({
      data: {
        id,
        name,
        components: {
          create: Object.entries(components).map(([ingredientId, quantityPerServing]) => ({
            ingredientId,
            quantityPerServing,
          })),
        },
      },
    })
  await meal('meal-stew', 'Stew', { onion: 100, rice: 50 })
  await meal('meal-salad', 'Cucumber salad', { onion: 20, cucumber: 80 })
  await meal('meal-soup', 'Onion soup', { onion: 150 })
  await slotWithSide('main', day(2), { servingOverride: 4 })
  return mcpHousehold({ id: alder.id, timezone: TIMEZONE, members: [] })
}

/** Onion as "have some" in the pantry, which the pantry check reads. */
const haveSomeOnion = (householdId: string) =>
  prisma.pantryItem.create({ data: { householdId, ingredientId: 'onion', quantity: null } })

/** A stew main with a salad side, both in the dinner slot of `date`. */
async function slotWithSide(
  prefix: string,
  date: string,
  main: { servingOverride?: number; status?: 'planned' | 'completed' | 'skipped' } = {},
  sideStatus: 'planned' | 'completed' | 'skipped' = main.status ?? 'planned',
) {
  const slot = { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'dinner' as const }
  await prisma.mealPlanEntry.create({
    data: { id: prefix, ...slot, mealId: 'meal-stew', ...main },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: `${prefix}-side`,
      ...slot,
      mealId: 'meal-salad',
      mainEntryId: prefix,
      status: sideStatus,
    },
  })
  const away = parseLocalDate(date)
  away.setFullYear(away.getFullYear() + 1)
  await prisma.mealPlanEntry.update({ where: { id: prefix }, data: { date: away } })
  await prisma.mealPlanEntry.update({ where: { id: prefix }, data: { date: slot.date } })
}

describe('a slot with a main and a side (HON-1609)', () => {
  it('findPlanSlot returns the main, never the side', async () => {
    const household = await world()

    const entry = await findPlanSlot(household, day(2), 'dinner')

    expect(entry.id).toBe('main')
    expect(entry.meal?.name).toBe('Stew')
  })

  it('get_meal_plan and the v1 meal plan return one row, with the side under sides', async () => {
    const household = await world()

    const plan = await readMealPlan(household, { from: day(2), to: day(2) })

    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({ entryId: 'main', mealName: 'Stew', servings: 4 })
    // The side has no override, so it follows the main's 4, not the household's 3.
    expect(plan.entries[0]!.sides).toEqual([
      {
        entryId: 'main-side',
        mealId: 'meal-salad',
        mealName: 'Cucumber salad',
        servings: 4,
        cookServings: 4,
        status: 'planned',
        rating: null,
      },
    ])
  })

  it('the timeline and Past meals read one entry for the slot', async () => {
    const household = await world()
    await slotWithSide('past', day(-1))

    const { entries } = await loadPlanEntries(household, {
      startDate: parseLocalDate(day(-1)),
      endDate: parseLocalDate(day(3)),
    })

    expect(entries.map((entry) => [entry.id, entry.sides.map((side) => side.entryId)])).toEqual([
      ['past', ['past-side']],
      ['main', ['main-side']],
    ])
  })

  it("the shopping list counts the slot as one meal and buys the side at the side's servings", async () => {
    const household = await world()

    const list = await computeRollingWindowShoppingList(household.id, 7, TIMEZONE)
    const items = Object.fromEntries(
      list.groups.flatMap((g) => g.items).map((item) => [item.ingredientId, item]),
    )

    // Onion: 100 g × 4 for the stew and 20 g × 4 for the salad, in one meal.
    expect(items.onion).toMatchObject({ neededQuantity: 480, mealCount: 1 })
    expect(items.cucumber).toMatchObject({ neededQuantity: 320, mealCount: 1 })
  })

  it('the pantry check does not list a "have some" onion that one slot alone uses', async () => {
    const household = await world()
    await haveSomeOnion(household.id)

    const list = await computeRollingWindowShoppingList(household.id, 7, TIMEZONE)

    expect(list.check).toEqual([])
  })

  it('the pantry check lists the onion once a second slot uses it', async () => {
    const household = await world()
    await haveSomeOnion(household.id)
    await prisma.mealPlanEntry.create({
      data: {
        id: 'soup',
        planId: 'plan-alder',
        date: parseLocalDate(day(3)),
        mealType: 'dinner',
        mealId: 'meal-soup',
      },
    })

    const list = await computeRollingWindowShoppingList(household.id, 7, TIMEZONE)

    expect(list.check.map((item) => [item.ingredientId, item.mealCount])).toEqual([['onion', 2]])
  })

  it('the preferences toast counts the slot once, as its one card marks it', async () => {
    const household = await world()
    // The stew main and the salad side both use the onion, so both break this.
    await prisma.ingredient.update({ where: { id: 'onion' }, data: { allergens: ['nuts'] } })

    const count = await countConflictingPlannedEntries(household, {
      dietaryType: null,
      allergensToAvoid: ['nuts'],
      excludedIngredients: [],
    })

    expect(count).toBe(1)
  })

  it('countPastMealsToMark counts the slot once', async () => {
    const household = await world()
    await slotWithSide('past', day(-1))

    expect(await countPastMealsToMark(household)).toBe(1)
  })

  it('generate keeps a slot with a completed main and replaces one with a planned main, sides included', async () => {
    const household = await world()
    // A side may be skipped while its main is cooked (parent, Q1); it stays with the main.
    await slotWithSide('cooked', day(1), { status: 'completed' }, 'skipped')

    await createEmptyPlan({
      householdId: household.id,
      startDate: parseLocalDate(day(0)),
      endDate: parseLocalDate(day(7)),
    })

    const left = await prisma.mealPlanEntry.findMany({
      where: { planId: 'plan-alder' },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    expect(left.map((entry) => entry.id)).toEqual(['cooked', 'cooked-side'])
  })
})
