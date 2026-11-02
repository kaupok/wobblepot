/**
 * The printer `scripts/e2e-local.sh` reads must print exactly the seed's
 * defaults, so the shell exports the credentials the seed creates (HON-1594).
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

describe('print-seed-test-user-defaults', () => {
  it('prints each default fixture credential as KEY=value', () => {
    const output = execFileSync(
      'pnpm',
      ['exec', 'tsx', path.join(scriptsDir, 'print-seed-test-user-defaults.ts')],
      { encoding: 'utf8' },
    )

    expect(output.trim().split('\n')).toEqual([
      'SMOKE_TEST_EMAIL=smoke@test.honkadori.local',
      'SMOKE_TEST_PASSWORD=smoke-test-pass-1234',
      'FORGOT_PASSWORD_TEST_EMAIL=forgot-password@test.honkadori.local',
      'FORGOT_PASSWORD_TEST_PASSWORD=forgot-pass-test-1234',
    ])
  }, 30_000)
})
