import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkLockfile,
  compareVersions,
  findViolations,
  matchesPackage,
  matchesVersion,
  parseLockfileVersions,
  PINS,
  type Pin,
} from './check-lockfile-pins'

/**
 * The gate is green on `main` by design, so these tests exist to prove the
 * tripwire actually fires. A pin assertion that can only ever pass would give
 * exactly the false confidence HON-595 was filed to remove.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'check-lockfile-pins.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

/** Run the script exactly as `pnpm lockfile:check` does, on a given lockfile. */
function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync(tsx, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repoRoot,
  })
  // A missing tsx binary or a timeout leaves `status` null, which would satisfy
  // the "exits non-zero" assertion below for entirely the wrong reason — the
  // exact false green this suite exists to rule out. Fail on it here instead.
  expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
  expect(result.status, 'process did not exit normally').not.toBeNull()
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-pins-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function fixture(name: string, contents: string): string {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, contents)
  return file
}

/**
 * The entry a regressed lockfile would carry: better-auth's `^6.1.4` spec
 * resolved back to the advisory version, which HON-588 removed by dedupe.
 * Injected ahead of the real `defu@6.1.7` entry to reconstruct the regression.
 */
const REGRESSED_DEFU = `  defu@6.1.4:
    resolution: {integrity: sha512-notarealintegrityhash}

`

/** The same regression as a standalone snippet, for the pure-function tests. */
const REGRESSED_DEFU_SNIPPET = `${REGRESSED_DEFU}  defu@6.1.7:
    resolution: {integrity: sha512-notarealintegrityhash}
`

describe('parseLockfileVersions', () => {
  it('extracts a plain package key', () => {
    const found = parseLockfileVersions('  defu@6.1.7:\n')
    expect([...(found.get('defu')?.keys() ?? [])]).toEqual(['6.1.7'])
  })

  it('extracts a quoted scoped package key', () => {
    const found = parseLockfileVersions("  '@vitest/browser@4.1.11':\n")
    expect([...(found.get('@vitest/browser')?.keys() ?? [])]).toEqual(['4.1.11'])
    // The scope must not be dropped — a bare `browser` key would make the
    // `@vitest/*` pin blind to every scoped entry.
    expect(found.has('browser')).toBe(false)
  })

  it('extracts versions that appear only inside a peer suffix', () => {
    const found = parseLockfileVersions('  better-auth@1.7.2(react@19.2.8)(vitest@4.1.11):\n')
    expect([...(found.get('vitest')?.keys() ?? [])]).toEqual(['4.1.11'])
    expect([...(found.get('react')?.keys() ?? [])]).toEqual(['19.2.8'])
  })

  it('records every distinct version of the same package', () => {
    const found = parseLockfileVersions(REGRESSED_DEFU_SNIPPET)
    expect([...(found.get('defu')?.keys() ?? [])].sort()).toEqual(['6.1.4', '6.1.7'])
  })

  it('ignores specifier ranges, which carry no name@version token', () => {
    const found = parseLockfileVersions('      defu:\n        specifier: ^6.1.4\n')
    expect(found.has('defu')).toBe(false)
  })

  it('reports the first line each version appears on', () => {
    const found = parseLockfileVersions('lockfileVersion: 9\n\n  defu@6.1.4:\n  defu@6.1.4: {}\n')
    expect(found.get('defu')?.get('6.1.4')).toBe(3)
  })
})

describe('matchesPackage / matchesVersion', () => {
  it('treats a trailing /* as a scope glob', () => {
    expect(matchesPackage('@vitest/*', '@vitest/browser')).toBe(true)
    expect(matchesPackage('@vitest/*', '@vitest/expect')).toBe(true)
    expect(matchesPackage('@vitest/*', 'vitest')).toBe(false)
  })

  it('matches a bare package name exactly', () => {
    expect(matchesPackage('defu', 'defu')).toBe(true)
    expect(matchesPackage('defu', 'defu-extra')).toBe(false)
  })

  it('treats a trailing dot as a release-line prefix', () => {
    expect(matchesVersion('4.0.', '4.0.18')).toBe(true)
    expect(matchesVersion('4.0.', '4.1.11')).toBe(false)
    // Guards against 4.0. also swallowing a future 4.0x line.
    expect(matchesVersion('4.0.', '4.01.0')).toBe(false)
  })

  it('matches an exact version otherwise', () => {
    expect(matchesVersion('6.1.4', '6.1.4')).toBe(true)
    expect(matchesVersion('6.1.4', '6.1.40')).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    // The boundary the @vitest/browser floor sits on: '4.1.9' > '4.1.10' as
    // strings, which would make the floor pass exactly the version it exists
    // to reject.
    expect(compareVersions('4.1.9', '4.1.10')).toBeLessThan(0)
    expect(compareVersions('4.1.11', '4.1.10')).toBeGreaterThan(0)
    expect(compareVersions('4.1.10', '4.1.10')).toBe(0)
  })

  it('orders across majors and minors', () => {
    expect(compareVersions('3.2.4', '4.1.0')).toBeLessThan(0)
    expect(compareVersions('5.0.0', '4.1.10')).toBeGreaterThan(0)
    expect(compareVersions('6.1.4', '6.1.5')).toBeLessThan(0)
  })

  it('sorts a prerelease below its release', () => {
    expect(compareVersions('4.1.10-beta.1', '4.1.10')).toBeLessThan(0)
    expect(compareVersions('5.0.0-beta.3', '4.1.10')).toBeGreaterThan(0)
  })
})

describe('findViolations', () => {
  const violate = (lockfile: string, pins?: Pin[]) =>
    findViolations(parseLockfileVersions(lockfile), pins)
  const details = (lockfile: string) =>
    violate(lockfile)
      .map((v) => v.detail)
      .join('\n')

  it('fires when defu resolves to more than one version', () => {
    const found = violate(REGRESSED_DEFU_SNIPPET)
    expect(found.some((v) => v.pin.kind === 'single' && v.detail.includes('6.1.4'))).toBe(true)
  })

  it('fires on defu@6.1.4 even when it is the only resolution', () => {
    const found = violate('  defu@6.1.4:\n')
    // The floor, not the duplicate rule — a sole bad version must still be caught.
    expect(found).toHaveLength(1)
    expect(found[0]?.pin.kind).toBe('minimum')
    expect(found[0]?.detail).toContain('defu@6.1.4')
  })

  // The advisory ranges below are from
  // `gh api '/advisories?ecosystem=npm&affects=<pkg>'`, checked 2026-09-07.
  // Each of these passed the point-version pins this file originally shipped.
  it('fires across the whole advisory range, not just the version we happened to clear', () => {
    // GHSA-737v-mqg7-c878 affects defu <= 6.1.4, so 6.1.3 carries it too.
    expect(details('  defu@6.1.3:\n')).toContain('defu@6.1.3')
    // GHSA-w5hq-g745-h8pq affects uuid < 11.1.1 — 9.0.1 and 11.0.0, not only 10.0.0.
    expect(details('  uuid@10.0.0:\n')).toContain('uuid@10.0.0')
    expect(details('  uuid@9.0.1:\n')).toContain('uuid@9.0.1')
    expect(details('  uuid@11.0.0:\n')).toContain('uuid@11.0.0')
    // ...and its two one-version ranges above that floor.
    expect(details('  uuid@12.0.0:\n')).toContain('uuid@12.0.0')
    expect(details('  uuid@13.0.0:\n')).toContain('uuid@13.0.0')
  })

  it('fires on vitest itself, which the @vitest/* glob cannot match', () => {
    // GHSA-5xrq-8626-4rwp (critical, vitest >= 4.0.0 < 4.1.0) is filed against
    // the bare `vitest` package — the exact resolution HON-588 moved off.
    expect(details('  vitest@4.0.18:\n')).toContain('vitest@4.0.18')
  })

  it('fires on a @vitest/browser inside 4.1.x but below the patched floor', () => {
    // GHSA-p63j-vcc4-9vmv is patched at 4.1.10, so 4.1.5 is affected despite
    // not being on the 4.0.x line the release-line ban covers.
    expect(details("  '@vitest/browser@4.1.5':\n")).toContain('@vitest/browser@4.1.5')
    expect(details("  '@vitest/browser@4.1.9':\n")).toContain('@vitest/browser@4.1.9')
  })

  it('fires on any @vitest package still on the 4.0.x line', () => {
    const found = violate("  '@vitest/runner@4.0.18':\n")
    expect(found).toHaveLength(1)
    expect(found[0]?.detail).toContain('@vitest/runner@4.0.18')
  })

  it('stays silent on the versions that are actually on main today', () => {
    // @vitest/expect@3.2.4 resolves from a separate transitive line and is
    // present on main — a glob floor would turn the branch red.
    expect(
      violate(
        "  defu@6.1.7:\n  vitest@4.1.11:\n  '@vitest/expect@3.2.4':\n  '@vitest/browser@4.1.11':\n",
      ),
    ).toEqual([])
  })

  it('carries a why for every pin, so a failure is actionable', () => {
    for (const pin of PINS) {
      expect(pin.why.length, `${pin.package} has no why`).toBeGreaterThan(40)
    }
  })
})

describe('checkLockfile', () => {
  it('refuses to report pins as holding against a truncated lockfile', () => {
    // Without this guard an empty or half-written file resolves no packages,
    // no pin can fire, and the gate prints "4 pin(s) hold" over nothing — a
    // green check that proves the opposite of what it claims.
    const truncated = fixture('truncated.yaml', "lockfileVersion: '9.0'\n\npackages:\n")
    expect(() => checkLockfile(truncated)).toThrow(/does not look like a pnpm lockfile/)
  })

  it('reads the real lockfile without tripping the plausibility guard', () => {
    expect(checkLockfile(path.join(repoRoot, 'pnpm-lock.yaml'))).toEqual([])
  })
})

// AC #3: the assertion must demonstrably fail on a bad lockfile and pass on the
// real one, via the actual process exit code — the thing CI reads.
describe('CLI exit codes', () => {
  it('exits non-zero and names the offending entry on a regressed lockfile', () => {
    // The real lockfile with the HON-588 dedupe undone: better-auth's `^6.1.4`
    // spec resolved back to the advisory version, alongside the 6.1.7 that
    // Prisma's c12 still pulls. Built from the real file rather than a bare
    // snippet so it also clears the truncation guard in checkLockfile.
    const realLockfile = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8')
    const bad = fixture(
      'regressed-defu.yaml',
      realLockfile.replace('  defu@6.1.7:', `${REGRESSED_DEFU}  defu@6.1.7:`),
    )
    const { status, output } = run(bad)

    expect(status).not.toBe(0)
    expect(output).toContain('defu@6.1.4')
    expect(output).toContain('pin violation')
    // The remediation must not send anyone toward pnpm.overrides, which
    // HON-588 rejected on purpose.
    expect(output).toContain('pnpm update')
  })

  it('exits zero on the real pnpm-lock.yaml', () => {
    const { status, output } = run()

    expect(status, output).toBe(0)
    expect(output).toContain('pin(s) hold')
  })
})
