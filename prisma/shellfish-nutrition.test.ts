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

// Applied in this order, so a later file's value for a row wins
const MIGRATIONS = [
  'prisma/migrations/20261104210000_shellfish_nutrition/migration.sql',
  'prisma/migrations/20261104230000_shell_on_shellfish_nutrition/migration.sql',
]

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]

// USDA SR Legacy 15270 (shrimp, raw) and 15271 (shrimp, cooked), per 100 g
const RAW_SHRIMP = { calories: 85, protein: 20.1, carbs: 0, fat: 0.5 }
const COOKED_SHRIMP = { calories: 99, protein: 24, carbs: 0.2, fat: 0.3 }

// Rows whose values no migration changed
const UNCHANGED = new Set(['peeled prawns', 'small prawns', 'cooked prawns', 'sea urchin'])

// Shell-on rows and their cited edible part (HON-1597)
const EDIBLE_PART: Record<string, number> = {
  mussels: 0.24,
  clams: 0.15,
  oysters: 0.1,
  crayfish: 0.15,
  lobster: 0.36,
}

// Shell-on rows with no citable edible part, so they keep the meat values
const NO_EDIBLE_PART_SOURCE = ['crab leg', 'king crab', 'lobster tail']

/** The seed object literal for a global row, as written in the seed files. */
function rowSource(name: string): string {
  const start = seedSource.indexOf(`name: '${name}',`)
  expect(start, name).toBeGreaterThan(-1)
  return seedSource.slice(start, seedSource.indexOf('\n  },', start))
}

const shellfish = ingredients.filter((i) => i.subcategory === 'shellfish')

describe('as-bought shellfish nutrition (HON-1486, HON-1597)', () => {
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

  it.each(Object.entries(EDIBLE_PART))(
    '%s holds as-bought values, shell included, with a cited edible part',
    (name, ediblePart) => {
      const source = rowSource(name)
      expect(source.match(/\.\.\.asSold\(\{[^}]+\}, ([\d.]+)\)/)?.[1], name).toBe(
        String(ediblePart),
      )
      expect(source).toMatch(/\/\/ Edible part: (?!no source)/)
    },
  )

  it.each(NO_EDIBLE_PART_SOURCE)('%s keeps meat values and says why', (name) => {
    const source = rowSource(name)
    expect(source).not.toMatch(/asSold\(/)
    expect(source).toMatch(/\/\/ Edible part: no source gives the meat share/)
  })

  it.each(['prawns', 'king prawn', 'tiger prawn'])(
    '%s keeps meat values, because a recipe often weighs raw prawns peeled',
    (name) => {
      const source = rowSource(name)
      expect(source).not.toMatch(/asSold\(/)
      expect(source).toMatch(/a recipe often weighs them\n\s+\/\/ peeled/)
    },
  )

  it('migrates every changed row to its seed values', () => {
    const migratedValues = new Map<string, number[]>()
    for (const file of MIGRATIONS) {
      const sql = readFileSync(file, 'utf8')
      const updates = [
        ...sql.matchAll(
          /UPDATE "ingredient" SET "calories" = ([\d.]+), "protein" = ([\d.]+), "carbs" = ([\d.]+), "fat" = ([\d.]+), "fiber" = ([\d.]+)\nWHERE "householdId" IS NULL AND "name" IN \(([^)]+)\);/g,
        ),
      ]
      expect(updates, file).toHaveLength(sql.match(/^UPDATE "ingredient" /gm)!.length)
      for (const [, calories, protein, carbs, fat, fiber, list] of updates) {
        for (const quoted of list!.split(', ')) {
          migratedValues.set(
            quoted.slice(1, -1),
            [calories, protein, carbs, fat, fiber].map(Number),
          )
        }
      }
    }
    const migrated = [...migratedValues].map(([name, values]) => ({ name, values }))
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
