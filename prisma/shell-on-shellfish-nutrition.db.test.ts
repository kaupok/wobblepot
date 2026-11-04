import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1597).
const MIGRATION = 'prisma/migrations/20261104230000_shell_on_shellfish_nutrition/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

const shellfish = { category: 'protein', subcategory: 'shellfish', defaultUnit: 'g' } as const

it('sets global shell-on rows to as-bought values and moves the Lobster Tail meal and its forks to the tail row', async () => {
  const lobster = await prisma.ingredient.create({
    data: { name: 'lobster', ...shellfish, calories: 89, protein: 19, carbs: 0, fat: 0.9 },
  })
  const tail = await prisma.ingredient.create({
    data: { name: 'lobster tail', ...shellfish, calories: 77, protein: 16.5, carbs: 0, fat: 0.8 },
  })
  const mussels = await prisma.ingredient.create({
    data: { name: 'mussels', ...shellfish, calories: 86, protein: 11.9, carbs: 3.7, fat: 2.2 },
  })
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  const ownMussels = await prisma.ingredient.create({
    data: {
      name: 'mussels',
      householdId: household.id,
      ...shellfish,
      calories: 86,
      protein: 11.9,
      carbs: 3.7,
      fat: 2.2,
    },
  })
  const meal = (name: string, householdId: string | null, quantityPerServing = 200) =>
    prisma.meal.create({
      data: {
        name,
        householdId,
        components: { create: { ingredientId: lobster.id, quantityPerServing } },
      },
    })
  const library = await prisma.meal.create({
    data: {
      name: 'Lobster Tail',
      translations: { create: { locale: 'et', name: 'Homari saba' } },
      components: { create: { ingredientId: lobster.id, quantityPerServing: 200 } },
    },
  })
  const forkEn = await meal('Lobster Tail', household.id)
  const forkEt = await meal('Homari saba', household.id)
  const renamed = await meal('Our lobster', household.id)
  const edited = await meal('Lobster Tail', household.id, 150)
  const wholeLobster = await meal('Lobster Thermidor', null)

  await runMigration()

  expect(await prisma.ingredient.findUniqueOrThrow({ where: { id: lobster.id } })).toMatchObject({
    calories: 32,
    protein: 6.8,
    carbs: 0,
    fat: 0.3,
  })
  expect(await prisma.ingredient.findUniqueOrThrow({ where: { id: mussels.id } })).toMatchObject({
    calories: 20.6,
    protein: 2.9,
    carbs: 0.9,
    fat: 0.5,
  })
  // A household typed its own values from a pack label
  expect(
    (await prisma.ingredient.findUniqueOrThrow({ where: { id: ownMussels.id } })).calories,
  ).toBe(86)
  // The tail row keeps its meat values
  expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: tail.id } })).calories).toBe(77)

  const ingredientOf = async (mealId: string) =>
    (await prisma.mealComponent.findFirstOrThrow({ where: { mealId } })).ingredientId
  expect(await ingredientOf(library.id)).toBe(tail.id)
  expect(await ingredientOf(forkEn.id)).toBe(tail.id)
  expect(await ingredientOf(forkEt.id)).toBe(tail.id)
  // Found by name at the old amount only
  expect(await ingredientOf(renamed.id)).toBe(lobster.id)
  expect(await ingredientOf(edited.id)).toBe(lobster.id)
  expect(await ingredientOf(wholeLobster.id)).toBe(lobster.id)
})

it('leaves a Lobster Tail meal alone when it already holds the tail row', async () => {
  const lobster = await prisma.ingredient.create({
    data: { name: 'lobster', ...shellfish, calories: 89, protein: 19, carbs: 0, fat: 0.9 },
  })
  const tail = await prisma.ingredient.create({
    data: { name: 'lobster tail', ...shellfish, calories: 77, protein: 16.5, carbs: 0, fat: 0.8 },
  })
  const library = await prisma.meal.create({
    data: {
      name: 'Lobster Tail',
      components: {
        create: [
          { ingredientId: lobster.id, quantityPerServing: 200 },
          { ingredientId: tail.id, quantityPerServing: 100 },
        ],
      },
    },
  })

  await runMigration()

  const components = await prisma.mealComponent.findMany({
    where: { mealId: library.id },
    orderBy: { quantityPerServing: 'desc' },
  })
  expect(components.map((c) => c.ingredientId)).toEqual([lobster.id, tail.id])
})
