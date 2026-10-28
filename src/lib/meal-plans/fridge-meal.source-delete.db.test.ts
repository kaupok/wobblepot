import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createEntry } from '@/lib/meal-plans/create-entry'
import { deleteEntry } from '@/lib/meal-plans/entries'
import { setFridgeItems } from '@/lib/meal-plans/fridge-meal'
import { fridgeItemsSchema } from '@/lib/meal-plans/fridge-items'
import { entry, world } from './entries.fixtures'

// Deleting a leftover lunch's source after the dinner became a fridge meal
// (HON-1440), against PGlite with the delete trigger from the migrations. The
// recipe-source cases are in `fridge-meal.db.test.ts` → "deleting a source entry".

const tomorrowLunch = { date: new Date('2026-10-15T00:00:00Z'), mealType: 'lunch' as const }

const items = (entryId: string) =>
  prisma.mealPlanEntryItem.findMany({
    where: { entryId },
    orderBy: { position: 'asc' },
    select: { ingredientId: true, sourceEntryId: true, label: true, servings: true },
  })

/** Tonight's stew cooked for tomorrow's lunch too, then swapped to the fridge. */
async function swappedDinner(dinnerItems: Parameters<typeof setFridgeItems>[3]) {
  const { alder } = await world()
  const lunch = await createEntry(alder.id, 'plan-alder', {
    ...tomorrowLunch,
    fridgeItems: [{ sourceEntryId: 'entry-alder', servings: 2.5 }],
  })
  await setFridgeItems(alder.id, 'plan-alder', 'entry-alder', dinnerItems)
  return { alder, lunchId: lunch.id }
}

describe('deleting a fridge-meal source entry', () => {
  it("keeps the lunch's leftover as free text with the dinner's item names", async () => {
    const { alder, lunchId } = await swappedDinner([
      { ingredientId: 'ing-apple' },
      { label: 'store meatballs' },
    ])

    expect(await deleteEntry(alder.id, 'plan-alder', 'entry-alder')).toBe(true)

    expect(await items(lunchId)).toEqual([
      {
        ingredientId: null,
        sourceEntryId: null,
        label: 'Ing-apple, store meatballs',
        servings: null,
      },
    ])
  })

  it('names the ingredients in the household language', async () => {
    const { alder, lunchId } = await swappedDinner([
      { ingredientId: 'ing-rice' },
      { ingredientId: 'ing-apple' },
    ])
    await prisma.household.update({ where: { id: alder.id }, data: { locale: 'et' } })
    await prisma.ingredientTranslation.create({
      data: { ingredientId: 'ing-rice', locale: 'et', name: 'riis' },
    })

    await deleteEntry(alder.id, 'plan-alder', 'entry-alder')

    expect((await items(lunchId)).map((item) => item.label)).toEqual(['Riis, ing-apple'])
  })

  // The card names a meal of leftovers by the leftovers' meals; the rest sit under it.
  it("names a dinner of leftovers by the leftovers' meal", async () => {
    const { alder } = await world()
    await prisma.household.update({ where: { id: alder.id }, data: { locale: 'et' } })
    await prisma.mealTranslation.create({
      data: { mealId: 'meal-salad', locale: 'et', name: 'salat' },
    })
    await entry('entry-monday', {
      date: new Date('2026-10-13T00:00:00Z'),
      mealId: 'meal-salad',
      status: 'completed',
    })
    const lunch = await createEntry(alder.id, 'plan-alder', {
      ...tomorrowLunch,
      fridgeItems: [{ sourceEntryId: 'entry-alder', servings: 2.5 }],
    })
    await setFridgeItems(alder.id, 'plan-alder', 'entry-alder', [
      { ingredientId: 'ing-apple' },
      { sourceEntryId: 'entry-monday' },
    ])

    await deleteEntry(alder.id, 'plan-alder', 'entry-alder')

    expect((await items(lunch.id)).map((item) => item.label)).toEqual(['Salat'])
  })

  it('lets Undo after Clear put the lunch back', async () => {
    const { alder, lunchId } = await swappedDinner([{ label: 'pasta' }])
    await deleteEntry(alder.id, 'plan-alder', 'entry-alder')

    // What the card sends back: each stored item as its route body.
    const fridgeItems = fridgeItemsSchema.parse(
      (await items(lunchId)).map((item) => ({ label: item.label })),
    )
    await deleteEntry(alder.id, 'plan-alder', lunchId)
    const restored = await createEntry(alder.id, 'plan-alder', { ...tomorrowLunch, fridgeItems })

    expect(await items(restored.id)).toEqual([
      { ingredientId: null, sourceEntryId: null, label: 'Pasta', servings: null },
    ])
  })
})
