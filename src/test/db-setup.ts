import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PrismaPGlite } from 'pglite-prisma-adapter'
import { beforeEach } from 'vitest'

import { PrismaClient } from '@/generated/prisma/client'

// Setup file for the `unit-db` project (HON-1186): `*.db.test.ts` files run
// real Prisma queries against Postgres, here PGlite in this process.
//
// `src/lib/prisma.ts` returns `globalThis.prisma` when it is set, so assigning
// it before a test file imports `@/lib/prisma` makes every `src/lib` function
// query PGlite, with no `vi.mock`. The project sets `DATABASE_URL` to a closed
// port, so a client that bypasses this one fails instead of reaching a real
// database.
//
// The project runs one worker with `isolate: false`, so `globalThis` outlives
// a test file and the migrations apply once per run, not once per file.

const MIGRATIONS = join(process.cwd(), 'prisma/migrations')

// Migrations insert global rows (the shared ingredient pool). Each such table
// is copied into a `_seed_<table>` snapshot after migrating, and restored after
// every truncate, so a test starts from the database `migrate deploy` produces.
const SEED_PREFIX = '_seed_'

type TestDatabase = { db: PGlite; prisma: PrismaClient; tables: string[]; seeded: string[] }

const globalForDb = globalThis as unknown as {
  testDatabase?: Promise<TestDatabase>
  prisma?: PrismaClient
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite({ extensions: { pg_trgm } })
  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
  for (const name of migrations) {
    await db.exec(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'))
  }
  // PGlite registers array serializers for the types that exist when it boots,
  // so the enum arrays the migrations create have none, and a filter such as
  // `suitableFor: { has: 'dinner' }` sends a malformed array literal.
  await db.refreshArrayTypes()

  const { rows } = await db.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )
  const tables = rows.map((row) => row.name)
  const seeded: string[] = []
  for (const table of tables) {
    const { rows: count } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${quote(table)}`,
    )
    if (count[0]!.n === 0) continue
    await db.exec(`CREATE TABLE ${quote(SEED_PREFIX + table)} AS SELECT * FROM ${quote(table)}`)
    seeded.push(table)
  }

  const prisma = new PrismaClient({ adapter: new PrismaPGlite(db) })
  return { db, prisma, tables, seeded }
}

/** Empties every table, then restores the rows the migrations seeded. */
async function resetTestDatabase({ db, tables, seeded }: TestDatabase) {
  await db.exec(`TRUNCATE ${tables.map(quote).join(', ')} RESTART IDENTITY CASCADE`)
  for (const table of seeded) {
    await db.exec(`INSERT INTO ${quote(table)} SELECT * FROM ${quote(SEED_PREFIX + table)}`)
  }
}

globalForDb.testDatabase ??= createTestDatabase()
const testDatabase = await globalForDb.testDatabase
globalForDb.prisma = testDatabase.prisma

beforeEach(() => resetTestDatabase(testDatabase))
