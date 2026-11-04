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
  'prisma/migrations/20261104210000_shellfish_nutrition/migration.sql',
  'utf8',
)

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]

// USDA SR Legacy 15270 (shrimp, raw) and 15271 (shrimp, cooked), per 100 g
const RAW_SHRIMP = { calories: 85, protein: 20.1, carbs: 0, fat: 0.5 }
const COOKED_SHRIMP = { calories: 99, protein: 24, carbs: 0.2, fat: 0.3 }

// Rows whose values this issue left as they were
const UNCHANGED = new Set([
  'peeled prawns',
  'small prawns',
  'cooked prawns',
  'lobster',
  'sea urchin',
])

/** The seed object literal for a global row, as written in the seed files. */
function rowSource(name: string): string {
  const start = seedSource.indexOf(`name: '${name}',`)
  expect(start, name).toBeGreaterThan(-1)
  return seedSource.slice(start, seedSource.indexOf('\n  },', start))
}

const shellfish = ingredients.filter((i) => i.subcategory === 'shellfish')

describe('as-bought shellfish nutrition (HON-1486)', () => {
  it('lists every shellfish row once', () => {
    const names = shellfish.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(22)
  })

  it.each(['prawns', 'king prawn', 'tiger prawn'])('%s holds raw shrimp values', (name) => {
    expect(ingredients.find((i) => i.name === name)).toMatchObject(RAW_SHRIMP)
    expect(rowSource(name)).toMatch(/\/\/ USDA SR Legacy 15270, /)
  })

  it.each(['peeled prawns', 'small prawns'])(
    '%s keeps cooked shrimp values, because shops sell it cooked',
    (name) => {
      expect(ingredients.find((i) => i.name === name)).toMatchObject(COOKED_SHRIMP)
      const source = rowSource(name)
      expect(source).toMatch(/\/\/ USDA SR Legacy 15271, /)
      expect(source).toMatch(/\/\/ Shops sell these already cooked/)
    },
  )

  it.each(shellfish.map((i) => i.name))('%s cites its USDA SR Legacy entry', (name) => {
    expect(rowSource(name)).toMatch(/\/\/ USDA SR Legacy (\d{5}, |has no )/)
  })

  it('migrates every changed row to its seed values', () => {
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
    const changed = shellfish.map((i) => i.name).filter((name) => !UNCHANGED.has(name))
    expect(migrated.map((m) => m.name).sort()).toEqual(changed.sort())
  })
})
