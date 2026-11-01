import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'

// The USDA raw mature seed values in HON-1550, so a typo in the seed files or
// the migration fails here. Values: kcal, protein, carbs, fat, fiber per 100 g.
const DRY_VALUES: [string, number[]][] = [
  ['mung beans', [347, 23.9, 62.6, 1.1, 16.3]],
  ['adzuki beans', [329, 19.9, 62.9, 0.5, 12.7]],
  ['soybeans', [446, 36.5, 30.2, 19.9, 9.3]],
]

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]

const sql = readFileSync(
  'prisma/migrations/20261101100000_dry_weight_bean_nutrition/migration.sql',
  'utf8',
)

describe('dry, as-bought bean nutrition (HON-1550)', () => {
  it.each(DRY_VALUES)(
    'seeds %s with dry values',
    (name, [calories, protein, carbs, fat, fiber]) => {
      const rows = ingredients.filter((ing) => ing.name === name)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ calories, protein, carbs, fat, fiber })
    },
  )

  it.each(DRY_VALUES)(
    'migrates %s to the same values',
    (name, [calories, protein, carbs, fat, fiber]) => {
      expect(sql).toContain(
        `UPDATE "ingredient" SET "calories" = ${calories}, "protein" = ${protein}, "carbs" = ${carbs}, "fat" = ${fat}, "fiber" = ${fiber}\n` +
          `WHERE "householdId" IS NULL AND "name" IN ('${name}');`,
      )
    },
  )
})
