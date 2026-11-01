import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1550).
const MIGRATION = 'prisma/migrations/20261101100000_dry_weight_bean_nutrition/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

const cookedBean = {
  category: 'legume',
  subcategory: 'bean',
  defaultUnit: 'g',
  calories: 105,
  protein: 7,
  carbs: 19,
  fat: 0.4,
  fiber: 7.6,
} as const

it('sets the three global bean rows to dry values and leaves a household row', async () => {
  const mung = await prisma.ingredient.create({ data: { name: 'mung beans', ...cookedBean } })
  const adzuki = await prisma.ingredient.create({ data: { name: 'adzuki beans', ...cookedBean } })
  const soy = await prisma.ingredient.create({ data: { name: 'soybeans', ...cookedBean } })
  const borlotti = await prisma.ingredient.create({
    data: { name: 'borlotti beans', ...cookedBean },
  })
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  const ownMung = await prisma.ingredient.create({
    data: { name: 'mung beans', householdId: household.id, ...cookedBean },
  })

  await runMigration()

  const values = async (id: string) =>
    prisma.ingredient.findUniqueOrThrow({
      where: { id },
      select: { calories: true, protein: true, carbs: true, fat: true, fiber: true },
    })
  expect(await values(mung.id)).toEqual({
    calories: 347,
    protein: 23.9,
    carbs: 62.6,
    fat: 1.1,
    fiber: 16.3,
  })
  expect(await values(adzuki.id)).toEqual({
    calories: 329,
    protein: 19.9,
    carbs: 62.9,
    fat: 0.5,
    fiber: 12.7,
  })
  expect(await values(soy.id)).toEqual({
    calories: 446,
    protein: 36.5,
    carbs: 30.2,
    fat: 19.9,
    fiber: 9.3,
  })
  // A drained-tin bean row is not in the migration
  expect((await values(borlotti.id)).calories).toBe(105)
  // A household typed its own values from a pack label
  expect(await values(ownMung.id)).toEqual({
    calories: 105,
    protein: 7,
    carbs: 19,
    fat: 0.4,
    fiber: 7.6,
  })
})
