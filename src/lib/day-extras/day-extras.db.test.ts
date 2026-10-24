import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { deleteEntriesInRange } from '@/lib/meal-plans/entries'
import { createEmptyPlan } from '@/lib/ai/generate-plan'
import { createDayExtra, deleteDayExtra, loadDayExtras, updateDayExtraQuantity } from './day-extras'

// Day extras (HON-1309), against PGlite through the `unit-db` project, with no
// mocks. The route tests cover only how each route maps these outcomes.

// Thursday 15 October 2026, noon in Tallinn. Only `Date` is faked, so "today"
// is fixed and PGlite's timers still run.
const NOW = new Date('2026-10-15T09:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const WINDOW = {
  startDate: new Date('2026-10-15T00:00:00Z'),
  endDate: new Date('2026-10-30T00:00:00Z'),
}

/**
 * Alder (English) and Birch (Estonian), both in Tallinn. Red wine is global,
 * with an Estonian name; Birch's crisps are Birch's own.
 */
async function world() {
  const alder = await prisma.household.create({
    data: {
      id: 'hh-alder',
      name: 'Alder',
      timezone: 'Europe/Tallinn',
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({
    data: { id: 'hh-birch', name: 'Birch', locale: 'et', timezone: 'Europe/Tallinn' },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-wine',
      name: 'Red wine',
      category: 'condiment',
      defaultUnit: 'g',
      measuredByVolume: true,
      calories: 85,
      protein: 0,
      carbs: 3,
      fat: 0,
      translations: { create: { locale: 'et', name: 'Punane vein' } },
    },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-birch-crisps',
      name: 'Birch crisps',
      category: 'carb',
      defaultUnit: 'g',
      householdId: birch.id,
      calories: 500,
      protein: 5,
      carbs: 50,
      fat: 30,
    },
  })
  return { alder, birch }
}

describe('createDayExtra', () => {
  it('adds an ingredient extra with an amount, in the household language', async () => {
    const { birch } = await world()

    const outcome = await createDayExtra(birch, {
      date: '2026-10-17',
      ingredientId: 'ing-wine',
      quantity: 750,
    })

    expect(outcome).toEqual({
      status: 'created',
      extra: {
        id: expect.any(String),
        date: '2026-10-17',
        ingredientId: 'ing-wine',
        name: 'Punane vein',
        quantity: 750,
        unit: 'ml',
      },
    })
    expect(await loadDayExtras(birch, WINDOW)).toEqual([
      outcome.status === 'created' && outcome.extra,
    ])
  })

  it('adds a free-text extra and the manual shopping item of the same name', async () => {
    const { alder } = await world()

    const outcome = await createDayExtra(alder, { date: '2026-10-15', label: 'chips' })

    expect(outcome).toMatchObject({
      status: 'created',
      extra: { date: '2026-10-15', ingredientId: null, name: 'chips', quantity: null, unit: null },
    })
    const items = await prisma.customShoppingItem.findMany({ where: { householdId: alder.id } })
    expect(items.map((i) => i.name)).toEqual(['chips'])
  })

  it('succeeds and adds no second item when the name is on the list already', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({ data: { householdId: alder.id, name: 'chips' } })

    const outcome = await createDayExtra(alder, { date: '2026-10-16', label: 'chips' })

    expect(outcome.status).toBe('created')
    expect(await prisma.customShoppingItem.count({ where: { householdId: alder.id } })).toBe(1)
    expect(await prisma.dayExtra.count({ where: { householdId: alder.id } })).toBe(1)
  })

  it('returns the saved extra when the shopping-list copy fails', async () => {
    const { alder } = await world()
    // The copy runs after the extra is saved, so a failure there must not
    // read as a failed add: the household would add the extra twice.
    vi.spyOn(prisma.customShoppingItem, 'findUnique').mockRejectedValueOnce(new Error('db down'))

    const outcome = await createDayExtra(alder, { date: '2026-10-16', label: 'chips' })

    expect(outcome).toMatchObject({ status: 'created', extra: { name: 'chips' } })
    expect(await prisma.dayExtra.count({ where: { householdId: alder.id } })).toBe(1)
    expect(await prisma.customShoppingItem.count()).toBe(0)
  })

  it('refuses a day before today in the household timezone', async () => {
    const { alder } = await world()

    const outcome = await createDayExtra(alder, { date: '2026-10-14', label: 'chips' })

    expect(outcome).toEqual({ status: 'past_date' })
    expect(await prisma.dayExtra.count()).toBe(0)
    expect(await prisma.customShoppingItem.count()).toBe(0)
  })

  it("refuses another household's own ingredient", async () => {
    const { alder } = await world()

    const outcome = await createDayExtra(alder, {
      date: '2026-10-16',
      ingredientId: 'ing-birch-crisps',
    })

    expect(outcome).toEqual({ status: 'ingredient_not_found' })
    expect(await prisma.dayExtra.count()).toBe(0)
  })

  it("accepts the household's own ingredient, with no amount", async () => {
    const { birch } = await world()

    const outcome = await createDayExtra(birch, {
      date: '2026-10-16',
      ingredientId: 'ing-birch-crisps',
    })

    expect(outcome).toMatchObject({
      status: 'created',
      extra: { name: 'Birch crisps', quantity: null, unit: 'g' },
    })
  })

  it('puts a new extra after the day’s other extras', async () => {
    const { alder } = await world()
    await createDayExtra(alder, { date: '2026-10-16', label: 'olives' })
    await createDayExtra(alder, { date: '2026-10-15', label: 'bread' })
    await createDayExtra(alder, { date: '2026-10-16', ingredientId: 'ing-wine' })

    const names = (await loadDayExtras(alder, WINDOW)).map((e) => `${e.date} ${e.name}`)

    expect(names).toEqual(['2026-10-15 bread', '2026-10-16 olives', '2026-10-16 Red wine'])
  })
})

describe('the day_extra CHECK', () => {
  it('refuses a free-text row with an amount', async () => {
    const { alder } = await world()

    await expect(
      prisma.dayExtra.create({
        data: {
          householdId: alder.id,
          date: WINDOW.startDate,
          label: 'chips',
          quantity: 2,
          position: 0,
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses a row with both an ingredient and a label, or neither', async () => {
    const { alder } = await world()
    const base = { householdId: alder.id, date: WINDOW.startDate, position: 0 }

    await expect(
      prisma.dayExtra.create({ data: { ...base, ingredientId: 'ing-wine', label: 'wine' } }),
    ).rejects.toThrow()
    await expect(prisma.dayExtra.create({ data: base })).rejects.toThrow()
  })
})

describe('loadDayExtras', () => {
  it("reads only the household's extras in the range", async () => {
    const { alder, birch } = await world()
    await createDayExtra(alder, { date: '2026-10-15', label: 'chips' })
    await createDayExtra(alder, { date: '2026-10-30', label: 'past the range' })
    await createDayExtra(birch, { date: '2026-10-15', label: 'olives' })
    await prisma.dayExtra.create({
      data: {
        householdId: alder.id,
        date: new Date('2026-10-14T00:00:00Z'),
        label: 'yesterday',
        position: 0,
      },
    })

    const names = (await loadDayExtras(alder, WINDOW)).map((e) => e.name)

    expect(names).toEqual(['chips'])
  })
})

describe('updateDayExtraQuantity', () => {
  it('sets and clears an ingredient extra’s amount', async () => {
    const { alder } = await world()
    const created = await createDayExtra(alder, { date: '2026-10-16', ingredientId: 'ing-wine' })
    if (created.status !== 'created') throw new Error('not created')

    expect(await updateDayExtraQuantity(alder, created.extra.id, 1500)).toMatchObject({
      status: 'updated',
      extra: { quantity: 1500 },
    })
    expect(await updateDayExtraQuantity(alder, created.extra.id, null)).toMatchObject({
      status: 'updated',
      extra: { quantity: null },
    })
  })

  it('refuses an amount on free text', async () => {
    const { alder } = await world()
    const created = await createDayExtra(alder, { date: '2026-10-16', label: 'chips' })
    if (created.status !== 'created') throw new Error('not created')

    expect(await updateDayExtraQuantity(alder, created.extra.id, 2)).toEqual({
      status: 'free_text',
    })
  })

  it("does not find another household's extra", async () => {
    const { alder, birch } = await world()
    const created = await createDayExtra(alder, { date: '2026-10-16', ingredientId: 'ing-wine' })
    if (created.status !== 'created') throw new Error('not created')

    expect(await updateDayExtraQuantity(birch, created.extra.id, 2)).toEqual({
      status: 'not_found',
    })
    expect(await prisma.dayExtra.findUnique({ where: { id: created.extra.id } })).toMatchObject({
      quantity: null,
    })
  })
})

describe('deleteDayExtra', () => {
  it('deletes the extra and leaves its manual shopping item', async () => {
    const { alder } = await world()
    const created = await createDayExtra(alder, { date: '2026-10-16', label: 'chips' })
    if (created.status !== 'created') throw new Error('not created')

    expect(await deleteDayExtra(alder.id, created.extra.id)).toEqual({ status: 'deleted' })
    expect(await prisma.dayExtra.count()).toBe(0)
    expect(await prisma.customShoppingItem.count({ where: { name: 'chips' } })).toBe(1)
  })

  it("does not delete another household's extra", async () => {
    const { alder, birch } = await world()
    const created = await createDayExtra(alder, { date: '2026-10-16', label: 'chips' })
    if (created.status !== 'created') throw new Error('not created')

    expect(await deleteDayExtra(birch.id, created.extra.id)).toEqual({ status: 'not_found' })
    expect(await prisma.dayExtra.count()).toBe(1)
  })
})

describe('a plan range regenerated or cleared', () => {
  it('leaves every extra in a regenerated range unchanged', async () => {
    const { alder } = await world()
    await createDayExtra(alder, { date: '2026-10-16', ingredientId: 'ing-wine', quantity: 750 })
    await createDayExtra(alder, { date: '2026-10-17', label: 'chips' })
    await prisma.mealPlanEntry.create({
      data: { planId: 'plan-alder', date: new Date('2026-10-16T00:00:00Z'), mealType: 'dinner' },
    })
    const before = await loadDayExtras(alder, WINDOW)

    // "Regenerate a range" with no AI: the same `deleteReplaceableEntries`
    // the AI generation runs first.
    await createEmptyPlan({
      householdId: alder.id,
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
    })

    expect(await prisma.mealPlanEntry.count()).toBe(0)
    expect(before).toHaveLength(2)
    expect(await loadDayExtras(alder, WINDOW)).toEqual(before)
  })

  it('leaves every extra in a cleared range unchanged', async () => {
    const { alder } = await world()
    await createDayExtra(alder, { date: '2026-10-16', ingredientId: 'ing-wine', quantity: 750 })
    await createDayExtra(alder, { date: '2026-10-17', label: 'chips' })
    await prisma.mealPlanEntry.create({
      data: { planId: 'plan-alder', date: new Date('2026-10-16T00:00:00Z'), mealType: 'dinner' },
    })
    const before = await prisma.dayExtra.findMany({ orderBy: { date: 'asc' } })

    expect(
      await deleteEntriesInRange(alder.id, 'plan-alder', WINDOW.startDate, WINDOW.endDate),
    ).toBe(1)

    expect(await prisma.dayExtra.findMany({ orderBy: { date: 'asc' } })).toEqual(before)
  })
})
