import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLowered, loweringReason, parseThresholds } from './check-coverage-ratchet'

/**
 * The gate passes on every PR that leaves the thresholds alone, so these tests
 * exist to prove it fires on a lowered threshold, and lets one through only
 * with a reason line.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'check-coverage-ratchet.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

function config(t: { lines: number; functions: number; branches: number; statements: number }) {
  return `export default {
  test: {
    coverage: {
      thresholds: {
        lines: ${t.lines},
        functions: ${t.functions},
        branches: ${t.branches},
        statements: ${t.statements},
      },
    },
  },
}
`
}

const BASE = { lines: 92, functions: 89, branches: 87, statements: 92 }

describe('parseThresholds', () => {
  it('reads the four thresholds from the real vitest.config.ts', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'vitest.config.ts'), 'utf8')
    const thresholds = parseThresholds(text)
    // Each is a whole number above 0: the issue sets them to the measured
    // level rounded down, so a 0 means the block was not read.
    for (const value of Object.values(thresholds)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('reads each metric by name, in any order', () => {
    const text = 'thresholds: { statements: 4, branches: 3, functions: 2, lines: 1 }'
    expect(parseThresholds(text)).toEqual({ lines: 1, functions: 2, branches: 3, statements: 4 })
  })

  it('ignores a value in a line comment', () => {
    const text = `thresholds: {
      // lines: 99 was the old target
      lines: 50, functions: 50, branches: 50, statements: 50,
    }`
    expect(parseThresholds(text).lines).toBe(50)
  })

  it('throws when the block is missing', () => {
    expect(() => parseThresholds('coverage: {}')).toThrow(/found 0/)
  })

  it('throws when a metric is not a number literal', () => {
    const text = 'thresholds: { lines: LINES, functions: 1, branches: 1, statements: 1 }'
    expect(() => parseThresholds(text)).toThrow(/`lines`/)
  })
})

describe('findLowered', () => {
  it('reports each lowered metric with both values', () => {
    expect(findLowered(BASE, { ...BASE, branches: 86, lines: 91 })).toEqual([
      { metric: 'lines', from: 92, to: 91 },
      { metric: 'branches', from: 87, to: 86 },
    ])
  })

  it('reports nothing when thresholds rise or stay', () => {
    expect(findLowered(BASE, { ...BASE, lines: 93 })).toEqual([])
    expect(findLowered(BASE, BASE)).toEqual([])
  })
})

describe('loweringReason', () => {
  it('returns the text after the prefix', () => {
    const body = '## Context\n\nCoverage threshold lowered: the PGlite tests moved out\n'
    expect(loweringReason(body)).toBe('the PGlite tests moved out')
  })

  it('returns null without the line, or with the prefix and no reason', () => {
    expect(loweringReason('## Context\n\nNothing here.')).toBeNull()
    expect(loweringReason('Coverage threshold lowered:   ')).toBeNull()
  })
})

describe('CLI', () => {
  let dir: string

  function git(...args: string[]) {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: dir,
      stdio: 'ignore',
    })
  }

  /** Commit `BASE` as the base, then write `head` to the working tree. */
  function fixture(head: typeof BASE) {
    fs.writeFileSync(path.join(dir, 'vitest.config.ts'), config(BASE))
    git('add', 'vitest.config.ts')
    git('commit', '-m', 'base')
    fs.writeFileSync(path.join(dir, 'vitest.config.ts'), config(head))
  }

  function run(prBody = ''): { status: number; output: string } {
    const result = spawnSync(tsx, [script, 'HEAD', dir], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PR_BODY: prBody },
    })
    // A missing tsx binary or a timeout leaves `status` null, which would
    // satisfy an "exits non-zero" assertion for the wrong reason.
    expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
    expect(result.status, 'process did not exit normally').not.toBeNull()
    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-ratchet-'))
    git('init', '-q')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('exits 1 and names the metric when a threshold is lowered', () => {
    fixture({ ...BASE, functions: 88 })
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('functions: 89 → 88')
  })

  it('exits 0 when a lowered threshold has a reason in the PR body', () => {
    fixture({ ...BASE, functions: 88 })
    const { status, output } = run('Coverage threshold lowered: removed the dead importer')
    expect(status).toBe(0)
    expect(output).toContain('removed the dead importer')
  })

  it('exits 0 when thresholds rise', () => {
    fixture({ ...BASE, lines: 93 })
    expect(run().status).toBe(0)
  })

  it('exits 1 when the head config has no readable thresholds', () => {
    fs.writeFileSync(path.join(dir, 'vitest.config.ts'), config(BASE))
    git('add', 'vitest.config.ts')
    git('commit', '-m', 'base')
    fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}\n')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('found 0')
  })
})
