import { describe, expect, it } from 'vitest'

import { type EntryPatch, EntryUpdateError, updateEntry } from '@/lib/meal-plans/entries'
import { addEntryChange } from '@/lib/meal-plans/entry-changes'
import { prisma } from '@/lib/prisma'

// `updateEntry` with an entry's own ingredient changes (HON-1243): the
// deduction charges the merged list, and a swap drops the changes. Runs against
// PGlite through the `unit-db` project, with no mocks.

const INGREDIENTS = ['beef', 'apple', 'salt', 'rice'] as const

/**
 * Alder: two adults, so 2 servings. Its plan has a planned stew dinner and a
 * second stew entry on the next day. Stew is 100 g beef, 20 g apple and 2 g
 * salt per serving; salad is 50 g apple. The pantry holds 1000 of each.
 */
async function world() {
  for (const id of INGREDIENTS) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'spice',
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
      members: { create: [{ name: 'A' }, { name: 'B' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const meal = (id: string, components: Record<string, number>) =>
    prisma.meal.create({
      data: {
        id,
        name: id,
        components: {
          create: Object.entries(components).map(([ingredientId, quantityPerServing]) => ({
            ingredientId,
            quantityPerServing,
          })),
        },
      },
    })
  await meal('meal-stew', { beef: 100, apple: 20, salt: 2 })
  await meal('meal-salad', { apple: 50 })
  for (const [id, date] of [
    ['entry-mon', '2026-10-19'],
    ['entry-tue', '2026-10-20'],
  ]) {
    await prisma.mealPlanEntry.create({
      data: {
        id: id!,
        planId: 'plan-alder',
        date: new Date(`${date}T00:00:00Z`),
        mealType: 'dinner',
        mealId: 'meal-stew',
      },
    })
  }
  for (const ingredientId of INGREDIENTS) {
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId, quantity: 1000 },
    })
  }
  return alder
}

async function pantry(householdId: string) {
  const rows = await prisma.pantryItem.findMany({ where: { householdId } })
  return Object.fromEntries(rows.map((row) => [row.ingredientId, row.quantity]))
}

const complete: EntryPatch = { status: 'completed', deductPantry: true }

const change = (
  householdId: string,
  originalIngredientId: string | null,
  replacementIngredientId: string | null,
  quantityPerServing: number | null,
  entryId = 'entry-mon',
) =>
  addEntryChange(householdId, 'plan-alder', entryId, {
    originalIngredientId,
    replacementIngredientId,
    quantityPerServing,
  })

const changeCount = (entryId = 'entry-mon') =>
  prisma.mealPlanEntryComponent.count({ where: { entryId } })

describe('updateEntry: deduction with ingredient changes', () => {
  it('charges the replacement, never the original', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', complete)

    // 2 servings: 200 g beef, 60 g rice, 4 g salt; no apple.
    expect(await pantry(alder.id)).toEqual({ beef: 800, apple: 1000, salt: 996, rice: 940 })
  })

  it('charges nothing for a left-out ingredient', async () => {
    const alder = await world()
    await change(alder.id, 'beef', null, null)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', complete)

    expect(await pantry(alder.id)).toEqual({ beef: 1000, apple: 960, salt: 996, rice: 1000 })
  })

  it('charges an added ingredient', async () => {
    const alder = await world()
    await change(alder.id, null, 'rice', 75)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', complete)

    expect(await pantry(alder.id)).toEqual({ beef: 800, apple: 960, salt: 996, rice: 850 })
  })

  it("charges another entry of the same meal for the recipe, not this entry's changes", async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)

    await updateEntry(alder.id, 'plan-alder', 'entry-tue', complete)

    expect(await pantry(alder.id)).toEqual({ beef: 800, apple: 960, salt: 996, rice: 1000 })
  })

  it('charges the incoming meal on a swap-and-complete and drops the old changes', async () => {
    const alder = await world()
    await change(alder.id, null, 'rice', 75)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { ...complete, mealId: 'meal-salad' })

    expect(await pantry(alder.id)).toEqual({ beef: 1000, apple: 900, salt: 1000, rice: 1000 })
    expect(await changeCount()).toBe(0)
  })

  it('never leaves a completion charged for a change set a concurrent change moved', async () => {
    const alder = await world()

    await Promise.allSettled([
      updateEntry(alder.id, 'plan-alder', 'entry-mon', complete),
      change(alder.id, 'apple', 'rice', 30),
    ])

    const stored = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-mon' } })
    const replaced = (await changeCount()) === 1
    if (stored.status !== 'completed') {
      // The completion lost to the change and refused (`staleMeal`): nothing charged.
      expect(await pantry(alder.id)).toEqual({ beef: 1000, apple: 1000, salt: 1000, rice: 1000 })
    } else if (replaced) {
      expect(await pantry(alder.id)).toEqual({ beef: 800, apple: 1000, salt: 996, rice: 940 })
    } else {
      expect(await pantry(alder.id)).toEqual({ beef: 800, apple: 960, salt: 996, rice: 1000 })
    }
  })
})

describe('updateEntry: swap with ingredient changes', () => {
  it('drops the changes when the entry is repointed at another meal', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-salad' })

    expect(await changeCount()).toBe(0)
  })

  it('drops the "Adjust recipe" instruction with them, and keeps it on a re-select (HON-1244)', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)
    const note = () =>
      prisma.mealPlanEntry
        .findUniqueOrThrow({ where: { id: 'entry-mon' } })
        .then((e) => e.adjustmentNote)
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-mon' },
      data: { adjustmentNote: 'Less salt' },
    })

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-stew' })
    expect(await note()).toBe('Less salt')

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-salad' })
    expect(await note()).toBeNull()
  })

  it('keeps the changes when the patch re-sends the meal already on the entry', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-stew' })

    expect(await changeCount()).toBe(1)
  })

  it('keeps the changes of another entry', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30, 'entry-tue')

    await updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-salad' })

    expect(await changeCount('entry-tue')).toBe(1)
  })

  it('keeps the changes when the swap is refused on a completed entry', async () => {
    const alder = await world()
    await change(alder.id, 'apple', 'rice', 30)
    await prisma.mealPlanEntry.update({ where: { id: 'entry-mon' }, data: { status: 'completed' } })

    await expect(
      updateEntry(alder.id, 'plan-alder', 'entry-mon', { mealId: 'meal-salad' }),
    ).rejects.toEqual(new EntryUpdateError('completedSwap'))

    expect(await changeCount()).toBe(1)
  })
})
