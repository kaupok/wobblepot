import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INGREDIENT_ALIASES, INGREDIENT_SYNONYMS } from '@/lib/ingredient-aliases'
import { ingredientTranslationsEt } from '../../seed-ingredient-translations-et'

// The rename list lives in four places that must agree: this migration, the
// seeds (which must define the British name and not the American one), the et
// translation keys, and INGREDIENT_SYNONYMS (which keeps the American word
// findable). These checks keep them in step; migration.pglite.test.ts runs the
// SQL itself on Postgres.
describe('migration 20261007150000_british_english_pool_names', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')
  const pairs = [...sql.matchAll(/\('([^']+)',\s+'([^']+)'\)/g)].map((m) => [m[1]!, m[2]!] as const)

  it('renames the 54 rows of HON-1099, each name once', () => {
    expect(pairs).toHaveLength(54)
    expect(new Set(pairs.map(([from]) => from)).size).toBe(54)
    expect(new Set(pairs.map(([, to]) => to)).size).toBe(54)
  })

  it('never renames a row to a name another pair renames away', () => {
    const from = new Set(pairs.map(([name]) => name))
    for (const [, to] of pairs) expect(from.has(to)).toBe(false)
  })

  it.each(pairs)('keeps "%s" findable as a synonym of "%s"', (from, to) => {
    expect(INGREDIENT_SYNONYMS[from]).toBe(to)
  })

  it.each(pairs)('seeds no "%s" row and seeds "%s"', (from, to) => {
    expect(seeds).not.toContain(`name: '${from}',`)
    expect(seeds).not.toContain(`ingredient: '${from}'`)
    expect(seeds).toContain(`name: '${to}',`)
  })

  it('moves the et translation key to the British name', () => {
    const keys = new Set(ingredientTranslationsEt.map((t) => t.en))
    for (const [from, to] of pairs) {
      expect(keys.has(from)).toBe(false)
      expect(keys.has(to)).toBe(true)
    }
  })

  it('leaves no alias or synonym pointing at an American name', () => {
    const from = new Set(pairs.map(([name]) => name))
    for (const target of [
      ...Object.values(INGREDIENT_ALIASES),
      ...Object.values(INGREDIENT_SYNONYMS),
    ]) {
      expect(from.has(target)).toBe(false)
    }
  })

  it('renames global rows only', () => {
    expect(sql).toMatch(/WHERE i\."name" = r\.old_name\s+AND i\."householdId" IS NULL;/)
  })
})
