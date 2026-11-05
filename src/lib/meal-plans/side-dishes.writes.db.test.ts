import { describe, expect, it } from 'vitest'

import { previewCookDeduction } from '@/lib/meal-plans/cook-preview'
import { createEntry } from '@/lib/meal-plans/create-entry'
import { createSide, SideCreateError } from '@/lib/meal-plans/create-side'
import { EntryUpdateError, updateEntry } from '@/lib/meal-plans/entries'
import { entry, readEntry, world } from '@/lib/meal-plans/entries.fixtures'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// HON-1610: the write paths of a slot with sides. Alder cooks 2.5 servings.
// Stew is 100 g beef and 20 g apple per serving, salad 50 g apple and 30 g
// rice, slaw 10 g apple.

const DINNER: { date: Date; mealType: 'breakfast' | 'lunch' | 'dinner' } = {
  date: new Date('2026-10-14T00:00:00Z'),
  mealType: 'dinner',
}

async function slotWithTwoSides() {
  const { alder } = await world()
  await prisma.meal.create({
    data: {
      id: 'meal-slaw',
      name: 'meal-slaw',
      components: { create: [{ ingredientId: 'ing-apple', quantityPerServing: 10 }] },
    },
  })
  await entry('entry-side-salad', { mealId: 'meal-salad', mainEntryId: 'entry-alder' })
  await entry('entry-side-slaw', { mealId: 'meal-slaw', mainEntryId: 'entry-alder' })
  for (const ingredientId of ['ing-apple', 'ing-beef', 'ing-rice']) {
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId, quantity: 1000 },
    })
  }
  return alder
}

const pantry = async (householdId: string) =>
  Object.fromEntries(
    (
      await prisma.pantryItem.findMany({
        where: { householdId },
        select: { ingredientId: true, quantity: true },
      })
    ).map((row) => [row.ingredientId, row.quantity]),
  )

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof EntryUpdateError || error instanceof SideCreateError ? error.reason : error,
  )

describe('Cooked on a main with sides', () => {
  it('completes the main and both sides in one call, and charges each ingredient once, summed', async () => {
    const alder = await slotWithTwoSides()

    const result = await updateEntry(alder.id, 'plan-alder', 'entry-alder', {
      status: 'completed',
      deductPantry: true,
    })

    expect(result).toMatchObject({ status: 'completed', pantryDeducted: true })
    for (const id of ['entry-alder', 'entry-side-salad', 'entry-side-slaw']) {
      const row = await readEntry(id)
      expect(row.status).toBe('completed')
      expect(row.cookedServings).toBe(2.5)
      expect(row.pantryDeductedAt).not.toBeNull()
    }
    // Apple: (20 + 50 + 10) × 2.5 = 200. Beef 250, rice 75.
    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 800, 'ing-beef': 750, 'ing-rice': 925 })
  })

  it('previews the summed rows the completion charges', async () => {
    const alder = await slotWithTwoSides()

    const rows = await previewCookDeduction(alder.id, 'plan-alder', 'entry-alder', 'en')

    expect(rows.map((row) => [row.ingredientId, row.used])).toEqual([
      ['ing-beef', 250],
      ['ing-apple', 200],
      ['ing-rice', 75],
    ])
  })

  it('refuses to complete a side while its main is planned, and changes nothing', async () => {
    const alder = await slotWithTwoSides()

    expect(
      await refusal(
        updateEntry(alder.id, 'plan-alder', 'entry-side-salad', {
          status: 'completed',
          deductPantry: true,
        }),
      ),
    ).toBe('mainNotCompleted')
    expect((await readEntry('entry-side-salad')).status).toBe('planned')
    expect(await pantry(alder.id)).toEqual({
      'ing-apple': 1000,
      'ing-beef': 1000,
      'ing-rice': 1000,
    })
  })

  it('reverts the sides with the main, and does not restock', async () => {
    const alder = await slotWithTwoSides()
    await updateEntry(alder.id, 'plan-alder', 'entry-alder', {
      status: 'completed',
      deductPantry: true,
    })

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', { status: 'planned' })

    for (const id of ['entry-alder', 'entry-side-salad', 'entry-side-slaw']) {
      expect(await readEntry(id)).toMatchObject({ status: 'planned', cookedServings: null })
    }
    expect((await pantry(alder.id))['ing-apple']).toBe(800)
  })

  it('skips the sides with the main', async () => {
    const alder = await slotWithTwoSides()

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', { status: 'skipped' })

    for (const id of ['entry-alder', 'entry-side-salad', 'entry-side-slaw']) {
      expect((await readEntry(id)).status).toBe('skipped')
    }
  })

  it('lets one side be skipped while its main stays cooked', async () => {
    const alder = await slotWithTwoSides()
    await updateEntry(alder.id, 'plan-alder', 'entry-alder', { status: 'completed' })

    await updateEntry(alder.id, 'plan-alder', 'entry-side-slaw', { status: 'skipped' })

    expect((await readEntry('entry-alder')).status).toBe('completed')
    expect((await readEntry('entry-side-salad')).status).toBe('completed')
    expect((await readEntry('entry-side-slaw')).status).toBe('skipped')
  })

  it('leaves a skipped side skipped and uncharged when the main is cooked', async () => {
    const alder = await slotWithTwoSides()
    await updateEntry(alder.id, 'plan-alder', 'entry-side-salad', { status: 'skipped' })

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', {
      status: 'completed',
      deductPantry: true,
    })

    expect(await readEntry('entry-side-salad')).toMatchObject({
      status: 'skipped',
      pantryDeductedAt: null,
    })
    // Apple: (20 + 10) × 2.5 = 75, without the salad's 50 × 2.5.
    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 925, 'ing-beef': 750, 'ing-rice': 1000 })
  })

  it('refuses a side completed with a serving count while its main is planned', async () => {
    const alder = await slotWithTwoSides()

    expect(
      await refusal(
        updateEntry(alder.id, 'plan-alder', 'entry-side-salad', {
          status: 'completed',
          deductPantry: true,
          servingOverride: 3,
        }),
      ),
    ).toBe('mainNotCompleted')
    expect(await readEntry('entry-side-salad')).toMatchObject({
      status: 'planned',
      servingOverride: null,
    })
  })

  it('completes the slot when the main is completed with a serving count', async () => {
    const alder = await slotWithTwoSides()

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', {
      status: 'completed',
      deductPantry: true,
      servingOverride: 4,
      rating: 'up',
    })

    expect(await readEntry('entry-alder')).toMatchObject({
      status: 'completed',
      servingOverride: 4,
      cookedServings: 4,
      rating: 'up',
    })
    // A side with no override follows the main's own servings.
    expect(await readEntry('entry-side-salad')).toMatchObject({
      status: 'completed',
      cookedServings: 4,
    })
  })

  it('charges a fridge main’s sides only when the completion asks to deduct', async () => {
    const alder = await slotWithTwoSides()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { kind: 'fridge', mealId: null },
    })

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', { status: 'completed' })

    expect(await readEntry('entry-side-salad')).toMatchObject({
      status: 'completed',
      pantryDeductedAt: null,
    })
    expect(await pantry(alder.id)).toEqual({
      'ing-apple': 1000,
      'ing-beef': 1000,
      'ing-rice': 1000,
    })

    await updateEntry(alder.id, 'plan-alder', 'entry-alder', { status: 'planned' })
    await updateEntry(alder.id, 'plan-alder', 'entry-alder', {
      status: 'completed',
      deductPantry: true,
    })

    // The sides only: apple (50 + 10) × 2.5 = 150, rice 75.
    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 850, 'ing-beef': 1000, 'ing-rice': 925 })
  })

  it('refuses a swap of a side to the meal of its main', async () => {
    const alder = await slotWithTwoSides()

    expect(
      await refusal(
        updateEntry(alder.id, 'plan-alder', 'entry-side-salad', { mealId: 'meal-stew' }),
      ),
    ).toBe('alreadyInSlot')
    expect((await readEntry('entry-side-salad')).mealId).toBe('meal-salad')
  })
})

describe('createSide', () => {
  it('adds a planned side that follows the main’s own servings', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { servingOverride: 4 },
    })

    const side = await createSide(alder.id, 'plan-alder', { ...DINNER, mealId: 'meal-salad' })

    expect(side).toMatchObject({ mainEntryId: 'entry-alder', status: 'planned', servings: 4 })
    expect(await readEntry(side.id)).toMatchObject({ servingOverride: null, cookedServings: null })
  })

  it('adds a side to a fridge meal', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { kind: 'fridge', mealId: null },
    })

    const side = await createSide(alder.id, 'plan-alder', { ...DINNER, mealId: 'meal-salad' })

    expect(side.status).toBe('planned')
  })

  it('saves a side of a cooked main as cooked, and leaves the pantry alone', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-apple', quantity: 1000 },
    })
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { status: 'completed', cookedServings: 2.5 },
    })

    const side = await createSide(alder.id, 'plan-alder', {
      ...DINNER,
      mealId: 'meal-salad',
      servingOverride: 3,
    })

    const row = await readEntry(side.id)
    expect(row).toMatchObject({ status: 'completed', cookedServings: 3, servingOverride: 3 })
    expect(row.pantryDeductedAt).not.toBeNull()
    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 1000 })
  })

  it('refuses an empty slot, a note-only slot, a skipped main and a meal already in the slot', async () => {
    const { alder } = await world()
    const add = (data: Partial<typeof DINNER> & { mealId: string }) =>
      refusal(createSide(alder.id, 'plan-alder', { ...DINNER, ...data }))

    expect(await add({ mealType: 'lunch', mealId: 'meal-salad' })).toBe('noMain')

    await entry('entry-note', { mealType: 'breakfast', mealId: null, note: 'Toast' })
    expect(await add({ mealType: 'breakfast', mealId: 'meal-salad' })).toBe('noMain')

    expect(await add({ mealId: 'meal-stew' })).toBe('alreadyInSlot')
    await createSide(alder.id, 'plan-alder', { ...DINNER, mealId: 'meal-salad' })
    expect(await add({ mealId: 'meal-salad' })).toBe('alreadyInSlot')

    await prisma.mealPlanEntry.update({ where: { id: 'entry-alder' }, data: { status: 'skipped' } })
    expect(await add({ mealId: 'meal-empty' })).toBe('mainSkipped')

    expect(await prisma.mealPlanEntry.count({ where: { mainEntryId: 'entry-alder' } })).toBe(1)
  })
})

describe('Undo after Clear', () => {
  it('restores the main and its side, with the side’s servings, in one call', async () => {
    const { alder } = await world()
    await entry('entry-side-salad', {
      mealId: 'meal-salad',
      mainEntryId: 'entry-alder',
      servingOverride: 3,
    })
    await prisma.mealPlanEntry.delete({ where: { id: 'entry-alder' } })
    expect(await prisma.mealPlanEntry.count({ where: { planId: 'plan-alder' } })).toBe(0)

    const restored = await createEntry(alder.id, 'plan-alder', {
      ...DINNER,
      mealId: 'meal-stew',
      sides: [{ mealId: 'meal-salad', servingOverride: 3 }],
    })

    const sides = await prisma.mealPlanEntry.findMany({
      where: { mainEntryId: restored.id },
      select: { mealId: true, servingOverride: true, status: true },
    })
    expect(sides).toEqual([{ mealId: 'meal-salad', servingOverride: 3, status: 'planned' }])
  })
})
