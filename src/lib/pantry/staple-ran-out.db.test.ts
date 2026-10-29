import { describe, expect, it } from 'vitest'

import { listPantryStaples, markStapleRanOutByName } from '@/lib/pantry/staple-ran-out'
import { prisma } from '@/lib/prisma'
import { purchaseIngredients } from '@/lib/shopping/purchase'

// Runs against PGlite through the `unit-db` project, with no mocks.

const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }

/**
 * Alder (English) and Birch (Estonian), a global milk ("Piim" in Estonian)
 * and a global butter. Each household has milk as a staple at "have some";
 * Alder also has butter, not a staple.
 */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder', locale: 'en' } })
  const birch = await prisma.household.create({ data: { name: 'Birch', locale: 'et' } })
  await prisma.ingredient.create({
    data: {
      id: 'ing-milk',
      name: 'Milk',
      category: 'dairy',
      defaultUnit: 'g',
      ...nutrition,
      translations: { create: { locale: 'et', name: 'Piim' } },
    },
  })
  await prisma.ingredient.create({
    data: { id: 'ing-butter', name: 'Butter', category: 'dairy', defaultUnit: 'g', ...nutrition },
  })
  const alderMilk = await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-milk', isStaple: true },
  })
  const birchMilk = await prisma.pantryItem.create({
    data: { householdId: birch.id, ingredientId: 'ing-milk', isStaple: true },
  })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-butter', quantity: 250 },
  })
  return {
    alder: { id: alder.id, locale: 'en' },
    birch: { id: birch.id, locale: 'et' },
    alderMilk: alderMilk.id,
    birchMilk: birchMilk.id,
  }
}

const quantityOf = (id: string) =>
  prisma.pantryItem.findUniqueOrThrow({ where: { id } }).then((row) => row.quantity)

describe('markStapleRanOutByName', () => {
  it('marks the staple ran out on its exact name, in any case and with space around it', async () => {
    const { alder, alderMilk, birchMilk } = await world()

    const outcome = await markStapleRanOutByName(alder, '  mILK ')

    expect(outcome).toEqual({
      status: 'staple_ran_out',
      pantryItemId: alderMilk,
      ingredientName: 'Milk',
    })
    expect(await quantityOf(alderMilk)).toBe(0)
    // Another household's staple is not touched.
    expect(await quantityOf(birchMilk)).toBeNull()
  })

  it('matches the Estonian name for an Estonian household, and reports it', async () => {
    const { birch, birchMilk } = await world()

    const outcome = await markStapleRanOutByName(birch, 'piim')

    expect(outcome).toEqual({
      status: 'staple_ran_out',
      pantryItemId: birchMilk,
      ingredientName: 'Piim',
    })
    expect(await quantityOf(birchMilk)).toBe(0)
  })

  it('matches the English name for an Estonian household too', async () => {
    const { birch, birchMilk } = await world()

    expect(await markStapleRanOutByName(birch, 'Milk')).toMatchObject({
      status: 'staple_ran_out',
      ingredientName: 'Piim',
    })
    expect(await quantityOf(birchMilk)).toBe(0)
  })

  it('does not write a staple that is ran out already', async () => {
    const { alder, alderMilk } = await world()
    const before = await prisma.pantryItem.update({
      where: { id: alderMilk },
      data: { quantity: 0 },
    })

    const outcome = await markStapleRanOutByName(alder, 'milk')

    expect(outcome).toEqual({
      status: 'staple_ran_out',
      pantryItemId: alderMilk,
      ingredientName: 'Milk',
    })
    const after = await prisma.pantryItem.findUniqueOrThrow({ where: { id: alderMilk } })
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it('does not match a pantry item that is not a staple', async () => {
    const { alder } = await world()

    expect(await markStapleRanOutByName(alder, 'Butter')).toEqual({ status: 'no_match' })
    const butter = await prisma.pantryItem.findFirstOrThrow({
      where: { householdId: alder.id, ingredientId: 'ing-butter' },
    })
    expect(butter.quantity).toBe(250)
  })

  it('does not match a name that only contains a staple name', async () => {
    const { alder, alderMilk } = await world()

    expect(await markStapleRanOutByName(alder, 'milk chocolate')).toEqual({ status: 'no_match' })
    expect(await quantityOf(alderMilk)).toBeNull()
  })

  it('leaves the staple alone when an open custom item links its ingredient', async () => {
    const { alder, alderMilk } = await world()
    await prisma.customShoppingItem.create({
      data: { householdId: alder.id, name: 'Whole milk', ingredientId: 'ing-milk' },
    })

    expect(await markStapleRanOutByName(alder, 'milk')).toEqual({ status: 'no_match' })
    expect(await quantityOf(alderMilk)).toBeNull()
  })

  it('leaves the staple alone when an open custom item has its name', async () => {
    const { birch, birchMilk } = await world()
    await prisma.customShoppingItem.create({ data: { householdId: birch.id, name: 'Milk' } })

    expect(await markStapleRanOutByName(birch, 'piim')).toEqual({ status: 'no_match' })
    expect(await quantityOf(birchMilk)).toBeNull()
  })

  it('marks the staple ran out when its custom item is checked off', async () => {
    const { alder, alderMilk } = await world()
    await prisma.customShoppingItem.create({
      data: { householdId: alder.id, name: 'Milk', ingredientId: 'ing-milk', checked: true },
    })

    expect(await markStapleRanOutByName(alder, 'milk')).toMatchObject({
      status: 'staple_ran_out',
    })
    expect(await quantityOf(alderMilk)).toBe(0)
  })

  it('leaves the staple at "have some" once the ran-out line is marked purchased', async () => {
    const { alder, alderMilk } = await world()
    await markStapleRanOutByName(alder, 'milk')

    await purchaseIngredients(alder, ['ing-milk'])

    expect(await quantityOf(alderMilk)).toBeNull()
  })
})

describe('listPantryStaples', () => {
  it('lists only staples, with the household-language and English names', async () => {
    const { birch, birchMilk } = await world()

    expect(await listPantryStaples(birch)).toEqual([
      { id: birchMilk, name: 'Piim', englishName: 'Milk', quantity: null },
    ])
  })

  it('leaves out a staple an open custom item stands for', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({
      data: { householdId: alder.id, name: 'Milk for the cake', ingredientId: 'ing-milk' },
    })

    expect(await listPantryStaples(alder)).toEqual([])
  })

  it('leaves out ordinary pantry items', async () => {
    const { alder, alderMilk } = await world()

    expect(await listPantryStaples(alder)).toEqual([
      { id: alderMilk, name: 'Milk', englishName: 'Milk', quantity: null },
    ])
  })
})
