import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  pieceDisplayFor,
  PIECES_IN_RECIPE_AND_SHOPPING_NAMES,
  PIECES_IN_RECIPE_ONLY_NAMES,
} from './piece-display'
import { baseIngredients } from './seed'
import { comprehensiveIngredients } from './seed-comprehensive'
import { newIngredients } from './seed-expansion'
import { importCoverageIngredients } from './seed-import-coverage'
import type { IngredientInput } from './seed-types'

describe('pieceDisplayFor', () => {
  it.each(['onion', 'carrot', 'tomato', 'garlic', 'bell pepper', 'cucumber', 'courgette'])(
    'shows %j as pieces in the recipe and on the shopping list',
    (name) => {
      expect(pieceDisplayFor({ name })).toBe('recipe_and_shopping')
    },
  )

  it('shows potato as pieces in the recipe only', () => {
    expect(pieceDisplayFor({ name: 'potato' })).toBe('recipe')
  })

  it.each(['paprika', 'vegetable oil', 'mushroom', 'Onion'])('leaves %j in grams', (name) => {
    expect(pieceDisplayFor({ name })).toBe('none')
  })
})

describe('the seed rows the rule names', () => {
  const pool: IngredientInput[] = [
    ...baseIngredients,
    ...newIngredients,
    ...comprehensiveIngredients,
    ...importCoverageIngredients,
  ]
  const named = [...PIECES_IN_RECIPE_AND_SHOPPING_NAMES, ...PIECES_IN_RECIPE_ONLY_NAMES]

  // Without gramsPerPiece the display falls back to grams, so a listed name
  // with none would silently do nothing.
  it.each(named)('seeds %j in grams with a gramsPerPiece', (name) => {
    const row = pool.find((ing) => ing.name === name)
    expect(row, `no seed row named ${name}`).toBeDefined()
    expect(row?.defaultUnit).toBe('g')
    expect(row?.gramsPerPiece).toBeGreaterThan(0)
  })
})

describe('migration 20261025120000_add_ingredient_piece_display', () => {
  const sql = readFileSync(
    path.join(__dirname, 'migrations/20261025120000_add_ingredient_piece_display/migration.sql'),
    'utf8',
  )

  // The migration repeats the module's lists by hand. Each list is the quoted
  // values of the `"name" IN (...)` clause after its `SET` line.
  function sqlList(setLine: string): string[] {
    const set = sql.indexOf(setLine)
    expect(set, `migration has no ${setLine}`).toBeGreaterThanOrEqual(0)
    const start = sql.indexOf('"name" IN (', set)
    const body = sql.slice(start, sql.indexOf(')', start))
    return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '')
  }

  it('lists exactly the module recipe-and-shopping names', () => {
    expect(sqlList(`SET "pieceDisplay" = 'recipe_and_shopping'`).sort()).toEqual(
      [...PIECES_IN_RECIPE_AND_SHOPPING_NAMES].sort(),
    )
  })

  it('lists exactly the module recipe-only names', () => {
    expect(sqlList(`SET "pieceDisplay" = 'recipe'\n`).sort()).toEqual(
      [...PIECES_IN_RECIPE_ONLY_NAMES].sort(),
    )
  })

  it('touches global ingredients only', () => {
    expect(sql.match(/WHERE "householdId" IS NULL/g)).toHaveLength(2)
  })
})
