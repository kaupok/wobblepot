import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { newIngredients } from './seed-expansion'
import { ingredientTranslationsEt } from './seed-ingredient-translations-et'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clause (HON-1603).
const MIGRATION = 'prisma/migrations/20261105100000_rename_fresh_anchovies/migration.sql'

async function runMigration() {
  await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, ''))
}

function ingredient(id: string, name: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      id,
      name,
      householdId,
      category: 'protein',
      defaultUnit: 'g',
      allergens: ['fish'],
      calories: 81.2,
      protein: 12.6,
      carbs: 0,
      fat: 3,
    },
  })
}

it('renames the global anchovies row in place and keeps its id', async () => {
  await ingredient('g-anchovies', 'anchovies')
  await ingredient('g-tinned', 'tinned anchovies')
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'g-anchovies', quantity: 100 },
  })

  await runMigration()

  expect(await prisma.ingredient.findUnique({ where: { id: 'g-anchovies' } })).toMatchObject({
    name: 'fresh anchovies',
  })
  expect(await prisma.ingredient.findUnique({ where: { id: 'g-tinned' } })).toMatchObject({
    name: 'tinned anchovies',
  })
  expect(
    await prisma.pantryItem.findMany({ select: { ingredient: { select: { name: true } } } }),
  ).toEqual([{ ingredient: { name: 'fresh anchovies' } }])
})

it("leaves a household's own anchovies row alone", async () => {
  const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
  await ingredient('alder-anchovies', 'anchovies', alder.id)

  await runMigration()

  expect(await prisma.ingredient.findUnique({ where: { id: 'alder-anchovies' } })).toMatchObject({
    name: 'anchovies',
  })
})

it('seeds the new name, with its Estonian name, and not the old one', () => {
  const names = newIngredients.map((row) => row.name)
  expect(names).toContain('fresh anchovies')
  expect(names).not.toContain('anchovies')
  expect(ingredientTranslationsEt.find((row) => row.en === 'fresh anchovies')?.et).toBe(
    'värsked anšoovised',
  )
  expect(ingredientTranslationsEt.some((row) => row.en === 'anchovies')).toBe(false)
})
