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

// The path a real household takes: it already holds coconut milk, so the unique keys
// on (householdId, ingredientId) and (mealId, ingredientId) force a merge (HON-1569).
it('merges a pantry item and a meal component that already exist on coconut milk', async () => {
  await ingredient('g-tinned', 'tinned coconut milk')
  await ingredient('g-coconut', 'coconut milk')
  const birch = await prisma.household.create({ data: { id: 'birch', name: 'Birch' } })
  await prisma.pantryItem.create({
    data: {
      householdId: birch.id,
      ingredientId: 'g-tinned',
      quantity: 2,
      isStaple: true,
      expiresAt: new Date('2027-03-01T00:00:00Z'),
    },
  })
  await prisma.pantryItem.create({
    data: {
      householdId: birch.id,
      ingredientId: 'g-coconut',
      quantity: 3,
      isStaple: false,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
  })
  await prisma.meal.create({
    data: {
      id: 'curry',
      name: 'Curry',
      components: {
        create: [
          { ingredientId: 'g-tinned', quantityPerServing: 80 },
          { ingredientId: 'g-coconut', quantityPerServing: 20 },
        ],
      },
    },
  })

  await runMigration()

  expect(
    await prisma.pantryItem.findMany({
      select: {
        householdId: true,
        ingredientId: true,
        quantity: true,
        isStaple: true,
        expiresAt: true,
      },
    }),
  ).toEqual([
    {
      householdId: 'birch',
      ingredientId: 'g-coconut',
      quantity: 5,
      isStaple: true,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
  ])
  expect(
    await prisma.mealComponent.findMany({
      select: { mealId: true, ingredientId: true, quantityPerServing: true },
    }),
  ).toEqual([{ mealId: 'curry', ingredientId: 'g-coconut', quantityPerServing: 100 }])
  expect(await prisma.ingredient.count({ where: { id: 'g-tinned' } })).toBe(0)
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
