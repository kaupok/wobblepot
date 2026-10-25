// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// Runs the link backfill on Postgres (PGlite, in process) after every earlier
// migration: a free-text extra links the manual item created within 10 seconds
// after it; a same-name item from another time, another household's item and
// an ingredient extra stay unlinked.

const MIGRATIONS = join(__dirname, '..')
const THIS = '20261026000000_link_day_extra_to_shopping_item'
const migrationSql = (name: string) => readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8')
const earlier = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name) && name < THIS)
  .sort()

const T = `TIMESTAMP '2026-10-24 18:00:00'`

const FIXTURE = `
  INSERT INTO "household" (id, name) VALUES ('h1', 'One'), ('h2', 'Two');
  INSERT INTO "ingredient"
    (id, name, "householdId", category, "defaultUnit", allergens, calories, protein, carbs, fat)
    VALUES ('ing-wine', 'test wine', NULL, 'carb', 'g', '{}', 1, 1, 1, 1);
  INSERT INTO "custom_shopping_item" (id, "householdId", name, "createdAt") VALUES
    ('item-chips', 'h1', 'chips', ${T} + INTERVAL '1 second'),
    ('item-cake', 'h1', 'cake', ${T} - INTERVAL '5 minutes'),
    ('item-nuts', 'h2', 'nuts', ${T} + INTERVAL '1 second');
  INSERT INTO "day_extra" (id, "householdId", date, label, "ingredientId", position, "createdAt") VALUES
    ('extra-chips', 'h1', DATE '2026-10-31', 'chips', NULL, 0, ${T}),
    ('extra-cake', 'h1', DATE '2026-10-31', 'cake', NULL, 1, ${T}),
    ('extra-nuts', 'h1', DATE '2026-10-31', 'nuts', NULL, 2, ${T}),
    ('extra-wine', 'h1', DATE '2026-10-31', NULL, 'ing-wine', 3, ${T});
`

describe(`migration ${THIS} on Postgres`, () => {
  let db: PGlite
  const links = async () =>
    new Map(
      (
        await db.query<{ id: string; customShoppingItemId: string | null }>(
          `SELECT id, "customShoppingItemId" FROM "day_extra"`,
        )
      ).rows.map((r) => [r.id, r.customShoppingItemId]),
    )

  beforeAll(async () => {
    db = new PGlite({ extensions: { pg_trgm } })
    for (const name of earlier) await db.exec(migrationSql(name))
    await db.exec(FIXTURE)
    await db.exec(migrationSql(THIS))
  }, 60_000)

  it('links a free-text extra to the item copied from it', async () => {
    expect((await links()).get('extra-chips')).toBe('item-chips')
  })

  it('leaves a same-name item created minutes earlier unlinked', async () => {
    expect((await links()).get('extra-cake')).toBeNull()
  })

  it("does not link another household's item", async () => {
    expect((await links()).get('extra-nuts')).toBeNull()
  })

  it('leaves an ingredient extra unlinked', async () => {
    expect((await links()).get('extra-wine')).toBeNull()
  })

  it('refuses a link on an ingredient extra', async () => {
    await expect(
      db.exec(
        `UPDATE "day_extra" SET "customShoppingItemId" = 'item-chips' WHERE id = 'extra-wine'`,
      ),
    ).rejects.toThrow(/day_extra_link_free_text_only/)
  })

  it('clears the link when the item is deleted', async () => {
    await db.exec(`DELETE FROM "custom_shopping_item" WHERE id = 'item-chips'`)
    expect((await links()).get('extra-chips')).toBeNull()
  })
})
