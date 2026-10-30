import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from './seed'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1492).
const MIGRATION =
  'prisma/migrations/20261030210000_chicken_cutlet_tender_piece_weights/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

// Chicken strip stays on the 30 g fallback: a strip has no standard size.
const GRAMS_PER_PIECE = {
  'chicken cutlet': 136,
  'chicken tender': 40,
  'chicken strip': null,
}

const poultry = {
  category: 'protein',
  subcategory: 'poultry',
  proteinType: 'poultry',
  defaultUnit: 'g',
  calories: 150,
  protein: 18,
  carbs: 0,
  fat: 8,
  fiber: 0,
} as const

async function gramsPerPiece(name: string, householdId: string | null = null) {
  const row = await prisma.ingredient.findFirstOrThrow({ where: { name, householdId } })
  return row.gramsPerPiece
}

it('sets the piece weight on the global cutlet and tender rows and leaves household rows alone', async () => {
  for (const name of Object.keys(GRAMS_PER_PIECE)) {
    await prisma.ingredient.create({ data: { name, ...poultry } })
  }
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.ingredient.create({
    data: { name: 'chicken cutlet', householdId: household.id, gramsPerPiece: 90, ...poultry },
  })

  await runMigration()

  expect(await gramsPerPiece('chicken cutlet')).toBe(136)
  expect(await gramsPerPiece('chicken tender')).toBe(40)
  expect(await gramsPerPiece('chicken strip')).toBeNull()
  expect(await gramsPerPiece('chicken cutlet', household.id)).toBe(90)
})

it('gives each seed row the same piece weight as the migration', () => {
  const seeded = Object.fromEntries(
    [...baseIngredients, ...newIngredients, ...importCoverageIngredients]
      .filter((row) => row.name in GRAMS_PER_PIECE)
      .map((row) => [row.name, 'gramsPerPiece' in row ? row.gramsPerPiece : null]),
  )

  expect(seeded).toEqual(GRAMS_PER_PIECE)
})
