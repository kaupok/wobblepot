import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { INGREDIENT_SYNONYMS } from '@/lib/ingredient-aliases'

import { ingredientTranslationsEt } from '../../seed-ingredient-translations-et'

// The seeds must no longer define `tinned coconut milk`, and INGREDIENT_SYNONYMS
// keeps the name findable. prisma/merge-tinned-coconut-milk-into-coconut-milk.db.test.ts
// runs the SQL itself.
describe('migration 20261101140000_merge_tinned_coconut_milk_into_coconut_milk', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')

  it('merges tinned coconut milk into coconut milk, global rows only', () => {
    expect(sql).toContain("['tinned coconut milk', 'coconut milk']")
    const lookups = [...sql.matchAll(/WHERE "name" = pair\[\d\][^;]*;/g)].map((m) => m[0])
    expect(lookups).toHaveLength(2)
    for (const lookup of lookups) expect(lookup).toContain('AND "householdId" IS NULL')
  })

  it('keeps the tin names findable as synonyms of coconut milk', () => {
    expect(INGREDIENT_SYNONYMS['tinned coconut milk']).toBe('coconut milk')
    expect(INGREDIENT_SYNONYMS['canned coconut milk']).toBe('coconut milk')
    expect(INGREDIENT_SYNONYMS['coconut milk canned']).toBe('coconut milk')
  })

  it('seeds no tinned coconut milk row, and seeds coconut milk and the carton drink', () => {
    expect(seeds).not.toMatch(/name: ['"]tinned coconut milk['"],/)
    expect(seeds).not.toMatch(/ingredient: ['"]tinned coconut milk['"]/)
    expect(seeds).toMatch(/name: ['"]coconut milk['"],/)
    expect(seeds).toMatch(/name: ['"]coconut milk drink['"],/)
  })

  it('has no et translation key for tinned coconut milk', () => {
    const et = new Map(ingredientTranslationsEt.map((t) => [t.en, t.et]))
    expect(et.has('tinned coconut milk')).toBe(false)
    expect(et.get('coconut milk')).toBe('kookospiim')
    expect(et.get('coconut milk drink')).toBe('kookosjook')
  })
})
