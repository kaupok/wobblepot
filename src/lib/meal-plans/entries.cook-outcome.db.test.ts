import { describe, expect, it } from 'vitest'

import type { IngredientCategory } from '@/generated/prisma/enums'
import { type EntryPatch, updateEntry } from '@/lib/meal-plans/entries'
import { prisma } from '@/lib/prisma'

// What a cooked recipe meal does to "have some" pantry rows (HON-1563): the
// cook's `usedUpIngredientIds` when sent, else `defaultCookOutcome`. A row
// that runs out reads `0` and stays. Runs against PGlite through the
// `unit-db` project, with no mocks.

const INGREDIENTS: Record<string, IngredientCategory> = {
  beetroot: 'vegetable',
  pumpkin: 'vegetable',
  cumin: 'spice',
  quinoa: 'carb',
  tahini: 'condiment',
  mince: 'protein',
  carrot: 'vegetable',
}

/**
 * Alder: one adult, so 1 serving. Its plan has a planned roast dinner: 200 g
 * beetroot, 300 g pumpkin, 2 g cumin and 600 g quinoa per serving. Soup is
 * 400 g pumpkin. A planned stew lunch is 500 g mince and 400 g carrot.
 */
async function world() {
  for (const [id, category] of Object.entries(INGREDIENTS)) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category,
        subcategory: id === 'quinoa' ? 'grain' : null,
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
      members: { create: [{ name: 'A' }] },
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
  await meal('meal-roast', { beetroot: 200, pumpkin: 300, cumin: 2, quinoa: 600 })
  await meal('meal-soup', { pumpkin: 400 })
  await meal('meal-stew', { mince: 500, carrot: 400 })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-stew',
      planId: 'plan-alder',
      mealId: 'meal-stew',
      date: new Date('2026-11-01T00:00:00Z'),
      mealType: 'lunch',
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-roast',
      planId: 'plan-alder',
      mealId: 'meal-roast',
      date: new Date('2026-11-01T00:00:00Z'),
      mealType: 'dinner',
    },
  })
  return alder.id
}

async function stock(householdId: string, rows: Record<string, number | null>) {
  for (const [ingredientId, quantity] of Object.entries(rows)) {
    await prisma.pantryItem.create({ data: { householdId, ingredientId, quantity } })
  }
}

/** The household's pantry as `ingredientId → quantity`; a missing key is no row. */
async function pantry(householdId: string) {
  const rows = await prisma.pantryItem.findMany({ where: { householdId } })
  return Object.fromEntries(rows.map((row) => [row.ingredientId, row.quantity]))
}

const update = (householdId: string, patch: EntryPatch) =>
  updateEntry(householdId, 'plan-alder', 'entry-roast', patch)

const complete: EntryPatch = { status: 'completed', deductPantry: true }

const readEntry = () => prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-roast' } })

describe('updateEntry: a cooked meal and "have some" rows', () => {
  it('runs out only the rows the cook names', async () => {
    const householdId = await world()
    await stock(householdId, { beetroot: null, cumin: null, pumpkin: null })

    const result = await update(householdId, { ...complete, usedUpIngredientIds: ['beetroot'] })

    expect(result).toMatchObject({ pantryDeducted: true })
    expect(await pantry(householdId)).toEqual({ beetroot: 0, cumin: null, pumpkin: null })
    expect((await readEntry()).pantryDeductedAt).toBeInstanceOf(Date)
  })

  it('runs out a fresh row and keeps a cupboard row when the cook names none', async () => {
    const householdId = await world()
    await stock(householdId, { beetroot: null, cumin: null, pumpkin: null, quinoa: null })

    await update(householdId, complete)

    expect(await pantry(householdId)).toEqual({
      beetroot: 0,
      cumin: null,
      pumpkin: 0,
      quinoa: null,
    })
  })

  it('keeps every "have some" row for an empty list', async () => {
    const householdId = await world()
    await stock(householdId, { beetroot: null, pumpkin: null })

    await update(householdId, { ...complete, usedUpIngredientIds: [] })

    expect(await pantry(householdId)).toEqual({ beetroot: null, pumpkin: null })
  })

  it('sets an overshot known row to 0 and keeps it', async () => {
    const householdId = await world()
    await stock(householdId, { quinoa: 500 })

    await update(householdId, complete)

    expect(await pantry(householdId)).toEqual({ quinoa: 0 })
  })

  it('ignores a named id that is not in the meal', async () => {
    const householdId = await world()
    await stock(householdId, { tahini: null, beetroot: null })

    await update(householdId, { ...complete, usedUpIngredientIds: ['tahini', 'beetroot'] })

    expect(await pantry(householdId)).toEqual({ tahini: null, beetroot: 0 })
  })

  it('writes the pantry once across complete, revert, complete', async () => {
    const householdId = await world()
    await stock(householdId, { beetroot: null, quinoa: 1000 })

    await update(householdId, { ...complete, usedUpIngredientIds: [] })
    await update(householdId, { status: 'planned' })
    await update(householdId, { ...complete, usedUpIngredientIds: ['beetroot'] })

    expect(await pantry(householdId)).toEqual({ beetroot: null, quinoa: 400 })
  })

  it('applies the default to the incoming meal on a swap-and-complete', async () => {
    const householdId = await world()
    await stock(householdId, { pumpkin: null, cumin: null })

    await update(householdId, { ...complete, mealId: 'meal-soup' })

    expect(await pantry(householdId)).toEqual({ pumpkin: 0, cumin: null })
  })
})

// A known-amount row the cook names used up or some left (HON-1583).
describe('updateEntry: a cooked meal and known-amount rows', () => {
  const cookStew = (householdId: string, patch: EntryPatch) =>
    updateEntry(householdId, 'plan-alder', 'entry-stew', { ...complete, ...patch })

  it('sets a used-up row with some left on paper to 0 and keeps it', async () => {
    const householdId = await world()
    await stock(householdId, { mince: 1000 })

    await cookStew(householdId, { usedUpIngredientIds: ['mince'] })

    expect(await pantry(householdId)).toEqual({ mince: 0 })
  })

  it('makes an overshot row the cook says has some left "have some"', async () => {
    const householdId = await world()
    await stock(householdId, { carrot: 300 })

    await cookStew(householdId, { usedUpIngredientIds: [], someLeftIngredientIds: ['carrot'] })

    expect(await pantry(householdId)).toEqual({ carrot: null })
  })

  it('subtracts a some-left row that still has some', async () => {
    const householdId = await world()
    await stock(householdId, { mince: 1000 })

    await cookStew(householdId, { usedUpIngredientIds: [], someLeftIngredientIds: ['mince'] })

    expect(await pantry(householdId)).toEqual({ mince: 500 })
  })

  it('sets an overshot row to 0 when the cook names neither', async () => {
    const householdId = await world()
    await stock(householdId, { carrot: 300, mince: 1000 })

    await cookStew(householdId, {})

    expect(await pantry(householdId)).toEqual({ carrot: 0, mince: 500 })
  })

  it('keeps a known row on subtraction when the cook names only "have some" rows', async () => {
    const householdId = await world()
    await stock(householdId, { mince: 1000 })

    await cookStew(householdId, { usedUpIngredientIds: [] })

    expect(await pantry(householdId)).toEqual({ mince: 500 })
  })

  it('lets used up win for an id in both lists', async () => {
    const householdId = await world()
    await stock(householdId, { carrot: 300 })

    await cookStew(householdId, {
      usedUpIngredientIds: ['carrot'],
      someLeftIngredientIds: ['carrot'],
    })

    expect(await pantry(householdId)).toEqual({ carrot: 0 })
  })
})

// Ran out replaces running low (HON-1586): every write of 0 clears `lowAt`.
describe('updateEntry: a cooked meal and running-low rows', () => {
  async function stockLow(householdId: string, ingredientId: string, quantity: number | null) {
    await prisma.pantryItem.create({
      data: { householdId, ingredientId, quantity, lowAt: new Date('2026-10-31T18:00:00Z') },
    })
  }

  /** The row as quantity and whether it is still low. */
  async function row(householdId: string, ingredientId: string) {
    const item = await prisma.pantryItem.findUniqueOrThrow({
      where: { householdId_ingredientId: { householdId, ingredientId } },
    })
    return { quantity: item.quantity, low: item.lowAt !== null }
  }

  it('clears low on a "have some" row the cook names used up', async () => {
    const householdId = await world()
    await stockLow(householdId, 'beetroot', null)

    await update(householdId, { ...complete, usedUpIngredientIds: ['beetroot'] })

    expect(await row(householdId, 'beetroot')).toEqual({ quantity: 0, low: false })
  })

  it('clears low on a known row the meal empties', async () => {
    const householdId = await world()
    await stockLow(householdId, 'carrot', 300)

    await updateEntry(householdId, 'plan-alder', 'entry-stew', complete)

    expect(await row(householdId, 'carrot')).toEqual({ quantity: 0, low: false })
  })

  it('keeps low on an emptied row the cook says has some left', async () => {
    const householdId = await world()
    await stockLow(householdId, 'carrot', 300)

    await updateEntry(householdId, 'plan-alder', 'entry-stew', {
      ...complete,
      usedUpIngredientIds: [],
      someLeftIngredientIds: ['carrot'],
    })

    expect(await row(householdId, 'carrot')).toEqual({ quantity: null, low: true })
  })
})
