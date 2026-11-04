import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1576).
const MIGRATION = 'prisma/migrations/20261104220000_bread_tortilla_subcategory/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }
}

function ingredient(
  id: string,
  name: string,
  subcategory: string,
  householdId: string | null = null,
) {
  return prisma.ingredient.create({
    data: {
      id,
      name,
      householdId,
      category: 'carb',
      subcategory,
      defaultUnit: 'g',
      allergens: ['gluten'],
      calories: 250,
      protein: 9,
      carbs: 49,
      fat: 3,
    },
  })
}

async function subcategoryOf(id: string) {
  const row = await prisma.ingredient.findUniqueOrThrow({ where: { id } })
  return row.subcategory
}

it('moves the global bread row to bread and tortilla to flatbread, and leaves a household row', async () => {
  await ingredient('g-bread', 'bread', 'grain')
  await ingredient('g-tortilla', 'tortilla', 'grain')
  await ingredient('g-bulgur', 'bulgur', 'grain')
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await ingredient('alder-bread', 'bread', 'grain', alder.id)

  await runMigration()

  expect(await subcategoryOf('g-bread')).toBe('bread')
  expect(await subcategoryOf('g-tortilla')).toBe('flatbread')
  expect(await subcategoryOf('g-bulgur')).toBe('grain')
  expect(await subcategoryOf('alder-bread')).toBe('grain')
})
