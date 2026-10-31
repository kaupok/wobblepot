import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { INGREDIENT_SYNONYMS } from '@/lib/ingredient-aliases'

import { ingredientTranslationsEt } from '../../seed-ingredient-translations-et'

// The merge list lives in three places that must agree: this migration, the
// seeds (which must no longer define the removed row), and INGREDIENT_SYNONYMS
// (which keeps the removed name findable). These checks keep the three lists in
// step; prisma/merge-shared-estonian-name-twins.db.test.ts runs the SQL itself.
describe('migration 20261031120000_merge_shared_estonian_name_twins', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')
  const unquote = (literal: string) => literal.replace(/''/g, "'")
  const pairs = [...sql.matchAll(/\['((?:[^']|'')+)', '((?:[^']|'')+)'\]/g)].map(
    (m) => [unquote(m[1]!), unquote(m[2]!)] as const,
  )

  it('merges the 18 rows', () => {
    expect(pairs).toHaveLength(18)
    expect(pairs).toContainEqual(['chèvre', "goat's cheese"])
  })

  it.each(pairs)('keeps "%s" findable as a synonym of "%s"', (from, to) => {
    expect(INGREDIENT_SYNONYMS[from]).toBe(to)
  })

  it.each(pairs)('seeds no "%s" row and seeds "%s"', (from, to) => {
    expect(seeds).not.toMatch(new RegExp(`name: ['"]${from}['"],`))
    expect(seeds).not.toMatch(new RegExp(`ingredient: ['"]${from}['"]`))
    expect(seeds).toMatch(new RegExp(`name: ['"]${to}['"],`))
  })

  it('has no et translation key for a removed row', () => {
    const keys = new Set(ingredientTranslationsEt.map((t) => t.en))
    for (const [from, to] of pairs) {
      expect(keys.has(from)).toBe(false)
      expect(keys.has(to)).toBe(true)
    }
  })

  it('selects global rows only', () => {
    const lookups = [...sql.matchAll(/WHERE "name" = pair\[\d\][^;]*;/g)].map((m) => m[0])
    expect(lookups).toHaveLength(2)
    for (const lookup of lookups) expect(lookup).toContain('AND "householdId" IS NULL')
  })

  it('moves every reference to the surviving row', () => {
    for (const [table, column] of [
      ['meal_component', 'ingredientId'],
      ['pantry_item', 'ingredientId'],
      ['custom_shopping_item', 'ingredientId'],
      ['meal_plan_entry_component', 'originalIngredientId'],
      ['meal_plan_entry_component', 'replacementIngredientId'],
      ['meal_plan_entry_item', 'ingredientId'],
      ['day_extra', 'ingredientId'],
      ['household_preferences', 'excludedIngredientIds'],
    ]) {
      expect(sql).toMatch(new RegExp(`UPDATE "${table}"\\s+SET "${column}"`))
    }
  })

  it('deletes the translations before the row', () => {
    const translations = sql.indexOf('DELETE FROM "ingredient_translation"')
    const row = sql.indexOf('DELETE FROM "ingredient" WHERE')
    expect(translations).toBeGreaterThan(0)
    expect(row).toBeGreaterThan(translations)
  })
})
