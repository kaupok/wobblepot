// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// Runs the rename on Postgres (PGlite, in process) after every earlier
// migration: global rows keep their id under the British name, with their
// pantry items and translations; a household's own row with an American name
// stays; a second run and a database without the old rows change nothing.

const MIGRATIONS = join(__dirname, '..')
const THIS = '20261007150000_british_english_pool_names'
const migrationSql = (name: string) => readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8')
const earlier = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name) && name < THIS)
  .sort()

const PAIRS = [...migrationSql(THIS).matchAll(/\('([^']+)',\s+'([^']+)'\)/g)].map(
  (m) => [m[1]!, m[2]!] as const,
)
const quoted = (names: readonly string[]) => names.map((n) => `'${n}'`).join(', ')
const ALL_NAMES = PAIRS.flat()

async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } })
  for (const name of earlier) await db.exec(migrationSql(name))
  // Earlier migrations insert some global rows; start from a known pool.
  await db.exec(
    `DELETE FROM "ingredient" WHERE "householdId" IS NULL AND name IN (${quoted(ALL_NAMES)});`,
  )
  return db
}

function ingredient(id: string, name: string, householdId?: string) {
  return `INSERT INTO "ingredient"
    (id, name, "householdId", category, "defaultUnit", allergens, calories, protein, carbs, fat)
    VALUES ('${id}', '${name}', ${householdId ? `'${householdId}'` : 'NULL'}, 'carb', 'g', '{}', 1, 1, 1, 1);`
}

const FIXTURE = `
  INSERT INTO "household" (id, name) VALUES ('h1', 'One');
  ${PAIRS.map(([from], i) => ingredient(`g-${i}`, from)).join('\n')}
  ${ingredient('hh-flour', 'all-purpose flour', 'h1')}
  INSERT INTO "ingredient_translation" (id, "ingredientId", locale, name) VALUES
    ('t-flour', 'g-3', 'et', 'nisujahu');
  INSERT INTO "pantry_item" (id, "householdId", "ingredientId", quantity, "isStaple", "updatedAt") VALUES
    ('p-flour', 'h1', 'g-3', 500, true, now());
`

describe(`migration ${THIS} on Postgres`, () => {
  let db: PGlite
  const rows = async <T>(query: string) => (await db.query<T>(query)).rows

  beforeAll(async () => {
    db = await migratedDatabase()
    await db.exec(FIXTURE)
    await db.exec(migrationSql(THIS))
  }, 60_000)

  it('renames every global row in place, keeping its id', async () => {
    const renamed = await rows<{ id: string; name: string }>(
      `SELECT id, name FROM "ingredient" WHERE id LIKE 'g-%'`,
    )
    const byId = new Map(renamed.map((r) => [r.id, r.name]))
    expect(byId.size).toBe(PAIRS.length)
    PAIRS.forEach(([, to], i) => expect(byId.get(`g-${i}`)).toBe(to))
  })

  it('leaves no global row under an American name', async () => {
    const left = await rows<{ name: string }>(
      `SELECT name FROM "ingredient" WHERE "householdId" IS NULL AND name IN (${quoted(PAIRS.map(([from]) => from))})`,
    )
    expect(left).toEqual([])
  })

  it('keeps the translation and the pantry item on the renamed row', async () => {
    const [translation] = await rows<{ ingredientId: string; name: string }>(
      `SELECT "ingredientId", name FROM "ingredient_translation" WHERE id = 't-flour'`,
    )
    expect(translation).toEqual({ ingredientId: 'g-3', name: 'nisujahu' })
    const [pantry] = await rows<{ name: string }>(
      `SELECT i.name FROM "pantry_item" p JOIN "ingredient" i ON i.id = p."ingredientId" WHERE p.id = 'p-flour'`,
    )
    expect(pantry?.name).toBe('plain flour')
  })

  it("keeps a household's own row under its American name", async () => {
    const [row] = await rows<{ name: string }>(
      `SELECT name FROM "ingredient" WHERE id = 'hh-flour'`,
    )
    expect(row?.name).toBe('all-purpose flour')
  })

  it('changes nothing on a second run', async () => {
    const before = await rows(`SELECT id, name FROM "ingredient" ORDER BY id`)
    await db.exec(migrationSql(THIS))
    expect(await rows(`SELECT id, name FROM "ingredient" ORDER BY id`)).toEqual(before)
  })

  it('passes on a database that never had the old rows', async () => {
    const fresh = await migratedDatabase()
    await expect(fresh.exec(migrationSql(THIS))).resolves.toBeDefined()
    const created = await fresh.query(
      `SELECT name FROM "ingredient" WHERE name IN (${quoted(PAIRS.map(([, to]) => to))})`,
    )
    expect(created.rows).toEqual([])
  }, 60_000)
})
