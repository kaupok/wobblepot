import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseIngredients, baseMeals } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients, newMeals } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import { ingredientTranslationsEt } from './seed-ingredient-translations-et'

const SEED_FILES = [
  'prisma/seed.ts',
  'prisma/seed-expansion.ts',
  'prisma/seed-comprehensive.ts',
  'prisma/seed-import-coverage.ts',
]
const seedSource = SEED_FILES.map((file) => readFileSync(file, 'utf8')).join('\n')

const sql = readFileSync(
  'prisma/migrations/20261030160000_raw_meat_nutrition/migration.sql',
  'utf8',
)

const ingredients = [
  ...baseIngredients,
  ...newIngredients,
  ...comprehensiveIngredients,
  ...importCoverageIngredients,
]
const meals = [...baseMeals, ...newMeals]

// The edible-part check ranges in HON-1479. A value outside its range names a
// second source in its seed comment (the PR lists them).
const EDIBLE_RANGES: [string[], number, number][] = [
  [['chicken drumstick', 'turkey drumstick'], 0.65, 0.75],
  [['chicken thigh', 'turkey thigh'], 0.75, 0.85],
  [['chicken leg', 'turkey leg', 'duck leg'], 0.7, 0.8],
  [['chicken wing'], 0.5, 0.65],
  [
    ['whole chicken', 'whole turkey', 'poussin', 'guinea fowl', 'pheasant', 'quail', 'goose'],
    0.6,
    0.75,
  ],
  [['pork ribs', 'beef short rib'], 0.6, 0.8],
  [['lamb shank', 'veal shank', 'oxtail'], 0.45, 0.75],
  [['t-bone steak', 'lamb chop', 'lamb rack', 'veal chop'], 0.7, 0.9],
  [
    [
      'trout',
      'sea bass',
      'mackerel',
      'perch',
      'pike',
      'herring',
      'sea bream',
      'snapper',
      'red snapper',
      'flounder',
    ],
    0.45,
    0.65,
  ],
]
const SECOND_SOURCE = new Set(['guinea fowl', 'pheasant', 'quail', 'goose'])

/** The seed object literal for a global row, as written in the seed files. */
function rowSource(name: string): string {
  const start = seedSource.indexOf(`name: '${name}',`)
  expect(start, name).toBeGreaterThan(-1)
  return seedSource.slice(start, seedSource.indexOf('\n  },', start))
}

describe('raw, as-bought meat nutrition (HON-1479)', () => {
  it.each(EDIBLE_RANGES.flatMap(([names, min, max]) => names.map((n) => [n, min, max] as const)))(
    '%s calls asSold with a cited source and an edible part in range',
    (name, min, max) => {
      const source = rowSource(name)
      const call = source.match(/\.\.\.asSold\(\{[^}]+\}, ([\d.]+)\)/)
      expect(call, name).not.toBeNull()
      expect(source).toMatch(/\/\/ .*(USDA|no USDA)/)
      expect(source).toMatch(/\/\/ Edible part: /)
      const ediblePart = Number(call![1])
      if (SECOND_SOURCE.has(name)) {
        expect(ediblePart).toBeGreaterThan(0)
        expect(ediblePart).toBeLessThanOrEqual(1)
      } else {
        expect(ediblePart).toBeGreaterThanOrEqual(min)
        expect(ediblePart).toBeLessThanOrEqual(max)
      }
    },
  )

  it('seeds raw chicken breast and boneless thigh', () => {
    expect(ingredients.find((i) => i.name === 'chicken breast')).toMatchObject({
      calories: 120,
      protein: 22.5,
      fat: 2.6,
    })
    expect(ingredients.filter((i) => i.name === 'chicken thigh fillet')).toEqual([
      expect.objectContaining({
        subcategory: 'poultry',
        proteinType: 'poultry',
        calories: 121,
        protein: 19.7,
        fat: 4.1,
      }),
    ])
    expect(ingredientTranslationsEt).toContainEqual({
      en: 'chicken thigh fillet',
      et: 'kanakintsuliha',
    })
  })

  it('migrates every changed row to its seed values', () => {
    const updates = [
      ...sql.matchAll(
        /UPDATE "ingredient" SET "calories" = ([\d.]+), "protein" = ([\d.]+), "carbs" = ([\d.]+), "fat" = ([\d.]+), "fiber" = ([\d.]+)\nWHERE "householdId" IS NULL AND "name" IN \(([^)]+)\);/g,
      ),
    ]
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
    const names = migrated.map((m) => m.name)
    for (const [list] of EDIBLE_RANGES) expect(names).toEqual(expect.arrayContaining(list))
    expect(names).toEqual(
      expect.arrayContaining([
        'chicken breast',
        'beef mince',
        'pork chop',
        'lamb chop',
        'bacon',
        'tuna steak',
        'halibut',
        'pork rack',
      ]),
    )
    expect(new Set(names).size).toBe(names.length)
  })

  // A shop sells these whole; their fillet rows are the boneless form
  it.each([
    'plaice',
    'sole',
    'dover sole',
    'salmon',
    'cod',
    'haddock',
    'whiting',
    'pollock',
    'tilapia',
    'arctic char',
  ])('stores whole %s per 100 g as bought, with a cited edible part', (name) => {
    const source = rowSource(name)
    expect(source).toMatch(/\.\.\.asSold\(\{[^}]+\}, 0\.\d+\)/)
    expect(source).toMatch(/\/\/ Edible part: /)
    expect(rowSource(`${name} fillet`)).not.toMatch(/asSold/)
  })

  it('stores pork rack per 100 g as bought, bone included', () => {
    expect(rowSource('pork rack')).toMatch(/\.\.\.asSold\(\{[^}]+\}, 0\.66\)/)
  })

  it('migrates the boneless thigh with the seed values', () => {
    expect(sql).toContain(
      `'chicken thigh fillet', 'protein'::"IngredientCategory", 'poultry', 'poultry'::"ProteinType", 'g'::"Unit", '{}'::"Allergen"[], 121, 19.7, 0, 4.1, 0`,
    )
  })

  // The meals in the HON-1479 PR that mean the boneless cut
  const REPOINTED: [string, string, string, number][] = [
    ['Chicken Curry', 'chicken thigh', 'chicken thigh fillet', 180],
    ['Orange Chicken', 'chicken thigh', 'chicken thigh fillet', 180],
    ['Thai Basil Chicken', 'chicken thigh', 'chicken thigh fillet', 180],
    ['Chicken Teriyaki Bowl', 'chicken thigh', 'chicken thigh fillet', 180],
    ['Chicken Shawarma', 'chicken thigh', 'chicken thigh fillet', 180],
    ['Chicken Korma', 'chicken thigh', 'chicken thigh fillet', 200],
    ['Chicken Jambalaya', 'chicken thigh', 'chicken thigh fillet', 150],
    ['Trout with Almonds', 'trout', 'trout fillet', 200],
    ['Lemon Sole', 'sole', 'sole fillet', 180],
    ['Tilapia with Mango Salsa', 'tilapia', 'tilapia fillet', 180],
    ['Lamb Curry', 'lamb chop', 'lamb shoulder', 180],
    ['Irish Lamb Stew', 'lamb shank', 'lamb shoulder', 200],
  ]

  it.each(REPOINTED)('seeds %s on %s → %s', (meal, from, to, quantity) => {
    const rows = meals.filter((m) => m.name === meal)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.components).toContainEqual({ ingredient: to, quantity })
    expect(rows[0]!.components.map((c) => c.ingredient)).not.toContain(from)
  })

  it.each(REPOINTED)(
    'migrates %s, its forks and their planned changes from %s to %s',
    (meal, from, to, quantity) => {
      const statements = sql
        .split(';')
        .filter(
          (s) =>
            s.includes(`i."name" = '${from}'`) &&
            s.includes(`f."name" = '${to}'`) &&
            s.includes(`'${meal}'`),
        )
      // The library meal and its forks, each as an entry-change UPDATE then a component UPDATE
      expect(statements).toHaveLength(4)
      for (const s of statements) expect(s).toContain(`mc."quantityPerServing" = ${quantity}\n`)
      expect(statements.filter((s) => s.includes('"householdId" IS NOT NULL'))).toHaveLength(2)
      expect(statements.map((s) => s.match(/UPDATE "(\w+)"/)?.[1])).toEqual([
        'meal_plan_entry_component',
        'meal_component',
        'meal_plan_entry_component',
        'meal_component',
      ])
    },
  )
})
