import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import { discardPlaceholder } from '@/lib/meal-plans/discard-placeholder'
import { updateEntry } from '@/lib/meal-plans/entries'
import { writeFilledSlots } from '@/lib/meal-plans/fill-entries'
import {
  FridgeItemNotFoundError,
  setFridgeItems,
  SetFridgeItemsError,
} from '@/lib/meal-plans/fridge-meal'
import { isWeekPlanned } from '@/lib/weekly-reminder'
import { readEntry, world } from './entries.fixtures'

// Fridge meals (HON-1277) against PGlite, with no mocks. `ing-apple` plays the
// cucumber, `ing-rice` the paprika.

const date = new Date('2026-10-14T00:00:00Z')
const lunch = { date, mealType: 'lunch' as const }

/** Alder's fridge lunch: cucumber, paprika and store meatballs. */
async function fridgeWorld() {
  const households = await world()
  await prisma.pantryItem.createMany({
    data: [
      { householdId: households.alder.id, ingredientId: 'ing-apple', quantity: 300 },
      { householdId: households.alder.id, ingredientId: 'ing-rice', quantity: 200 },
      { householdId: households.alder.id, ingredientId: 'ing-beef', quantity: 500 },
    ],
  })
  const created = await createEntry(households.alder.id, 'plan-alder', {
    ...lunch,
    fridgeItems: [
      { ingredientId: 'ing-apple' },
      { ingredientId: 'ing-rice' },
      { label: 'store meatballs' },
    ],
  })
  return { ...households, fridgeId: created.id }
}

const pantryQuantity = async (householdId: string, ingredientId: string) =>
  (
    await prisma.pantryItem.findUnique({
      where: { householdId_ingredientId: { householdId, ingredientId } },
    })
  )?.quantity

const items = (entryId: string) =>
  prisma.mealPlanEntryItem.findMany({
    where: { entryId },
    orderBy: { position: 'asc' },
    select: { ingredientId: true, sourceEntryId: true, label: true, position: true },
  })

describe('createEntry with fridge items', () => {
  it('creates a fridge meal with no meal and its items in order', async () => {
    const { fridgeId } = await fridgeWorld()

    const stored = await readEntry(fridgeId)
    expect(stored.kind).toBe('fridge')
    expect(stored.mealId).toBeNull()
    expect(await items(fridgeId)).toEqual([
      { ingredientId: 'ing-apple', sourceEntryId: null, label: null, position: 0 },
      { ingredientId: 'ing-rice', sourceEntryId: null, label: null, position: 1 },
      { ingredientId: null, sourceEntryId: null, label: 'store meatballs', position: 2 },
    ])
  })

  it("takes leftovers from the household's own completed meal", async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { status: 'completed' },
    })

    const created = await createEntry(alder.id, 'plan-alder', {
      ...lunch,
      fridgeItems: [{ sourceEntryId: 'entry-alder' }],
    })

    expect(await items(created.id)).toEqual([
      { ingredientId: null, sourceEntryId: 'entry-alder', label: null, position: 0 },
    ])
  })

  // Another household's entry would leak its meal name through the card.
  it("refuses another household's entry as a source, and writes nothing", async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-birch' },
      data: { status: 'completed' },
    })

    await expect(
      createEntry(alder.id, 'plan-alder', {
        ...lunch,
        fridgeItems: [{ sourceEntryId: 'entry-birch' }],
      }),
    ).rejects.toBeInstanceOf(FridgeItemNotFoundError)
    expect(await prisma.mealPlanEntry.count({ where: { planId: 'plan-alder' } })).toBe(1)
  })

  it('refuses a planned entry as a source, because it was not eaten', async () => {
    const { alder } = await world()

    await expect(
      createEntry(alder.id, 'plan-alder', {
        ...lunch,
        fridgeItems: [{ sourceEntryId: 'entry-alder' }],
      }),
    ).rejects.toBeInstanceOf(FridgeItemNotFoundError)
  })

  it("refuses another household's custom ingredient", async () => {
    const { alder, birch } = await world()
    await prisma.ingredient.create({
      data: {
        id: 'ing-birch',
        name: 'Birch sap',
        householdId: birch.id,
        category: 'spice',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })

    await expect(
      createEntry(alder.id, 'plan-alder', {
        ...lunch,
        fridgeItems: [{ ingredientId: 'ing-birch' }],
      }),
    ).rejects.toBeInstanceOf(FridgeItemNotFoundError)
  })
})

describe('a fridge meal is not a placeholder', () => {
  it('is not swept by a create in its slot', async () => {
    const { alder, fridgeId } = await fridgeWorld()

    await expect(
      createEntry(alder.id, 'plan-alder', { ...lunch, mealId: 'meal-salad' }),
    ).rejects.toEqual(new EntryCreateError('slotTaken'))
    expect((await readEntry(fridgeId)).kind).toBe('fridge')
  })

  it('is not deleted by a placeholder discard', async () => {
    const { alder, fridgeId } = await fridgeWorld()

    expect(await discardPlaceholder(alder.id, 'plan-alder', fridgeId)).toBe(false)
    expect(await items(fridgeId)).toHaveLength(3)
  })

  it('is neither deleted nor given a meal by Fill days', async () => {
    const { fridgeId } = await fridgeWorld()

    await writeFilledSlots(
      'plan-alder',
      [],
      [{ id: fridgeId, date, mealType: 'lunch', note: null }],
    )

    const stored = await readEntry(fridgeId)
    expect(stored.kind).toBe('fridge')
    expect(stored.mealId).toBeNull()
  })

  it('counts as a planned week for the weekly reminder', async () => {
    const { alder } = await fridgeWorld()
    await prisma.mealPlanEntry.delete({ where: { id: 'entry-alder' } })

    expect(
      await isWeekPlanned(
        alder.id,
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toBe(true)
  })
})

describe('setFridgeItems', () => {
  it('replaces a planned recipe and drops what described it, keeping the note', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: {
        note: 'Grandma visits',
        rating: 'up',
        servingOverride: 4,
        preparationTips: '{}',
        adjustmentNote: 'less salt',
        changes: { create: { originalIngredientId: 'ing-salt' } },
      },
    })

    await setFridgeItems(alder.id, 'plan-alder', 'entry-alder', [
      { label: 'soup from the freezer' },
    ])

    const stored = await readEntry()
    expect(stored).toMatchObject({
      kind: 'fridge',
      mealId: null,
      note: 'Grandma visits',
      rating: null,
      servingOverride: null,
      preparationTips: null,
      adjustmentNote: null,
    })
    expect(await prisma.mealPlanEntryComponent.count({ where: { entryId: 'entry-alder' } })).toBe(0)
    expect(await items('entry-alder')).toEqual([
      { ingredientId: null, sourceEntryId: null, label: 'soup from the freezer', position: 0 },
    ])
  })

  it("edits a fridge meal's items", async () => {
    const { alder, fridgeId } = await fridgeWorld()

    await setFridgeItems(alder.id, 'plan-alder', fridgeId, [
      { label: 'store meatballs' },
      { ingredientId: 'ing-apple' },
    ])

    expect(await items(fridgeId)).toEqual([
      { ingredientId: null, sourceEntryId: null, label: 'store meatballs', position: 0 },
      { ingredientId: 'ing-apple', sourceEntryId: null, label: null, position: 1 },
    ])
  })

  it('refuses a completed entry and keeps its items', async () => {
    const { alder, fridgeId } = await fridgeWorld()
    await updateEntry(alder.id, 'plan-alder', fridgeId, { status: 'completed' })

    await expect(
      setFridgeItems(alder.id, 'plan-alder', fridgeId, [{ label: 'x' }]),
    ).rejects.toEqual(new SetFridgeItemsError('completed'))
    expect(await items(fridgeId)).toHaveLength(3)
  })

  it("reads another household's entry as missing", async () => {
    const { birch, fridgeId } = await fridgeWorld()

    await expect(
      setFridgeItems(birch.id, 'plan-alder', fridgeId, [{ label: 'x' }]),
    ).rejects.toEqual(new SetFridgeItemsError('entryNotFound'))
  })
})

describe('completing a fridge meal', () => {
  it('sets a used-up item to 0 and keeps the unticked ones', async () => {
    const { alder, fridgeId } = await fridgeWorld()

    const result = await updateEntry(alder.id, 'plan-alder', fridgeId, {
      status: 'completed',
      usedUpIngredientIds: ['ing-apple'],
    })

    expect(result.pantryDeducted).toBe(true)
    expect((await readEntry(fridgeId)).status).toBe('completed')
    expect(await pantryQuantity(alder.id, 'ing-apple')).toBe(0)
    expect(await pantryQuantity(alder.id, 'ing-rice')).toBe(200)
  })

  it('complete → revert → complete changes the pantry once only', async () => {
    const { alder, fridgeId } = await fridgeWorld()
    const complete = { status: 'completed' as const, usedUpIngredientIds: ['ing-apple'] }

    await updateEntry(alder.id, 'plan-alder', fridgeId, complete)
    // The household restocks between the two completions.
    await prisma.pantryItem.update({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-apple' } },
      data: { quantity: 300 },
    })
    await updateEntry(alder.id, 'plan-alder', fridgeId, { status: 'planned' })
    const again = await updateEntry(alder.id, 'plan-alder', fridgeId, complete)

    expect(again.pantryDeducted).toBe(false)
    expect((await readEntry(fridgeId)).status).toBe('completed')
    expect(await pantryQuantity(alder.id, 'ing-apple')).toBe(300)
  })

  it('completing with nothing ticked keeps the one charge for later', async () => {
    const { alder, fridgeId } = await fridgeWorld()

    await updateEntry(alder.id, 'plan-alder', fridgeId, { status: 'completed' })
    await updateEntry(alder.id, 'plan-alder', fridgeId, { status: 'planned' })
    await updateEntry(alder.id, 'plan-alder', fridgeId, {
      status: 'completed',
      usedUpIngredientIds: ['ing-rice'],
    })

    expect(await pantryQuantity(alder.id, 'ing-rice')).toBe(0)
    expect(await pantryQuantity(alder.id, 'ing-apple')).toBe(300)
  })

  // A request cannot zero the rest of the pantry.
  it("ignores an ingredient that is not one of the meal's items", async () => {
    const { alder, fridgeId } = await fridgeWorld()

    const result = await updateEntry(alder.id, 'plan-alder', fridgeId, {
      status: 'completed',
      usedUpIngredientIds: ['ing-beef'],
    })

    expect(result.pantryDeducted).toBe(false)
    expect((await readEntry(fridgeId)).pantryDeductedAt).toBeNull()
    expect(await pantryQuantity(alder.id, 'ing-beef')).toBe(500)
  })

  it('records "ran out" for an item the pantry does not hold', async () => {
    const { alder, fridgeId } = await fridgeWorld()
    await prisma.pantryItem.deleteMany({
      where: { householdId: alder.id, ingredientId: 'ing-rice' },
    })

    await updateEntry(alder.id, 'plan-alder', fridgeId, {
      status: 'completed',
      usedUpIngredientIds: ['ing-rice'],
    })

    expect(await pantryQuantity(alder.id, 'ing-rice')).toBe(0)
  })

  it('keeps a staple a staple when it runs out', async () => {
    const { alder, fridgeId } = await fridgeWorld()
    await prisma.pantryItem.update({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-apple' } },
      data: { isStaple: true },
    })

    await updateEntry(alder.id, 'plan-alder', fridgeId, {
      status: 'completed',
      usedUpIngredientIds: ['ing-apple'],
    })

    const item = await prisma.pantryItem.findUniqueOrThrow({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-apple' } },
    })
    expect(item).toMatchObject({ quantity: 0, isStaple: true })
  })
})

describe('swapping a fridge meal for a recipe', () => {
  it('makes it a recipe meal and drops its items', async () => {
    const { alder, fridgeId } = await fridgeWorld()

    await updateEntry(alder.id, 'plan-alder', fridgeId, { mealId: 'meal-salad' })

    const stored = await readEntry(fridgeId)
    expect(stored).toMatchObject({ kind: 'meal', mealId: 'meal-salad' })
    expect(await items(fridgeId)).toEqual([])
  })
})

describe('deleting a source entry', () => {
  it("drops the leftover item and keeps the fridge meal's other items", async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-alder' },
      data: { status: 'completed' },
    })
    const created = await createEntry(alder.id, 'plan-alder', {
      ...lunch,
      fridgeItems: [{ sourceEntryId: 'entry-alder' }, { label: 'bread' }],
    })

    await prisma.mealPlanEntry.delete({ where: { id: 'entry-alder' } })

    expect(await items(created.id)).toEqual([
      { ingredientId: null, sourceEntryId: null, label: 'bread', position: 1 },
    ])
  })
})
