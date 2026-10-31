import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1500).
const MIGRATION = 'prisma/migrations/20261031120000_merge_shared_estonian_name_twins/migration.sql'

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
      category: 'carb',
      defaultUnit: 'g',
      allergens: ['gluten'],
      calories: 380,
      protein: 13,
      carbs: 60,
      fat: 7,
    },
  })
}

/**
 * Alder holds `oats` everywhere a household can hold an ingredient. Birch holds
 * both rows in its pantry and one meal, so the merge must fold, not duplicate.
 */
async function world() {
  await ingredient('g-oats', 'oats')
  await ingredient('g-rolled', 'rolled oats')
  await ingredient('g-rice', 'rice')
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'g-oats', locale: 'et', name: 'kaerahelbed' },
  })
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  const birch = await prisma.household.create({ data: { id: 'birch', name: 'Birch' } })
  await ingredient('alder-oats', 'oats', alder.id)

  await prisma.meal.create({
    data: {
      id: 'porridge',
      name: 'Porridge',
      components: { create: { ingredientId: 'g-oats', quantityPerServing: 40 } },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'muesli',
      name: 'Muesli',
      components: {
        create: [
          { ingredientId: 'g-oats', quantityPerServing: 50 },
          { ingredientId: 'g-rolled', quantityPerServing: 30 },
        ],
      },
    },
  })

  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'g-oats', quantity: 100 },
  })
  await prisma.pantryItem.create({
    data: { householdId: birch.id, ingredientId: 'g-oats', quantity: 100, isStaple: true },
  })
  await prisma.pantryItem.create({
    data: { householdId: birch.id, ingredientId: 'g-rolled', quantity: 200 },
  })
  await prisma.customShoppingItem.create({
    data: { id: 'oats-item', householdId: alder.id, name: 'oats', ingredientId: 'g-oats' },
  })
  await prisma.householdPreferences.create({
    data: { householdId: alder.id, excludedIngredientIds: ['g-oats', 'g-rolled'] },
  })

  const plan = await prisma.mealPlan.create({ data: { householdId: alder.id } })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'breakfast',
      planId: plan.id,
      date: new Date('2026-11-02'),
      mealType: 'breakfast',
      mealId: 'porridge',
      changes: {
        create: [
          { id: 'left-out', originalIngredientId: 'g-oats' },
          {
            id: 'replaced',
            originalIngredientId: 'g-rice',
            replacementIngredientId: 'g-oats',
            quantityPerServing: 25,
          },
        ],
      },
      items: { create: { id: 'fridge-oats', ingredientId: 'g-oats', position: 0 } },
    },
  })
  await prisma.dayExtra.create({
    data: {
      id: 'extra-oats',
      householdId: alder.id,
      date: new Date('2026-11-02'),
      ingredientId: 'g-oats',
      quantity: 60,
      position: 0,
    },
  })
}

async function mergedState() {
  return {
    ingredients: await prisma.ingredient.findMany({
      where: { name: { in: ['oats', 'rolled oats'] } },
      select: { id: true, householdId: true },
      orderBy: { id: 'asc' },
    }),
    translations: await prisma.ingredientTranslation.count({ where: { ingredientId: 'g-oats' } }),
    components: await prisma.mealComponent.findMany({
      select: { mealId: true, ingredientId: true, quantityPerServing: true },
      orderBy: { mealId: 'asc' },
    }),
    pantry: await prisma.pantryItem.findMany({
      select: { householdId: true, ingredientId: true, quantity: true, isStaple: true },
      orderBy: { householdId: 'asc' },
    }),
    shopping: await prisma.customShoppingItem.findUniqueOrThrow({
      where: { id: 'oats-item' },
      select: { ingredientId: true },
    }),
    householdExcluded: (
      await prisma.householdPreferences.findUniqueOrThrow({ where: { householdId: 'alder' } })
    ).excludedIngredientIds,
    entryChanges: await prisma.mealPlanEntryComponent.findMany({
      select: {
        id: true,
        originalIngredientId: true,
        replacementIngredientId: true,
        quantityPerServing: true,
      },
      orderBy: { id: 'asc' },
    }),
    fridgeItem: await prisma.mealPlanEntryItem.findUniqueOrThrow({
      where: { id: 'fridge-oats' },
      select: { ingredientId: true },
    }),
    dayExtra: await prisma.dayExtra.findUniqueOrThrow({
      where: { id: 'extra-oats' },
      select: { ingredientId: true, quantity: true },
    }),
  }
}

const MERGED = {
  ingredients: [
    { id: 'alder-oats', householdId: 'alder' },
    { id: 'g-rolled', householdId: null },
  ],
  translations: 0,
  components: [
    { mealId: 'muesli', ingredientId: 'g-rolled', quantityPerServing: 80 },
    { mealId: 'porridge', ingredientId: 'g-rolled', quantityPerServing: 40 },
  ],
  pantry: [
    { householdId: 'alder', ingredientId: 'g-rolled', quantity: 100, isStaple: false },
    { householdId: 'birch', ingredientId: 'g-rolled', quantity: 300, isStaple: true },
  ],
  shopping: { ingredientId: 'g-rolled' },
  householdExcluded: ['g-rolled'],
  entryChanges: [
    {
      id: 'left-out',
      originalIngredientId: 'g-rolled',
      replacementIngredientId: null,
      quantityPerServing: null,
    },
    {
      id: 'replaced',
      originalIngredientId: 'g-rice',
      replacementIngredientId: 'g-rolled',
      quantityPerServing: 25,
    },
  ],
  fridgeItem: { ingredientId: 'g-rolled' },
  dayExtra: { ingredientId: 'g-rolled', quantity: 60 },
}

it('moves every reference to the global oats row onto rolled oats and deletes oats', async () => {
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
