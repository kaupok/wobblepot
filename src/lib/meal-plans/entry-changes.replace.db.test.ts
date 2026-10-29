import { describe, expect, it } from 'vitest'

import type { MealPlanEntryStatus } from '@/generated/prisma/enums'
import {
  addEntryChange,
  EntryChangeError,
  type EntryChangeRefusal,
  removeEntryChange,
  replaceEntryChanges,
} from '@/lib/meal-plans/entry-changes'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const TIPS = '{"steps":["Boil"],"pitfalls":[],"servings":2}'

/**
 * Alder plans a mushroom cream pasta for dinner with cached tips: 100 g pasta,
 * 50 g cream and 40 g mushroom per serving. Yoghurt, chili and basil are
 * global; Birch has its own ingredient.
 */
async function world(status: MealPlanEntryStatus = 'planned') {
  const ingredient = (id: string, householdId: string | null = null) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id,
        householdId,
        category: 'dairy',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  for (const id of ['pasta', 'cream', 'mushroom', 'yoghurt', 'chili', 'basil']) {
    await ingredient(id)
  }
  await ingredient('birch-secret', birch.id)
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Mushroom cream pasta',
      components: {
        create: [
          { ingredientId: 'pasta', quantityPerServing: 100 },
          { ingredientId: 'cream', quantityPerServing: 50 },
          { ingredientId: 'mushroom', quantityPerServing: 40 },
        ],
      },
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-mon',
      planId: 'plan-alder',
      date: new Date('2026-10-19T00:00:00Z'),
      mealType: 'dinner',
      mealId: 'meal-pasta',
      status,
      preparationTips: TIPS,
    },
  })
  return { alder, birch }
}

const change = (
  originalIngredientId: string | null,
  replacementIngredientId: string | null,
  quantityPerServing: number | null = replacementIngredientId ? 60 : null,
) => ({ originalIngredientId, replacementIngredientId, quantityPerServing })

async function refusal(promise: Promise<unknown>): Promise<EntryChangeRefusal> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EntryChangeError)
  return (error as EntryChangeError).reason
}

/** The stored change ids, as the client last read them. */
const storedIds = async () =>
  (
    await prisma.mealPlanEntryComponent.findMany({
      where: { entryId: 'entry-mon' },
      select: { id: true },
    })
  ).map((c) => c.id)

const entryRow = () => prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-mon' } })
const rows = () =>
  prisma.mealPlanEntryComponent.findMany({
    where: { entryId: 'entry-mon' },
    orderBy: { createdAt: 'asc' },
    select: { originalIngredientId: true, replacementIngredientId: true },
  })

describe('replaceEntryChanges', () => {
  it('replaces the whole set, stores the instruction, nulls the tips and returns the merge', async () => {
    const { alder } = await world()
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', change('pasta', null))

    const { components } = await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change('cream', 'yoghurt'), change('mushroom', null), change(null, 'chili', 2)],
      adjustmentNote: 'No cream, I have yoghurt',
      noteMode: 'append',
    })

    expect(components.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['yoghurt', 60],
      ['chili', 2],
    ])
    expect(await rows()).toEqual([
      { originalIngredientId: 'cream', replacementIngredientId: 'yoghurt' },
      { originalIngredientId: 'mushroom', replacementIngredientId: null },
      { originalIngredientId: null, replacementIngredientId: 'chili' },
    ])
    const entry = await entryRow()
    expect(entry.adjustmentNote).toBe('No cream, I have yoghurt')
    expect(entry.preparationTips).toBeNull()
  })

  it('keeps the added rows in the order the set lists them', async () => {
    const { alder } = await world()

    const { components } = await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change(null, 'chili', 2), change(null, 'basil', 3), change(null, 'yoghurt', 5)],
      adjustmentNote: 'More flavour',
      noteMode: 'append',
    })

    expect(components.slice(3).map((c) => c.ingredientId)).toEqual(['chili', 'basil', 'yoghurt'])
  })

  it('stores an instruction with no change, and keeps it through a later adjustment', async () => {
    const { alder } = await world()

    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: [],
      changes: [],
      adjustmentNote: 'Less salt',
      noteMode: 'append',
    })
    expect((await entryRow()).adjustmentNote).toBe('Less salt')
    expect((await entryRow()).preparationTips).toBeNull()

    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: [],
      changes: [change('cream', 'yoghurt')],
      adjustmentNote: 'No cream',
      noteMode: 'append',
    })
    expect((await entryRow()).adjustmentNote).toBe('Less salt\nNo cream')
  })

  it('clears the instruction on replace, and keeps the changes', async () => {
    const { alder } = await world()
    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: [],
      changes: [change('cream', 'yoghurt')],
      adjustmentNote: 'No cream, less salt',
      noteMode: 'append',
    })

    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change('cream', 'yoghurt')],
      adjustmentNote: null,
      noteMode: 'replace',
    })

    expect(await rows()).toEqual([
      { originalIngredientId: 'cream', replacementIngredientId: 'yoghurt' },
    ])
    expect((await entryRow()).adjustmentNote).toBeNull()
  })

  it.each([
    [
      'two changes on one original',
      [change('cream', 'yoghurt'), change('cream', null)],
      'alreadyChanged',
    ],
    [
      'one ingredient brought in twice',
      [change('cream', 'yoghurt'), change(null, 'yoghurt', 5)],
      'alreadyInMeal',
    ],
    ['an ingredient the recipe has', [change(null, 'pasta', 5)], 'alreadyInMeal'],
    ['an original the recipe lacks', [change('basil', null)], 'originalNotInMeal'],
    ["another household's ingredient", [change(null, 'birch-secret', 5)], 'ingredientNotFound'],
  ] as const)('refuses %s and keeps the stored set', async (_label, changes, reason) => {
    const { alder } = await world()
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', change('mushroom', null))

    expect(
      await refusal(
        replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
          basedOn: await storedIds(),
          changes: [...changes],
          adjustmentNote: 'x',
          noteMode: 'append',
        }),
      ),
    ).toBe(reason)
    expect(await rows()).toEqual([
      { originalIngredientId: 'mushroom', replacementIngredientId: null },
    ])
    expect((await entryRow()).adjustmentNote).toBeNull()
  })

  it('refuses a set built before someone else changed the meal, and keeps their change', async () => {
    const { alder } = await world()
    const seen = await storedIds()
    await addEntryChange(alder.id, 'plan-alder', 'entry-mon', change('mushroom', null))

    expect(
      await refusal(
        replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
          basedOn: seen,
          changes: [change('cream', 'yoghurt')],
          adjustmentNote: 'No cream',
          noteMode: 'append',
        }),
      ),
    ).toBe('changesMoved')
    expect(await rows()).toEqual([
      { originalIngredientId: 'mushroom', replacementIngredientId: null },
    ])
  })

  it('keeps the earlier instruction while its change stays, and drops it with the change', async () => {
    const { alder } = await world()
    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: [],
      changes: [change('mushroom', null)],
      adjustmentNote: 'Less salt, no mushrooms',
      noteMode: 'append',
    })

    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change('mushroom', null), change('cream', 'yoghurt')],
      adjustmentNote: 'No cream',
      noteMode: 'append',
    })
    expect((await entryRow()).adjustmentNote).toBe('Less salt, no mushrooms\nNo cream')

    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change(null, 'basil', 2)],
      adjustmentNote: 'Add basil',
      noteMode: 'append',
    })
    expect((await entryRow()).adjustmentNote).toBe('Add basil')
  })

  it('refuses a cooked entry with notPlanned', async () => {
    const { alder } = await world('completed')

    expect(
      await refusal(
        replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
          basedOn: await storedIds(),
          changes: [change('cream', 'yoghurt')],
          adjustmentNote: 'x',
          noteMode: 'append',
        }),
      ),
    ).toBe('notPlanned')
  })

  it("refuses another household's entry with entryNotFound", async () => {
    const { birch } = await world()

    expect(
      await refusal(
        replaceEntryChanges(birch.id, 'plan-alder', 'entry-mon', {
          basedOn: await storedIds(),
          changes: [],
          adjustmentNote: null,
          noteMode: 'append',
        }),
      ),
    ).toBe('entryNotFound')
  })
})

describe('removeEntryChange and the instruction', () => {
  it('keeps the instruction while a change is left, and clears it with the last one', async () => {
    const { alder } = await world()
    await replaceEntryChanges(alder.id, 'plan-alder', 'entry-mon', {
      basedOn: await storedIds(),
      changes: [change('cream', 'yoghurt'), change('mushroom', null)],
      adjustmentNote: 'No cream, no mushrooms',
      noteMode: 'append',
    })
    const [first, second] = await prisma.mealPlanEntryComponent.findMany({
      where: { entryId: 'entry-mon' },
      orderBy: { createdAt: 'asc' },
    })

    await removeEntryChange(alder.id, 'plan-alder', 'entry-mon', first!.id)
    expect((await entryRow()).adjustmentNote).toBe('No cream, no mushrooms')

    await removeEntryChange(alder.id, 'plan-alder', 'entry-mon', second!.id)
    expect((await entryRow()).adjustmentNote).toBeNull()
  })
})
