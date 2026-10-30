import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseIngredients, baseMeals } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients, newMeals } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'

// The table and component list in HON-1473, so a typo in the seed files or the
// migration fails here. Values: kcal, protein, carbs, fat, fiber per 100 g.
const DRY_VALUES: [string[], number[]][] = [
  [
    ['white rice', 'long grain rice', 'basmati rice', 'jasmine rice'],
    [360, 7, 79, 0.6, 1.3],
  ],
  [
    ['arborio rice', 'risotto rice', 'short grain rice', 'sushi rice'],
    [358, 6.5, 79, 0.5, 1],
  ],
  [['brown rice'], [367, 7.5, 76, 3.2, 3.6]],
  [['wild rice'], [357, 14.7, 75, 1.1, 6.2]],
  [
    ['pasta', 'spaghetti', 'penne', 'fusilli', 'orzo', 'lasagne sheets', 'noodles'],
    [371, 13, 75, 1.5, 3.2],
  ],
  [
    ['tagliatelle', 'egg noodles'],
    [384, 14, 71, 4.4, 3.3],
  ],
  [['rice noodles'], [364, 6, 80, 0.6, 1.6]],
  [['soba noodles'], [336, 14, 75, 0.7, 4]],
  [['quinoa'], [368, 14, 64, 6, 7]],
  [['couscous'], [376, 13, 77, 0.6, 5]],
  [['bulgur'], [342, 12, 76, 1.3, 18]],
  [['buckwheat'], [346, 12, 72, 2.7, 10]],
  [['millet'], [378, 11, 73, 4.2, 8.5]],
  [
    ['barley', 'pearl barley'],
    [352, 10, 78, 1.2, 15.6],
  ],
  [['farro'], [340, 14, 68, 2.5, 10]],
  [['polenta'], [362, 8, 77, 3.6, 7]],
  [
    ['lentils', 'red lentils', 'green lentils', 'brown lentils', 'beluga lentils'],
    [352, 25, 60, 1.1, 11],
  ],
  [['split peas'], [341, 25, 60, 1.2, 25]],
  // Canned, drained, so every bean row means the same thing
  [
    ['borlotti beans', 'black-eyed beans', 'great northern beans'],
    [120, 8, 20, 0.5, 6],
  ],
]

const RESCALED: [string, string, number][] = [
  ...[
    'Pork Fried Rice',
    'Egg Fried Rice',
    'Vegetable Fried Rice',
    'Beef Bibimbap',
    'Tuna Poke Bowl',
    'Japanese Gyudon',
    'Chicken Jambalaya',
    'Salmon Teriyaki Bowl',
  ].map((meal): [string, string, number] => [meal, 'white rice', 60]),
  ['Duck Fried Rice', 'white rice', 80],
  ['Lamb Biryani', 'basmati rice', 60],
  ['Lamb Pilaf', 'basmati rice', 60],
  ['Red Lentil Dal', 'red lentils', 60],
  ['Dal Tadka', 'red lentils', 60],
  ['Split Pea Soup', 'split peas', 60],
  ['Pork Lo Mein', 'noodles', 65],
  ['Pork Fried Noodles', 'egg noodles', 65],
  ['Classic Lasagne', 'lasagne sheets', 65],
  ['Vegetable Lasagne', 'lasagne sheets', 65],
]

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]
const meals = [...baseMeals, ...newMeals]

const sql = readFileSync(
  'prisma/migrations/20261030140000_dry_weight_grain_nutrition/migration.sql',
  'utf8',
)

const quoted = (list: string[]) => list.map((n) => `'${n}'`).join(', ')

describe('dry, as-bought grain nutrition (HON-1473)', () => {
  it.each(DRY_VALUES)(
    'seeds %j with dry values',
    (names, [calories, protein, carbs, fat, fiber]) => {
      for (const name of names) {
        const rows = ingredients.filter((ing) => ing.name === name)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ calories, protein, carbs, fat, fiber })
      }
    },
  )

  it.each(DRY_VALUES)(
    'migrates %j to the same values',
    (names, [calories, protein, carbs, fat, fiber]) => {
      expect(sql).toContain(
        `UPDATE "ingredient" SET "calories" = ${calories}, "protein" = ${protein}, "carbs" = ${carbs}, "fat" = ${fat}, "fiber" = ${fiber}\n` +
          `WHERE "householdId" IS NULL AND "name" IN (${quoted(names)});`,
      )
    },
  )

  it.each(RESCALED)('seeds %s with %s at %i g a serving', (meal, ingredient, quantity) => {
    const rows = meals.filter((m) => m.name === meal)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.components).toContainEqual({ ingredient, quantity })
  })

  it.each(RESCALED)('migrates %s, %s to %i g a serving', (meal, ingredient, quantity) => {
    const statement = sql
      .split(';')
      .find((s) => s.includes(`i."name" = '${ingredient}'`) && s.includes(`'${meal}'`))
    expect(statement).toContain(`SET "quantityPerServing" = ${quantity}\n`)
  })
})
