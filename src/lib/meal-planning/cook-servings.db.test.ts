import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { computeRollingWindowShoppingList, computeShoppingList } from './shopping-list'
import { getStartOfTodayInTimezone } from './dates'
import { loadPantry } from './load-pantry'
import { loadPlanEntries } from './load-plan-entries'
import { createEntry } from '@/lib/meal-plans/create-entry'
import { deleteEntry, updateEntry } from '@/lib/meal-plans/entries'
import { setFridgeItems } from '@/lib/meal-plans/fridge-meal'
import { fridgeItemsSchema } from '@/lib/meal-plans/fridge-items'
import { serializePreparationSteps } from '@/lib/preparation-steps'
import { toFridgeItemInput } from '@/components/meal-plan/fridge-meal/use-fridge-item-text'

// Leftover lunches (HON-1394): a dinner is cooked, bought and charged for its
// own servings plus the servings of every lunch that takes its leftovers.
// Runs against PGlite through the `unit-db` project, with no mocks. The
// expected numbers are the issue's: 3 own, a lunch of 2.5, 5.5 in all.

const TZ = 'UTC'
const PLAN = 'plan-alder'

const day = (offset: number) => {
  const date = getStartOfTodayInTimezone(TZ)
  date.setDate(date.getDate() + offset)
  return date
}

/**
 * Alder: three adults, so 3 own servings. A lentil stew (100 g lentils per
 * serving) is planned for dinner tomorrow. A bean soup (200 g beans per
 * serving) is there to swap to. The pantry holds 100 g of each, too little,
 * so both lists show them.
 */
async function world() {
  for (const [id, name] of [
    ['lentils', 'lentils'],
    ['beans', 'beans'],
  ]) {
    await prisma.ingredient.create({
      data: {
        id: id!,
        name: name!,
        category: 'carb',
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
      locale: 'en',
      timezone: TZ,
      members: { create: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
      mealPlans: { create: { id: PLAN } },
      pantryItems: {
        create: [
          { ingredientId: 'lentils', quantity: 100 },
          { ingredientId: 'beans', quantity: 100 },
        ],
      },
    },
    include: { _count: { select: { members: true } }, members: { include: { preferences: true } } },
  })
  await prisma.meal.create({
    data: {
      id: 'stew',
      name: 'Lentil stew',
      components: { create: [{ ingredientId: 'lentils', quantityPerServing: 100 }] },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'soup',
      name: 'Bean soup',
      components: { create: [{ ingredientId: 'beans', quantityPerServing: 200 }] },
    },
  })
  await prisma.mealPlanEntry.create({
    data: { id: 'dinner', planId: PLAN, date: day(1), mealType: 'dinner', mealId: 'stew' },
  })
  return alder
}

type Household = Awaited<ReturnType<typeof world>>

/** A fridge lunch `offset` days ahead that takes `servings` of the dinner. */
async function lunch(household: Household, offset: number, servings: number) {
  const created = await createEntry(household.id, PLAN, {
    date: day(offset),
    mealType: 'lunch',
    fridgeItems: [{ sourceEntryId: 'dinner', servings }, { label: 'Bread' }],
  })
  return created.id
}

/** Each ingredient's needed quantity, on both lists and on the pantry. */
async function needed(household: Household) {
  const shown = (groups: { items: { ingredientId: string; neededQuantity: number }[] }[]) =>
    Object.fromEntries(
      groups.flatMap((g) => g.items).map((i) => [i.ingredientId, i.neededQuantity]),
    )
  const pantry = await loadPantry(household, { days: 7 })
  return {
    plan: shown(await computeShoppingList(PLAN, household.id, TZ)),
    rolling: shown((await computeRollingWindowShoppingList(household.id, 7, TZ)).groups),
    pantry: Object.fromEntries(
      pantry.items.flatMap((item) =>
        'neededQuantity' in item ? [[item.ingredientId, item.neededQuantity]] : [],
      ),
    ),
  }
}

const everywhere = (amounts: Record<string, number>) => ({
  plan: amounts,
  rolling: amounts,
  pantry: amounts,
})

async function dinnerRead(household: Household) {
  const { entries } = await loadPlanEntries(household, { startDate: day(0), endDate: day(7) })
  return entries.find((entry) => entry.id === 'dinner')!
}

describe('cook servings of a dinner with leftover lunches', () => {
  it('a dinner at 3 own servings with one lunch at 2.5 is bought and needed at 5.5', async () => {
    const household = await world()
    expect(await needed(household)).toEqual(everywhere({ lentils: 300 }))

    await lunch(household, 2, 2.5)

    expect(await needed(household)).toEqual(everywhere({ lentils: 550 }))
  })

  it('two lunches at 2.5 and 2 make 7.5', async () => {
    const household = await world()
    await lunch(household, 2, 2.5)
    await lunch(household, 3, 2)

    expect(await needed(household)).toEqual(everywhere({ lentils: 750 }))
    const dinner = await dinnerRead(household)
    expect(dinner.servingOverride).toBeNull()
    expect(dinner.cookServings).toBe(7.5)
  })

  it('a skipped lunch adds nothing, and un-skipping it adds its servings again', async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)

    await updateEntry(household.id, PLAN, lunchId, { status: 'skipped' })
    expect(await needed(household)).toEqual(everywhere({ lentils: 300 }))

    await updateEntry(household.id, PLAN, lunchId, { status: 'planned' })
    expect(await needed(household)).toEqual(everywhere({ lentils: 550 }))
  })

  it('a lunch removed before the dinner is cooked takes its servings away', async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)

    await deleteEntry(household.id, PLAN, lunchId)

    expect(await needed(household)).toEqual(everywhere({ lentils: 300 }))
  })

  it('completing the dinner charges the pantry once for 5.5 and stores 5.5, which a removed lunch leaves alone', async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)
    await prisma.pantryItem.updateMany({
      where: { householdId: household.id, ingredientId: 'lentils' },
      data: { quantity: 2000 },
    })

    const result = await updateEntry(household.id, PLAN, 'dinner', {
      status: 'completed',
      deductPantry: true,
    })

    expect(result.pantryDeducted).toBe(true)
    const lentils = () =>
      prisma.pantryItem.findFirstOrThrow({
        where: { householdId: household.id, ingredientId: 'lentils' },
      })
    expect((await lentils()).quantity).toBe(1450)
    const stored = () => prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'dinner' } })
    expect((await stored()).cookedServings).toBe(5.5)

    await deleteEntry(household.id, PLAN, lunchId)

    expect((await stored()).cookedServings).toBe(5.5)
    expect((await dinnerRead(household)).cookServings).toBe(5.5)
    expect((await lentils()).quantity).toBe(1450)
  })

  it('a dinner reverted to planned drops the stored count and counts its lunches again', async () => {
    const household = await world()
    await lunch(household, 2, 2.5)
    await updateEntry(household.id, PLAN, 'dinner', { status: 'completed' })

    await updateEntry(household.id, PLAN, 'dinner', { status: 'planned' })

    const stored = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'dinner' } })
    expect(stored.cookedServings).toBeNull()
    expect(await needed(household)).toEqual(everywhere({ lentils: 550 }))
  })

  it("clearing the dinner turns the lunch's item into free text with the meal's name and no servings", async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)

    await deleteEntry(household.id, PLAN, 'dinner')

    const items = await prisma.mealPlanEntryItem.findMany({
      where: { entryId: lunchId },
      orderBy: { position: 'asc' },
    })
    expect(
      items.map(({ sourceEntryId, label, servings }) => ({ sourceEntryId, label, servings })),
    ).toEqual([
      { sourceEntryId: null, label: 'Lentil stew', servings: null },
      { sourceEntryId: null, label: 'Bread', servings: null },
    ])
  })

  it("swapping the dinner keeps the link, and the total uses the new recipe's amounts", async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)

    await updateEntry(household.id, PLAN, 'dinner', { mealId: 'soup' })

    expect(await needed(household)).toEqual(everywhere({ beans: 1100 }))
    const [item] = await prisma.mealPlanEntryItem.findMany({
      where: { entryId: lunchId, position: 0 },
    })
    expect(item).toMatchObject({ sourceEntryId: 'dinner', servings: 2.5 })
  })

  it('a dinner made a fridge meal keeps the lunch, which then adds nothing', async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)

    await setFridgeItems(household.id, PLAN, 'dinner', [{ label: 'Pizza' }])

    expect(await needed(household)).toEqual(everywhere({}))
    const dinner = await dinnerRead(household)
    expect(dinner.cookServings).toBe(3)
    expect(dinner.leftoversFor).toEqual([])
    const [item] = await prisma.mealPlanEntryItem.findMany({
      where: { entryId: lunchId, position: 0 },
    })
    expect(item).toMatchObject({ sourceEntryId: 'dinner', servings: 2.5 })
  })

  it('reports the lunches it feeds on the dinner, and the servings on the lunch item', async () => {
    const household = await world()
    await lunch(household, 2, 2.5)
    await lunch(household, 3, 2)

    const { entries } = await loadPlanEntries(household, { startDate: day(0), endDate: day(7) })
    const dinner = entries.find((entry) => entry.id === 'dinner')!
    expect(dinner.leftoversFor).toEqual([
      { date: expect.any(String), mealType: 'lunch', servings: 2.5 },
      { date: expect.any(String), mealType: 'lunch', servings: 2 },
    ])
    expect(dinner.leftoversFor.map((l) => l.date)).toEqual(
      entries.filter((entry) => entry.mealType === 'lunch').map((entry) => entry.date),
    )
    const firstLunch = entries.find((entry) => entry.mealType === 'lunch')!
    expect(firstLunch.items[0]).toMatchObject({ sourceEntryId: 'dinner', servings: 2.5 })
  })

  it('cached tips priced at 3 are dropped once a lunch makes the total 5.5', async () => {
    const household = await world()
    const tips = { steps: ['Simmer'], pitfalls: [] }
    await prisma.mealPlanEntry.update({
      where: { id: 'dinner' },
      data: { preparationTips: serializePreparationSteps(tips, 3) },
    })
    expect((await dinnerRead(household)).preparationTips).toEqual(tips)

    await lunch(household, 2, 2.5)

    expect((await dinnerRead(household)).preparationTips).toBeNull()
  })

  it("editing the lunch's items in the app keeps each leftover item's servings", async () => {
    const household = await world()
    const lunchId = await lunch(household, 2, 2.5)
    const { entries } = await loadPlanEntries(household, { startDate: day(0), endDate: day(7) })
    const shown = entries.find((entry) => entry.id === lunchId)!

    // What Edit items sends: the shown items, through the routes' schema.
    const sent = fridgeItemsSchema.parse(
      JSON.parse(JSON.stringify(shown.items.map(toFridgeItemInput))),
    )
    await setFridgeItems(household.id, PLAN, lunchId, sent)

    const items = await prisma.mealPlanEntryItem.findMany({
      where: { entryId: lunchId },
      orderBy: { position: 'asc' },
    })
    expect(items.map((item) => item.servings)).toEqual([2.5, null])
    expect(await needed(household)).toEqual(everywhere({ lentils: 550 }))
  })
})
