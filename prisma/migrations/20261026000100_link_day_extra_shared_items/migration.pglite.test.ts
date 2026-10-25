// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// Runs both link backfills on Postgres (PGlite, in process): a later extra of
// the same name shares the item the first one linked; an extra whose
// same-name item no extra links to stays unlinked, because the household
// typed that item by hand.

const MIGRATIONS = join(__dirname, '..')
const THIS = '20261026000100_link_day_extra_shared_items'
const migrationSql = (name: string) => readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8')
const upToThis = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name) && name <= THIS)
  .sort()
const beforeLinks = upToThis.filter((name) => name < '20261026000000')
const links = upToThis.filter((name) => name >= '20261026000000')

const T = `TIMESTAMP '2026-10-24 10:00:00'`

const FIXTURE = `
  INSERT INTO "household" (id, name) VALUES ('h1', 'One');
  INSERT INTO "custom_shopping_item" (id, "householdId", name, "createdAt") VALUES
    ('item-chips', 'h1', 'chips', ${T} + INTERVAL '1 second'),
    ('item-soap', 'h1', 'soap', ${T} - INTERVAL '1 day');
  INSERT INTO "day_extra" (id, "householdId", date, label, position, "createdAt") VALUES
    ('chips-wed', 'h1', DATE '2026-10-28', 'chips', 0, ${T}),
    ('chips-sat', 'h1', DATE '2026-10-31', 'chips', 0, ${T} + INTERVAL '2 hours'),
    ('chips-sun', 'h1', DATE '2026-11-01', 'chips', 0, ${T} + INTERVAL '3 hours'),
    ('soap-sat', 'h1', DATE '2026-10-31', 'soap', 1, ${T});
`

describe(`migration ${THIS} on Postgres`, () => {
  let db: PGlite
  const linkOf = async (id: string) =>
    (
      await db.query<{ customShoppingItemId: string | null }>(
        `SELECT "customShoppingItemId" FROM "day_extra" WHERE id = $1`,
        [id],
      )
    ).rows[0]?.customShoppingItemId

  beforeAll(async () => {
    db = new PGlite({ extensions: { pg_trgm } })
    for (const name of beforeLinks) await db.exec(migrationSql(name))
    await db.exec(FIXTURE)
    for (const name of links) await db.exec(migrationSql(name))
  }, 60_000)

  it('links every later extra of the same name to the shared item', async () => {
    expect(await linkOf('chips-wed')).toBe('item-chips')
    expect(await linkOf('chips-sat')).toBe('item-chips')
    expect(await linkOf('chips-sun')).toBe('item-chips')
  })

  it('leaves an extra unlinked when no extra links its item', async () => {
    expect(await linkOf('soap-sat')).toBeNull()
  })
})
