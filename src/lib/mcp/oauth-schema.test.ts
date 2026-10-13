import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// The `mcp()` plugin seeds its resource row at init, reading it and, in
// `merge` mode, updating it; answer both so the import does not reach a database.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    oauthResource: {
      findFirst: vi.fn().mockResolvedValue({ id: 'seeded' }),
      update: vi.fn().mockResolvedValue({ id: 'seeded' }),
    },
  },
}))

import { auth } from '@/lib/auth'

/**
 * Better Auth 1.7.3+ checks at init that the database has every table and
 * column its plugins write, and rejects auth requests when one is missing.
 * There is no Better Auth CLI here, so the Prisma models are written by hand
 * (HON-1150). This test makes a plugin upgrade that adds a field fail in CI
 * rather than at sign-in.
 */

interface PluginField {
  fieldName?: string
}
interface PluginModel {
  modelName?: string
  fields: Record<string, PluginField>
}

type RuntimeDataModel = {
  models: Record<string, { fields: Array<{ name: string; kind: string }> }>
}

/** The client property Prisma gives a model: `OauthClient` → `oauthClient`. */
function clientProperty(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

function prismaColumnsByModel(): Map<string, Set<string>> {
  // Constructing the client does not connect; only a query would.
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: 'postgresql://schema-test@localhost/none' }),
  }) as unknown as { _runtimeDataModel: RuntimeDataModel }
  const columns = new Map<string, Set<string>>()
  for (const [model, { fields }] of Object.entries(client._runtimeDataModel.models)) {
    columns.set(
      clientProperty(model),
      new Set(fields.filter((f) => f.kind !== 'object').map((f) => f.name)),
    )
  }
  return columns
}

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

/** The body of `model <name> { … }` in schema.prisma. */
function modelBlock(name: string): string {
  const match = SCHEMA.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`)
  return match[1]!
}

describe('OAuth provider schema', () => {
  it('has a Prisma model and column for every field the auth plugins write', () => {
    const columns = prismaColumnsByModel()
    const missing: string[] = []
    const pluginSchemas = (auth.options.plugins ?? []).flatMap((plugin) =>
      'schema' in plugin && plugin.schema
        ? Object.entries(plugin.schema as Record<string, PluginModel>)
        : [],
    )
    // The jwt and mcp plugins both declare tables; an empty list means the
    // plugins were not registered and the check below proves nothing.
    expect(pluginSchemas.map(([key]) => key)).toEqual(
      expect.arrayContaining(['jwks', 'oauthClient', 'oauthAccessToken', 'oauthConsent']),
    )

    for (const [key, model] of pluginSchemas) {
      const table = model.modelName ?? key
      const actual = columns.get(table)
      if (!actual) {
        missing.push(`model ${table}`)
        continue
      }
      for (const [field, attrs] of Object.entries({ id: {}, ...model.fields })) {
        const column = (attrs as PluginField).fieldName ?? field
        if (!actual.has(column)) missing.push(`${table}.${column}`)
      }
    }

    expect(missing).toEqual([])
  })

  it.each(['OauthAccessToken', 'OauthRefreshToken', 'OauthConsent'])(
    'deletes %s rows with their user',
    (model) => {
      expect(modelBlock(model)).toMatch(
        /\buser\s+User\??\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
      )
    },
  )

  it('keeps a registered client when its user is deleted', () => {
    expect(modelBlock('OauthClient')).toMatch(
      /\buser\s+User\?\s+@relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/,
    )
  })

  it('cascades the user foreign keys in the migration SQL', () => {
    const dir = join(process.cwd(), 'prisma/migrations')
    const migration = readdirSync(dir).find((name) => name.endsWith('_add_oauth_provider'))
    expect(migration).toBeDefined()
    const sql = readFileSync(join(dir, migration!, 'migration.sql'), 'utf8')
    for (const table of ['oauth_access_token', 'oauth_refresh_token', 'oauth_consent']) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`,
      )
    }
  })
})
