import { describe, expect, it } from 'vitest'
import { audit, ignoreReason, isDocFile, type VercelVar } from './env-audit'

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
