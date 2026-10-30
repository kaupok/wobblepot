import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1473).
const MIGRATION = 'prisma/migrations/20261030140000_dry_weight_grain_nutrition/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

const cookedPasta = {
  category: 'carb',
  defaultUnit: 'g',
  calories: 131,
  protein: 5,
  carbs: 25,
  fat: 1.1,
} as const

it('sets global rows to dry values and rescales the listed seed components and their forks', async () => {
  const pasta = await prisma.ingredient.create({ data: { name: 'pasta', ...cookedPasta } })
  const rice = await prisma.ingredient.create({ data: { name: 'white rice', ...cookedPasta } })
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  const ownPasta = await prisma.ingredient.create({
    data: { name: 'pasta', householdId: household.id, ...cookedPasta },
  })
  const listed = await prisma.meal.create({
    data: {
      name: 'Egg Fried Rice',
      translations: { create: { locale: 'et', name: 'Munapraadriis' } },
      components: { create: { ingredientId: rice.id, quantityPerServing: 150 } },
    },
  })
  // "Make it my recipe" copies the library amount into a household meal
  const fork = (name: string, quantityPerServing = 150) =>
    prisma.meal.create({
      data: {
        name,
        householdId: household.id,
        components: { create: { ingredientId: rice.id, quantityPerServing } },
      },
    })
  const forkEn = await fork('Egg Fried Rice')
  const forkEt = await fork('Munapraadriis')
  const renamed = await fork('Our fried rice')
  const edited = await fork('Egg Fried Rice', 120)
  const unlisted = await prisma.meal.create({
    data: {
      name: 'Rice Bowl',
      components: { create: { ingredientId: rice.id, quantityPerServing: 150 } },
    },
  })

  await runMigration()

  expect(await prisma.ingredient.findUniqueOrThrow({ where: { id: pasta.id } })).toMatchObject({
    calories: 371,
    protein: 13,
    carbs: 75,
    fat: 1.5,
    fiber: 3.2,
  })
  expect(await prisma.ingredient.findUniqueOrThrow({ where: { id: rice.id } })).toMatchObject({
    calories: 360,
    carbs: 79,
  })
  // A household typed its own values from a pack label
  expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ownPasta.id } })).calories).toBe(
    131,
  )
  const amount = async (mealId: string) =>
    (await prisma.mealComponent.findFirstOrThrow({ where: { mealId } })).quantityPerServing
  expect(await amount(listed.id)).toBe(60)
  expect(await amount(unlisted.id)).toBe(150)
  expect(await amount(forkEn.id)).toBe(60)
  expect(await amount(forkEt.id)).toBe(60)
  // Found by name at the old amount only
  expect(await amount(renamed.id)).toBe(150)
  expect(await amount(edited.id)).toBe(120)
})
