import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1551).
const MIGRATION = 'prisma/migrations/20261101120000_merge_tomato_puree_into_passata/migration.sql'

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
 * Alder holds `tomato puree` in a meal, its pantry and its exclusions, and has
 * its own `tomato puree` row, which is its data and stays.
 */
async function world() {
  // 20260216130000 inserts a global `tomato puree`, and the replay kept it
  // because no `passata` row existed yet
  await prisma.ingredient.deleteMany({
    where: { name: { in: ['tomato puree', 'passata'] }, householdId: null },
  })
  await ingredient('g-puree', 'tomato puree')
  await ingredient('g-passata', 'passata')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'g-puree', locale: 'et', name: 'tomatipüree' },
  })
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await ingredient('alder-puree', 'tomato puree', alder.id)

  await prisma.meal.create({
    data: {
      id: 'ragu',
      name: 'Ragu',
      components: { create: { ingredientId: 'g-puree', quantityPerServing: 80 } },
    },
  })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'g-puree', quantity: 500 },
  })
  await prisma.householdPreferences.create({
    data: { householdId: alder.id, excludedIngredientIds: ['g-puree'] },
  })
}

async function mergedState() {
  return {
    ingredients: await prisma.ingredient.findMany({
      where: { name: { in: ['tomato puree', 'passata'] } },
      select: { id: true, householdId: true },
      orderBy: { id: 'asc' },
    }),
    translations: await prisma.ingredientTranslation.count({ where: { ingredientId: 'g-puree' } }),
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
    { id: 'alder-puree', householdId: 'alder' },
    { id: 'g-passata', householdId: null },
  ],
  translations: 0,
  components: [{ mealId: 'ragu', ingredientId: 'g-passata', quantityPerServing: 80 }],
  pantry: [{ householdId: 'alder', ingredientId: 'g-passata', quantity: 500 }],
  excluded: ['g-passata'],
}

it('moves the meal component, pantry item and exclusion onto passata and deletes tomato puree', async () => {
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
