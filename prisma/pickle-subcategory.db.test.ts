import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clause (HON-1568).
const MIGRATION = 'prisma/migrations/20261101160000_pickle_subcategory/migration.sql'

async function runMigration() {
  await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, ''))
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
      category: 'condiment',
      subcategory,
      defaultUnit: 'g',
      allergens: [],
      calories: 30,
      protein: 1,
      carbs: 4,
      fat: 0.2,
    },
  })
}

async function subcategoryOf(id: string) {
  const row = await prisma.ingredient.findUniqueOrThrow({ where: { id } })
  return row.subcategory
}

it('moves the global gherkins and capers rows to pickle, and leaves a household row', async () => {
  await ingredient('g-gherkins', 'pickled gherkins', 'pickled')
  await ingredient('g-capers', 'capers', 'pickled')
  await ingredient('g-herring', 'pickled herring', 'pickled')
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await ingredient('alder-capers', 'capers', 'pickled', alder.id)

  await runMigration()

  expect(await subcategoryOf('g-gherkins')).toBe('pickle')
  expect(await subcategoryOf('g-capers')).toBe('pickle')
  expect(await subcategoryOf('g-herring')).toBe('pickled')
  expect(await subcategoryOf('alder-capers')).toBe('pickled')
})
