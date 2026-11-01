import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// The seeds must name the pickle subcategory one way, and the SQL moves the
// existing global rows to it.
describe('migration 20261101160000_pickle_subcategory', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')
  const seeds = ['seed.ts', 'seed-expansion.ts', 'seed-comprehensive.ts', 'seed-import-coverage.ts']
    .map((file) => readFileSync(join(__dirname, '../..', file), 'utf-8'))
    .join('\n')

  it('moves pickled gherkins and capers to the pickle subcategory, global rows only', () => {
    expect(sql).toContain(`SET "subcategory" = 'pickle'`)
    expect(sql).toContain(`"name" IN ('pickled gherkins', 'capers')`)
    expect(sql).toContain('"householdId" IS NULL')
  })

  it('leaves no seed row with the pickled subcategory', () => {
    expect(seeds).not.toContain("subcategory: 'pickled'")
    expect(seeds).toMatch(
      /name: 'pickled gherkins',\s+category: 'vegetable',\s+subcategory: 'pickle',/,
    )
  })
})
