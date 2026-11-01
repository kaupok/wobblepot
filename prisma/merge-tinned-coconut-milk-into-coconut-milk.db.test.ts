import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1552).
const MIGRATION =
  'prisma/migrations/20261101140000_merge_tinned_coconut_milk_into_coconut_milk/migration.sql'

// One DO block, so it runs as one statement: its body holds semicolons.
async function runMigration() {
  await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, ''))
}

function ingredient(id: string, name: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      id,
      name,
      householdId,
      category: 'condiment',
      defaultUnit: 'g',
      allergens: [],
      calories: 30,
      protein: 1,
      carbs: 6,
      fat: 0.2,
    },
  })
}

/**
 * Alder holds `tinned coconut milk` in a meal, its pantry and its exclusions, and has
 * its own `tinned coconut milk` row, which is its data and stays.
 */
async function world() {
  await ingredient('g-tinned', 'tinned coconut milk')
  await ingredient('g-coconut', 'coconut milk')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'g-tinned', locale: 'et', name: 'kookospiim purgis' },
  })
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await ingredient('alder-tinned', 'tinned coconut milk', alder.id)

  await prisma.meal.create({
    data: {
      id: 'curry',
      name: 'Curry',
      components: { create: { ingredientId: 'g-tinned', quantityPerServing: 100 } },
    },
  })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'g-tinned', quantity: 400 },
  })
  await prisma.householdPreferences.create({
    data: { householdId: alder.id, excludedIngredientIds: ['g-tinned'] },
  })
}

async function mergedState() {
  return {
    ingredients: await prisma.ingredient.findMany({
      where: { name: { in: ['tinned coconut milk', 'coconut milk'] } },
      select: { id: true, householdId: true },
      orderBy: { id: 'asc' },
    }),
    translations: await prisma.ingredientTranslation.count({ where: { ingredientId: 'g-tinned' } }),
    components: await prisma.mealComponent.findMany({
      select: { mealId: true, ingredientId: true, quantityPerServing: true },
    }),
    pantry: await prisma.pantryItem.findMany({
      select: { householdId: true, ingredientId: true, quantity: true },
    }),
    excluded: (
      await prisma.householdPreferences.findUniqueOrThrow({ where: { householdId: 'alder' } })
    ).excludedIngredientIds,
  }
}

const MERGED = {
  ingredients: [
    { id: 'alder-tinned', householdId: 'alder' },
    { id: 'g-coconut', householdId: null },
  ],
  translations: 0,
  components: [{ mealId: 'curry', ingredientId: 'g-coconut', quantityPerServing: 100 }],
  pantry: [{ householdId: 'alder', ingredientId: 'g-coconut', quantity: 400 }],
  excluded: ['g-coconut'],
}

it('moves the meal component, pantry item and exclusion onto coconut milk and deletes tinned coconut milk', async () => {
  await world()

  await runMigration()

  expect(await mergedState()).toEqual(MERGED)
})

it('changes nothing on a second run', async () => {
  await world()
  await runMigration()

  await runMigration()

  expect(await mergedState()).toEqual(MERGED)
})

// A database that holds only the old comprehensive-seed row: left in place, it
// would shadow the alias to coconut milk.
it('deletes an unused tinned coconut milk row when there is no coconut milk row', async () => {
  await ingredient('g-tinned', 'tinned coconut milk')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'g-tinned', locale: 'et', name: 'kookospiim purgis' },
  })

  await runMigration()

  expect(await prisma.ingredient.count({ where: { name: 'tinned coconut milk' } })).toBe(0)
})

it('stops, and deletes nothing, when tinned coconut milk is in use and there is no coconut milk row', async () => {
  await ingredient('g-tinned', 'tinned coconut milk')
  await prisma.meal.create({
    data: {
      id: 'curry',
      name: 'Curry',
      components: { create: { ingredientId: 'g-tinned', quantityPerServing: 100 } },
    },
  })

  await expect(runMigration()).rejects.toThrow('HON-1552: tinned coconut milk is in use')
  expect(await prisma.mealComponent.count({ where: { ingredientId: 'g-tinned' } })).toBe(1)
})
