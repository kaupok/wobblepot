import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadFrequentMeals, loadRecentFridgeLabels } from './past-logging'

// What Past meals offers first when a household logs a meal it ate
// (HON-1383). Runs against PGlite through the `unit-db` project, with no mocks.

// Noon on 31 October in Tallinn: the 30-day window starts on 1 October.
const NOW = new Date('2026-10-31T10:00:00Z')
const TZ = 'Europe/Tallinn'

async function world() {
  for (const [id, name] of <const>[
    ['meal-soup', 'Soup'],
    ['meal-pasta', 'Pasta'],
    ['meal-stew', 'Stew'],
    ['meal-pie', 'Pie'],
  ]) {
    await prisma.meal.create({ data: { id, name } })
  }
  await prisma.mealTranslation.create({
    data: { mealId: 'meal-pasta', locale: 'et', name: 'Pasta et' },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', timezone: TZ, mealPlans: { create: { id: 'plan-alder' } } },
  })
  await prisma.household.create({
    data: { name: 'Birch', timezone: TZ, mealPlans: { create: { id: 'plan-birch' } } },
  })
  let n = 0
  const entry = (date: string, data: Record<string, unknown> = {}, planId = 'plan-alder') =>
    prisma.mealPlanEntry.create({
      data: {
        id: `entry-${++n}`,
        planId,
        date: parseLocalDate(date),
        mealType: 'dinner',
        status: 'completed',
        ...data,
      },
    })
  return { alder: { id: alder.id, timezone: TZ, locale: null as string | null }, entry }
}

describe('loadFrequentMeals', () => {
  it('lists the meals cooked in the last 30 days, most often first', async () => {
    const { alder, entry } = await world()
    // Stew three times, soup twice, pasta once: not the order of their ids.
    await entry('2026-10-30', { mealId: 'meal-stew' })
    await entry('2026-10-20', { mealId: 'meal-stew' })
    await entry('2026-10-02', { mealId: 'meal-stew' })
    await entry('2026-10-29', { mealId: 'meal-soup' })
    await entry('2026-10-28', { mealId: 'meal-soup' })
    await entry('2026-10-27', { mealId: 'meal-pasta' })

    expect(await loadFrequentMeals(alder, NOW)).toEqual([
      { id: 'meal-stew', name: 'Stew' },
      { id: 'meal-soup', name: 'Soup' },
      { id: 'meal-pasta', name: 'Pasta' },
    ])
  })

  it('puts the meal cooked latest first among equals', async () => {
    const { alder, entry } = await world()
    await entry('2026-10-10', { mealId: 'meal-soup' })
    await entry('2026-10-25', { mealId: 'meal-stew' })

    const ids = (await loadFrequentMeals(alder, NOW)).map((m) => m.id)

    expect(ids).toEqual(['meal-stew', 'meal-soup'])
  })

  it('counts only completed meals of this household inside the window', async () => {
    const { alder, entry } = await world()
    await entry('2026-10-30', { mealId: 'meal-soup' })
    // 31 days back: outside.
    await entry('2026-09-30', { mealId: 'meal-pie' })
    await entry('2026-10-29', { mealId: 'meal-stew', status: 'planned' })
    await entry('2026-10-28', { mealId: 'meal-stew', status: 'skipped' })
    await entry('2026-10-27', { mealId: 'meal-pasta' }, 'plan-birch')

    const ids = (await loadFrequentMeals(alder, NOW)).map((m) => m.id)

    expect(ids).toEqual(['meal-soup'])
  })

  it('leaves out a deleted recipe, however often it was cooked', async () => {
    const { alder, entry } = await world()
    await entry('2026-10-30', { mealId: 'meal-pie' })
    await entry('2026-10-29', { mealId: 'meal-pie' })
    await entry('2026-10-28', { mealId: 'meal-soup' })
    await prisma.meal.update({ where: { id: 'meal-pie' }, data: { deletedAt: new Date() } })

    const ids = (await loadFrequentMeals(alder, NOW)).map((m) => m.id)

    expect(ids).toEqual(['meal-soup'])
  })

  it("names the meal in the household's language", async () => {
    const { alder, entry } = await world()
    await entry('2026-10-30', { mealId: 'meal-pasta' })

    expect(await loadFrequentMeals({ ...alder, locale: 'et' }, NOW)).toEqual([
      { id: 'meal-pasta', name: 'Pasta et' },
    ])
  })

  it('is empty for a household that cooked nothing', async () => {
    const { alder } = await world()

    expect(await loadFrequentMeals(alder, NOW)).toEqual([])
  })
})

describe('loadRecentFridgeLabels', () => {
  const fridge = (labels: string[]) => ({
    kind: 'fridge',
    items: { create: labels.map((label, position) => ({ label, position })) },
  })

  it('lists the free-text items of the last 30 days, latest first, each once', async () => {
    const { alder, entry } = await world()
    await entry('2026-10-30', fridge(['Wolt']))
    await entry('2026-10-25', fridge(['pelmeenid', 'sour cream']))
    await entry('2026-10-20', fridge(['wolt']))
    await entry('2026-10-15', { ...fridge(['borscht']), status: 'planned' })

    expect(await loadRecentFridgeLabels(alder, NOW)).toEqual([
      'Wolt',
      'pelmeenid',
      'sour cream',
      'borscht',
    ])
  })

  it('leaves out older labels, leftovers and other households', async () => {
    const { alder, entry } = await world()
    await entry('2026-10-29', { id: 'source', mealId: 'meal-soup', mealType: 'lunch' })
    await entry('2026-10-30', {
      kind: 'fridge',
      items: { create: [{ sourceEntryId: 'source', position: 0 }] },
    })
    await entry('2026-09-30', fridge(['Too old']))
    await entry('2026-10-29', fridge(['Theirs']), 'plan-birch')
    await entry('2026-10-28', fridge(['Ours']))

    expect(await loadRecentFridgeLabels(alder, NOW)).toEqual(['Ours'])
  })
})
