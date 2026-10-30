import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from './seed'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1479).
const MIGRATION = 'prisma/migrations/20261030160000_raw_meat_nutrition/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

const roastedThigh = {
  category: 'protein',
  subcategory: 'poultry',
  proteinType: 'poultry',
  defaultUnit: 'g',
  calories: 209,
  protein: 26,
  carbs: 0,
  fat: 10.9,
  fiber: 0,
} as const

it('sets raw, as-bought values and moves boneless library meals and their forks to the fillet', async () => {
  // An empty database stays empty: the fillet comes only with a seeded thigh
  await runMigration()
  expect(await prisma.ingredient.count({ where: { name: 'chicken thigh fillet' } })).toBe(0)

  const thigh = await prisma.ingredient.create({ data: { name: 'chicken thigh', ...roastedThigh } })
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  const ownThigh = await prisma.ingredient.create({
    data: { name: 'chicken thigh', householdId: household.id, ...roastedThigh },
  })
  const meal = (name: string, quantityPerServing: number, householdId?: string) =>
    prisma.meal.create({
      data: {
        name,
        householdId,
        components: { create: { ingredientId: thigh.id, quantityPerServing } },
      },
    })
  const curry = await prisma.meal.create({
    data: {
      name: 'Chicken Curry',
      translations: { create: { locale: 'et', name: 'Kanakarri' } },
      components: { create: { ingredientId: thigh.id, quantityPerServing: 180 } },
    },
  })
  const roasted = await meal('Baked Chicken Thighs', 200)
  // "Make it my recipe" copies the library amount into a household meal
  const forkEn = await meal('Chicken Curry', 180, household.id)
  const forkEt = await meal('Kanakarri', 180, household.id)
  const renamed = await meal('Our curry', 180, household.id)
  const edited = await meal('Chicken Curry', 150, household.id)
  // A planned curry where the household swapped the chicken for tofu
  const tofu = await prisma.ingredient.create({
    data: {
      name: 'tofu',
      category: 'protein',
      defaultUnit: 'g',
      calories: 76,
      protein: 8,
      carbs: 2,
      fat: 4.8,
    },
  })
  const plan = await prisma.mealPlan.create({ data: { householdId: household.id } })
  const swap = await prisma.mealPlanEntryComponent.create({
    data: {
      entry: {
        create: {
          planId: plan.id,
          date: new Date('2026-11-05'),
          mealType: 'dinner',
          mealId: curry.id,
        },
      },
      originalIngredient: { connect: { id: thigh.id } },
      replacementIngredient: { connect: { id: tofu.id } },
    },
  })

  await runMigration()
  await runMigration()

  const seeded = baseIngredients.find((i) => i.name === 'chicken thigh')!
  expect(await prisma.ingredient.findUniqueOrThrow({ where: { id: thigh.id } })).toMatchObject({
    calories: seeded.calories,
    protein: seeded.protein,
    carbs: seeded.carbs,
    fat: seeded.fat,
    fiber: seeded.fiber,
  })
  // A household typed its own values from a pack label
  expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ownThigh.id } })).protein).toBe(
    26,
  )

  const fillets = await prisma.ingredient.findMany({
    where: { name: 'chicken thigh fillet', householdId: null },
  })
  expect(fillets).toEqual([
    expect.objectContaining({
      category: 'protein',
      subcategory: 'poultry',
      proteinType: 'poultry',
      calories: 121,
      protein: 19.7,
      fat: 4.1,
    }),
  ])

  const component = (mealId: string) => prisma.mealComponent.findFirstOrThrow({ where: { mealId } })
  expect(await component(curry.id)).toMatchObject({
    ingredientId: fillets[0]!.id,
    quantityPerServing: 180,
  })
  expect((await component(forkEn.id)).ingredientId).toBe(fillets[0]!.id)
  expect((await component(forkEt.id)).ingredientId).toBe(fillets[0]!.id)
  // A meal that means the cut on the bone keeps it
  expect((await component(roasted.id)).ingredientId).toBe(thigh.id)
  // Found by name at the old amount only
  expect((await component(renamed.id)).ingredientId).toBe(thigh.id)
  expect((await component(edited.id)).ingredientId).toBe(thigh.id)
  // The planned swap follows the component, so it still applies
  expect(
    await prisma.mealPlanEntryComponent.findUniqueOrThrow({ where: { id: swap.id } }),
  ).toMatchObject({ originalIngredientId: fillets[0]!.id, replacementIngredientId: tofu.id })
})
