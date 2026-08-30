import { describe, expect, it } from 'vitest'
import {
  audit,
  ignoreReason,
  isDocFile,
  parseEnvLsTable,
  referencesFor,
  type VercelVar,
} from './env-audit'

/**
 * The audit is silent on a clean tree by design, so these tests exist to prove
 * the tripwire actually fires — a check that can only ever pass is worthless.
 * `audit` takes an injectable reference resolver so no `git grep` runs here.
 */

const vercelVar = (name: string, environments = ['Production']): VercelVar => ({
  name,
  environments,
})

/** Reference resolver backed by a fixed name → files map. */
const resolver =
  (refs: Record<string, string[]>) =>
  (name: string): string[] =>
    refs[name] ?? []

describe('ignoreReason', () => {
  it('suppresses Upstash integration-managed names', () => {
    expect(ignoreReason('UPSTASH_KV_REST_API_READ_ONLY_TOKEN')).toBeTruthy()
    expect(ignoreReason('UPSTASH_REDIS_URL')).toBeTruthy()
  })

  it('does not suppress the names our code actually reads', () => {
    expect(ignoreReason('UPSTASH_REDIS_REST_URL')).toBeNull()
    expect(ignoreReason('UPSTASH_REDIS_REST_TOKEN')).toBeNull()
    expect(ignoreReason('DATABASE_URL')).toBeNull()
  })
})

describe('isDocFile', () => {
  it('treats Markdown and .env files as documentation', () => {
    expect(isDocFile('docs/FEATURE_FLAGS.md')).toBe(true)
    expect(isDocFile('.env.example')).toBe(true)
  })

  it('treats code, scripts and workflows as real references', () => {
    expect(isDocFile('prisma/seed.ts')).toBe(false)
    expect(isDocFile('scripts/neon-cleanup.sh')).toBe(false)
    expect(isDocFile('.github/workflows/ci.yml')).toBe(false)
  })
})

describe('audit', () => {
  it('flags a var with no repo reference as ORPHAN', () => {
    const { findings } = audit([vercelVar('FEATURE_RETIRED_GATE')], resolver({}))

    expect(findings).toEqual([
      {
        name: 'FEATURE_RETIRED_GATE',
        tier: 'ORPHAN',
        environments: ['Production'],
        files: [],
      },
    ])
  })

  it('flags a var referenced only in documentation as DOC-ONLY', () => {
    const { findings } = audit(
      [vercelVar('FEATURE_HALF_RETIRED')],
      resolver({ FEATURE_HALF_RETIRED: ['docs/FEATURE_FLAGS.md', '.env.example'] }),
    )

    expect(findings[0]).toMatchObject({ name: 'FEATURE_HALF_RETIRED', tier: 'DOC-ONLY' })
  })

  it('does not flag vars read outside env.ts — the original false-positive class', () => {
    // These are live vars consumed via raw process.env in seeds, shell scripts
    // and workflows. An env.ts-schema comparison flagged all of them (HON-550).
    const vars = [
      vercelVar('SEED_TEST_USERS'),
      vercelVar('NEON_API_KEY'),
      vercelVar('SMOKE_TEST_EMAIL'),
    ]
    const { findings } = audit(
      vars,
      resolver({
        SEED_TEST_USERS: ['prisma/seed.ts'],
        NEON_API_KEY: ['scripts/neon-cleanup.sh', '.env.example'],
        SMOKE_TEST_EMAIL: ['tests/e2e/smoke.spec.ts'],
      }),
    )

    expect(findings).toEqual([])
  })

  it('skips integration-managed vars instead of reporting them', () => {
    const { findings, ignored } = audit([vercelVar('UPSTASH_KV_URL')], resolver({}))

    expect(findings).toEqual([])
    expect(ignored).toEqual(['UPSTASH_KV_URL'])
  })

  it('preserves every environment a flagged var is set in', () => {
    const { findings } = audit(
      [vercelVar('FEATURE_RETIRED_GATE', ['Development', 'Production', 'staging'])],
      resolver({}),
    )

    expect(findings[0]?.environments).toEqual(['Development', 'Production', 'staging'])
  })
})

describe('parseEnvLsTable', () => {
  // Columns are separated by 2+ spaces; the name is column 1 and the
  // environment list column 3. Pinning the shape here because `vercel env ls`
  // has no --json, so a CLI table change is the realistic way this breaks.
  const table = [
    ' name                     value       environments (git branch)          created',
    ' DATABASE_URL             Encrypted   Production, Preview, staging       3d ago',
    ' NEON_API_KEY             Encrypted   Preview (kaupo/some-branch)        4m ago',
    ' UPSTASH_REDIS_REST_URL   Encrypted   Development                        3d ago',
  ].join('\n')

  it('extracts every name with its environments', () => {
    expect(parseEnvLsTable(table)).toEqual([
      { name: 'DATABASE_URL', environments: ['Preview', 'Production', 'staging'] },
      { name: 'NEON_API_KEY', environments: ['Preview'] },
      { name: 'UPSTASH_REDIS_REST_URL', environments: ['Development'] },
    ])
  })

  it('skips the header row rather than treating it as a variable', () => {
    expect(parseEnvLsTable(table).map((v) => v.name)).not.toContain('name')
  })

  it('merges rows that repeat a name across environments', () => {
    const repeated = [
      ' CRON_SECRET   Encrypted   Production   3d ago',
      ' CRON_SECRET   Encrypted   staging      3d ago',
    ].join('\n')

    expect(parseEnvLsTable(repeated)).toEqual([
      { name: 'CRON_SECRET', environments: ['Production', 'staging'] },
    ])
  })

  it('returns nothing for output with no variable rows', () => {
    expect(parseEnvLsTable('No Environment Variables found\n')).toEqual([])
  })
})

describe('referencesFor', () => {
  // Runs real `git grep` against this repo.
  it('finds a variable that the codebase genuinely uses', () => {
    expect(referencesFor('DATABASE_URL')).toContain('src/lib/env.ts')
  })

  it('returns empty for a name nothing references', () => {
    expect(referencesFor('WOBBLEPOT_NO_SUCH_VARIABLE_XYZ')).toEqual([])
  })

  it('respects word boundaries so a prefix does not match a longer name', () => {
    // Without `-w`, DATABASE_URL would match DATABASE_URL_UNPOOLED and a
    // retired DATABASE_URL would look referenced. prisma.ts uses only the
    // pooled name, so it must not surface for the unpooled one.
    expect(referencesFor('DATABASE_URL_UNPOOLED')).not.toContain('src/lib/prisma.ts')
  })

  it("excludes the audit's own files so fixtures cannot immunise a variable", () => {
    // Every name this test file mentions would otherwise count as a live code
    // reference, and retiring it for real would produce no finding at all.
    const files = referencesFor('SEED_TEST_USERS')

    expect(files).not.toContain('scripts/env-audit.test.ts')
    expect(files).not.toContain('scripts/env-audit.ts')
    expect(files).toContain('prisma/seed.ts')
  })
})
