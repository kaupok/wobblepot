import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from './seed'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'

// The PGlite setup replays this migration on empty tables, so this test runs it
// again over rows that match its WHERE clauses (HON-1491).
const MIGRATION = 'prisma/migrations/20261030190000_chicken_cut_piece_weights/migration.sql'

async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

const GRAMS_PER_PIECE = {
  'chicken breast': 272,
  'chicken thigh': 193,
  'chicken thigh fillet': 107,
  'chicken drumstick': 130,
  'chicken leg': 296,
  'chicken wing': 107,
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

it('sets the piece weight on each global chicken cut row and leaves household rows alone', async () => {
  for (const name of Object.keys(GRAMS_PER_PIECE)) {
    await prisma.ingredient.create({ data: { name, ...poultry } })
  }
  const household = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.ingredient.create({
    data: { name: 'chicken thigh', householdId: household.id, gramsPerPiece: 140, ...poultry },
  })

  await runMigration()

  expect(await gramsPerPiece('chicken thigh')).toBe(193)
  expect(await gramsPerPiece('chicken thigh fillet')).toBe(107)
  expect(await gramsPerPiece('chicken breast')).toBe(272)
  expect(await gramsPerPiece('chicken drumstick')).toBe(130)
  expect(await gramsPerPiece('chicken leg')).toBe(296)
  expect(await gramsPerPiece('chicken wing')).toBe(107)
  expect(await gramsPerPiece('chicken thigh', household.id)).toBe(140)
})

it('gives each seed row the same piece weight as the migration', () => {
  const seeded = Object.fromEntries(
    [...baseIngredients, ...newIngredients, ...importCoverageIngredients]
      .filter((row) => row.name in GRAMS_PER_PIECE)
      .map((row) => [row.name, 'gramsPerPiece' in row ? row.gramsPerPiece : null]),
  )

  expect(seeded).toEqual(GRAMS_PER_PIECE)
})
