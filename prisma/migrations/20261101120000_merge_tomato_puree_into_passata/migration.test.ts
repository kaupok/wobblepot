import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { INGREDIENT_SYNONYMS } from '@/lib/ingredient-aliases'

import { ingredientTranslationsEt } from '../../seed-ingredient-translations-et'

// The seeds must no longer define `tomato puree`, and INGREDIENT_SYNONYMS keeps
// the name findable. prisma/merge-tomato-puree-into-passata.db.test.ts runs the
// SQL itself.
describe('migration 20261101120000_merge_tomato_puree_into_passata', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')

  it('merges tomato puree into passata, global rows only', () => {
    expect(sql).toContain("['tomato puree', 'passata']")
    const lookups = [...sql.matchAll(/WHERE "name" = pair\[\d\][^;]*;/g)].map((m) => m[0])
    expect(lookups).toHaveLength(2)
    for (const lookup of lookups) expect(lookup).toContain('AND "householdId" IS NULL')
  })

  it('keeps both spellings findable as synonyms of passata', () => {
    expect(INGREDIENT_SYNONYMS['tomato puree']).toBe('passata')
    expect(INGREDIENT_SYNONYMS['tomato purée']).toBe('passata')
  })

  it('seeds no tomato puree row and seeds passata', () => {
    expect(seeds).not.toMatch(/name: ['"]tomato puree['"],/)
    expect(seeds).not.toMatch(/ingredient: ['"]tomato puree['"]/)
    expect(seeds).toMatch(/name: ['"]passata['"],/)
  })

  it('has no et translation key for tomato puree', () => {
    const keys = new Set(ingredientTranslationsEt.map((t) => t.en))
    expect(keys.has('tomato puree')).toBe(false)
    expect(keys.has('passata')).toBe(true)
  })
})
