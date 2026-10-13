// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  findFixtureSpecDrift,
  SHARED_FIXTURE_SPECS,
  usesSeededFixture,
} from './shared-fixture-specs'

const E2E_DIR = join(__dirname, '..')

describe('usesSeededFixture', () => {
  it('detects a fixture helper call', () => {
    expect(usesSeededFixture('  const { email } = smokeFixture()')).toBe(true)
    expect(usesSeededFixture('const creds = forgotPasswordFixture()')).toBe(true)
  })

  it('detects a direct credential read', () => {
    expect(usesSeededFixture('const email = process.env.SMOKE_TEST_EMAIL')).toBe(true)
    expect(usesSeededFixture("const p = process.env['FORGOT_PASSWORD_TEST_PASSWORD']")).toBe(true)
  })

  it('ignores comment lines that name a helper', () => {
    const source = [
      '// signs in as smokeFixture() would',
      '/* SMOKE_TEST_EMAIL is not needed */',
      ' * forgotPasswordFixture() is for the reset flow',
      'await signUp(page)',
    ].join('\n')
    expect(usesSeededFixture(source)).toBe(false)
  })

  it('does not match an import of the helper alone', () => {
    expect(usesSeededFixture("import { smokeFixture } from './utils/fixtures'")).toBe(false)
  })
})

describe('findFixtureSpecDrift', () => {
  it('flags a spec that signs in as a fixture but is not listed', () => {
    const specs = new Map([
      ['listed.spec.ts', 'smokeFixture()'],
      ['new-thing.spec.ts', 'const { email, password } = smokeFixture()'],
    ])
    expect(findFixtureSpecDrift(specs, ['listed.spec.ts'])).toEqual({
      unlisted: ['new-thing.spec.ts'],
      stale: [],
    })
  })

  it('flags a listed spec that is missing or no longer uses a fixture', () => {
    const specs = new Map([['moved-to-signup.spec.ts', 'await signUp(page)']])
    expect(findFixtureSpecDrift(specs, ['moved-to-signup.spec.ts', 'deleted.spec.ts'])).toEqual({
      unlisted: [],
      stale: ['moved-to-signup.spec.ts', 'deleted.spec.ts'],
    })
  })
})

// The guard (HON-1182): CI runs the `isolated` project on two workers, so a
// spec that signs in as a seeded fixture and is missing from the list would
// share the smoke household with another spec at the same time, and flake.
describe('shared-fixture spec list', () => {
  it('matches the specs that sign in as a seeded fixture', () => {
    const specs = new Map(
      readdirSync(E2E_DIR)
        .filter((file) => file.endsWith('.spec.ts'))
        .map((file) => [file, readFileSync(join(E2E_DIR, file), 'utf8')] as const),
    )
    const drift = findFixtureSpecDrift(specs)

    expect(
      drift.unlisted,
      'These specs sign in as a seeded fixture. Add them to SHARED_FIXTURE_SPECS in tests/e2e/utils/shared-fixture-specs.ts so CI runs them one at a time.',
    ).toEqual([])
    expect(
      drift.stale,
      'These SHARED_FIXTURE_SPECS entries are missing or no longer sign in as a fixture. Remove them from the list.',
    ).toEqual([])
  })

  it('has no duplicate entries', () => {
    expect(new Set(SHARED_FIXTURE_SPECS).size).toBe(SHARED_FIXTURE_SPECS.length)
  })
})
