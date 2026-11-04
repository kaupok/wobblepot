import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'

const SEED_FILES = [
  'prisma/seed.ts',
  'prisma/seed-expansion.ts',
  'prisma/seed-comprehensive.ts',
  'prisma/seed-import-coverage.ts',
]
const seedSource = SEED_FILES.map((file) => readFileSync(file, 'utf8')).join('\n')

const sql = readFileSync(
  'prisma/migrations/20261104230000_sardine_anchovy_nutrition/migration.sql',
  'utf8',
)

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]

// Raw edible values × 0.62 (FAO 309): Ciqual 26065 sardine, raw; USDA SR Legacy 15001 anchovy, raw
const AS_SOLD = {
  sardines: { calories: 99.2, protein: 12.1, carbs: 0, fat: 5.7, fiber: 0 },
  anchovies: { calories: 81.2, protein: 12.6, carbs: 0, fat: 3, fiber: 0 },
}

// Canned in oil, drained (USDA SR Legacy 15088 and 15002); this issue left them as they were
const TINNED = {
  'tinned sardines': { calories: 208, protein: 24.6, carbs: 0, fat: 11.5 },
  'tinned anchovies': { calories: 210, protein: 29, carbs: 0, fat: 10 },
}

/** The seed object literal for a global row, as written in the seed files. */
function rowSource(name: string): string {
  const start = seedSource.indexOf(`name: '${name}',`)
  expect(start, name).toBeGreaterThan(-1)
  return seedSource.slice(start, seedSource.indexOf('\n  },', start))
}

describe('fresh sardine and anchovy nutrition (HON-1487)', () => {
  it.each(Object.entries(AS_SOLD))('%s holds raw whole-fish values', (name, values) => {
    expect(ingredients.find((i) => i.name === name)).toMatchObject(values)
    const source = rowSource(name)
    expect(source).toMatch(/\.\.\.asSold\(\{ [^}]+ \}, 0\.62\)/)
    expect(source).toMatch(/\/\/ .*(USDA SR Legacy \d{5}, |Ciqual 2025 \(ANSES\) \d{5}, ).*raw/)
    expect(source).toMatch(/\/\/ Edible part: FAO Fisheries Technical Paper 309, /)
  })

  it.each(Object.entries(TINNED))('%s keeps its canned values', (name, values) => {
    expect(ingredients.find((i) => i.name === name)).toMatchObject(values)
  })

  it('migrates both rows to their seed values', () => {
    const updates = [
      ...sql.matchAll(
        /UPDATE "ingredient" SET "calories" = ([\d.]+), "protein" = ([\d.]+), "carbs" = ([\d.]+), "fat" = ([\d.]+), "fiber" = ([\d.]+)\nWHERE "householdId" IS NULL AND "name" IN \(([^)]+)\);/g,
      ),
    ]
    expect(updates).toHaveLength(sql.match(/^UPDATE /gm)!.length)
    const migrated = updates.flatMap(([, calories, protein, carbs, fat, fiber, list]) =>
      list!.split(', ').map((quoted) => ({
        name: quoted.slice(1, -1),
        values: [calories, protein, carbs, fat, fiber].map(Number),
      })),
    )
    for (const { name, values } of migrated) {
      const row = ingredients.find((i) => i.name === name)
      expect(row, name).toBeDefined()
      expect([row!.calories, row!.protein, row!.carbs, row!.fat, row!.fiber ?? 0], name).toEqual(
        values,
      )
    }
    expect(migrated.map((m) => m.name).sort()).toEqual(['anchovies', 'sardines'])
  })
})
