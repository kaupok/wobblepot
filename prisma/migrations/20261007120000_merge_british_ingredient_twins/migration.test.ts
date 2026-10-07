import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INGREDIENT_SYNONYMS } from '@/lib/ingredient-aliases'
import { ingredientTranslationsEt } from '../../seed-ingredient-translations-et'

// The merge list lives in three places that must agree: this migration, the
// seeds (which must no longer define the American row), and INGREDIENT_SYNONYMS
// (which keeps the American word findable). These checks keep the three lists
// in step; migration.pglite.test.ts runs the SQL itself on Postgres.
describe('migration 20261007120000_merge_british_ingredient_twins', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')
  const pairs = [...sql.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1]!, m[2]!] as const)

  it('merges the 16 pairs and renames fresh cilantro first', () => {
    expect(pairs).toHaveLength(17)
    expect(pairs[0]).toEqual(['fresh cilantro', 'fresh coriander'])
    expect(pairs.findIndex(([from]) => from === 'cilantro')).toBeGreaterThan(0)
  })

  it.each(pairs)('keeps "%s" findable as a synonym of "%s"', (from, to) => {
    expect(INGREDIENT_SYNONYMS[from]).toBe(to)
  })

  it.each(pairs)('seeds no "%s" row and seeds "%s"', (from, to) => {
    expect(seeds).not.toContain(`name: '${from}',`)
    expect(seeds).not.toContain(`ingredient: '${from}'`)
    expect(seeds).toContain(`name: '${to}',`)
  })

  it('has no et translation key for a merged row', () => {
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

  it('moves every reference to the British row', () => {
    for (const table of [
      'meal_component',
      'pantry_item',
      'custom_shopping_item',
      'household_preferences',
      'member_preferences',
    ]) {
      expect(sql).toMatch(
        new RegExp(`UPDATE "${table}"\\s+SET "(ingredientId|excludedIngredientIds)"`),
      )
    }
  })

  it('keeps every allergen of the American row', () => {
    expect(sql).toContain('unnest(br."allergens" || am."allergens")')
  })

  it('folds the American pantry item into the British one before deleting it', () => {
    const fold = sql.indexOf('"isStaple" = b."isStaple" OR a."isStaple"')
    const drop = sql.indexOf('DELETE FROM "pantry_item"')
    expect(fold).toBeGreaterThan(0)
    expect(sql).toContain('COALESCE(b."quantity" + a."quantity" * factor, b."quantity")')
    expect(drop).toBeGreaterThan(fold)
  })

  it('deletes the translations before the row', () => {
    const translations = sql.indexOf('DELETE FROM "ingredient_translation"')
    const row = sql.indexOf('DELETE FROM "ingredient" WHERE')
    expect(translations).toBeGreaterThan(0)
    expect(row).toBeGreaterThan(translations)
  })
})
