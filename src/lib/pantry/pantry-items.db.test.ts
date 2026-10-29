import { describe, expect, it } from 'vitest'

import {
  createPantryItem,
  deletePantryItem,
  deletePantryItemByIngredient,
  updatePantryItem,
} from '@/lib/pantry/pantry-items'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }

/**
 * Alder (English) and Birch (Estonian); a global olive oil with an Estonian
 * name, a global salt, and a custom ingredient of each household's. Each
 * household has olive oil in its pantry.
 */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder', locale: 'en' } })
  const birch = await prisma.household.create({ data: { name: 'Birch', locale: 'et' } })
  await prisma.ingredient.create({
    data: {
      id: 'ing-oil',
      name: 'Olive oil',
      category: 'fat',
      defaultUnit: 'g',
      measuredByVolume: true,
      ...nutrition,
      translations: { create: { locale: 'et', name: 'Oliiviõli' } },
    },
  })
  await prisma.ingredient.create({
    data: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g', ...nutrition },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-alder',
      name: 'Alder jam',
      category: 'condiment',
      defaultUnit: 'g',
      householdId: alder.id,
      ...nutrition,
    },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-birch',
      name: 'Birch syrup',
      category: 'condiment',
      defaultUnit: 'g',
      householdId: birch.id,
      ...nutrition,
    },
  })
  const alderOil = await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-oil', quantity: 500 },
  })
  const birchOil = await prisma.pantryItem.create({
    data: { householdId: birch.id, ingredientId: 'ing-oil', quantity: 200, isStaple: true },
  })
  return {
    alder: { id: alder.id, locale: 'en' },
    birch: { id: birch.id, locale: 'et' },
    alderOil: alderOil.id,
    birchOil: birchOil.id,
  }
}

const pantryOf = (householdId: string) =>
  prisma.pantryItem
    .findMany({ where: { householdId }, orderBy: { ingredientId: 'asc' } })
    .then((rows) =>
      rows.map(({ ingredientId, quantity, isStaple }) => ({ ingredientId, quantity, isStaple })),
    )

describe('createPantryItem', () => {
  it('puts a global ingredient in the pantry and returns it', async () => {
    const { alder } = await world()

    const outcome = await createPantryItem(alder, {
      ingredientId: 'ing-salt',
      quantity: 100,
      isStaple: true,
    })

    expect(outcome).toMatchObject({
      status: 'created',
      item: {
        ingredientId: 'ing-salt',
        quantity: 100,
        isStaple: true,
        ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
      },
    })
    expect(await pantryOf(alder.id)).toContainEqual({
      ingredientId: 'ing-salt',
      quantity: 100,
      isStaple: true,
    })
  })

  it("puts the household's own ingredient in the pantry", async () => {
    const { alder } = await world()

    const outcome = await createPantryItem(alder, {
      ingredientId: 'ing-alder',
      quantity: null,
      isStaple: false,
    })

    expect(outcome.status).toBe('created')
  })

  // HON-889: another household's ingredient reads exactly like an unknown one.
  it.each(['ing-birch', 'ing-missing'])('refuses %s as ingredient_not_found', async (id) => {
    const { alder } = await world()

    const outcome = await createPantryItem(alder, {
      ingredientId: id,
      quantity: null,
      isStaple: false,
    })

    expect(outcome).toEqual({ status: 'ingredient_not_found' })
    expect(await pantryOf(alder.id)).toHaveLength(1)
  })

  it('refuses an ingredient the pantry has already, with the existing id', async () => {
    const { alder, alderOil } = await world()

    const outcome = await createPantryItem(alder, {
      ingredientId: 'ing-oil',
      quantity: 1,
      isStaple: false,
    })

    expect(outcome).toEqual({ status: 'exists', existingId: alderOil, isStaple: false })
    expect(await pantryOf(alder.id)).toEqual([
      { ingredientId: 'ing-oil', quantity: 500, isStaple: false },
    ])
  })

  // HON-913: the pantry list inserts this response as it is.
  it("returns the ingredient's name in the household's language", async () => {
    const { birch } = await world()
    await prisma.pantryItem.deleteMany({ where: { householdId: birch.id } })

    const outcome = await createPantryItem(birch, {
      ingredientId: 'ing-oil',
      quantity: null,
      isStaple: false,
    })

    expect(outcome).toMatchObject({
      status: 'created',
      item: { ingredient: { name: 'Oliiviõli' } },
    })
  })
})

describe('updatePantryItem', () => {
  it.each([
    ['the quantity only', { quantity: 250 }, { quantity: 250, isStaple: false }],
    ['the staple flag only', { isStaple: true }, { quantity: 500, isStaple: true }],
    ['the quantity to 0', { quantity: 0 }, { quantity: 0, isStaple: false }],
    ['the quantity to null', { quantity: null }, { quantity: null, isStaple: false }],
    ['both fields', { quantity: 0, isStaple: true }, { quantity: 0, isStaple: true }],
  ])('changes %s and leaves the rest', async (_label, update, saved) => {
    const { alder, alderOil } = await world()

    const outcome = await updatePantryItem(alder, alderOil, update)

    expect(outcome).toMatchObject({ status: 'updated', item: { id: alderOil, ...saved } })
    expect(await pantryOf(alder.id)).toEqual([{ ingredientId: 'ing-oil', ...saved }])
  })

  it("refuses another household's item and leaves it alone", async () => {
    const { alder, birch, birchOil } = await world()

    const outcome = await updatePantryItem(alder, birchOil, { quantity: 1 })

    expect(outcome).toEqual({ status: 'not_found' })
    expect(await pantryOf(birch.id)).toEqual([
      { ingredientId: 'ing-oil', quantity: 200, isStaple: true },
    ])
  })

  it('refuses an id that is no pantry item', async () => {
    const { alder } = await world()

    expect(await updatePantryItem(alder, 'missing', { quantity: 1 })).toEqual({
      status: 'not_found',
    })
  })

  it("returns the ingredient's name in the household's language", async () => {
    const { birch, birchOil } = await world()

    const outcome = await updatePantryItem(birch, birchOil, { quantity: 250 })

    expect(outcome).toMatchObject({
      status: 'updated',
      item: {
        ingredient: { id: 'ing-oil', name: 'Oliiviõli', category: 'fat', defaultUnit: 'g' },
      },
    })
  })
})

describe('deletePantryItem', () => {
  it("removes the item from the household's pantry", async () => {
    const { alder, alderOil } = await world()

    expect(await deletePantryItem(alder.id, alderOil)).toEqual({ status: 'deleted' })
    expect(await pantryOf(alder.id)).toEqual([])
  })

  it("refuses another household's item and leaves it alone", async () => {
    const { alder, birch, birchOil } = await world()

    expect(await deletePantryItem(alder.id, birchOil)).toEqual({ status: 'not_found' })
    expect(await pantryOf(birch.id)).toHaveLength(1)
  })

  it('reads an item deleted twice as not_found the second time', async () => {
    const { alder, alderOil } = await world()
    await deletePantryItem(alder.id, alderOil)

    expect(await deletePantryItem(alder.id, alderOil)).toEqual({ status: 'not_found' })
  })
})

describe('deletePantryItemByIngredient', () => {
  it("removes the ingredient from this household's pantry only", async () => {
    const { alder, birch } = await world()

    expect(await deletePantryItemByIngredient(alder.id, 'ing-oil')).toEqual({ status: 'deleted' })
    expect(await pantryOf(alder.id)).toEqual([])
    expect(await pantryOf(birch.id)).toEqual([
      { ingredientId: 'ing-oil', quantity: 200, isStaple: true },
    ])
  })

  it('refuses an ingredient the pantry does not hold', async () => {
    const { alder } = await world()

    expect(await deletePantryItemByIngredient(alder.id, 'ing-salt')).toEqual({
      status: 'not_found',
    })
    expect(await pantryOf(alder.id)).toHaveLength(1)
  })
})
