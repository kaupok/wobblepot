import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  checkTree,
  findViolations,
  isComponentFile,
  listComponents,
  MIN_PLAUSIBLE_COMPONENTS,
} from './check-colocated-stories'

/**
 * The check is green on `main` by design, so these tests exist to prove the
 * tripwire fires. Each builds a throwaway repo root with a `src/components`
 * tree rather than touching the real one.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'check-colocated-stories.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

const roots: string[] = []

/** A fresh repo root holding the given repo-relative files, all empty. */
function fixture(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colocated-stories-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true })
  for (const file of files) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** Run the script exactly as `pnpm stories:check` does, on a given root. */
function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync(tsx, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repoRoot,
  })
  // A missing tsx binary or a timeout leaves `status` null, which would satisfy
  // an "exits non-zero" assertion for the wrong reason. Fail on it here.
  expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
  expect(result.status, 'script did not exit normally').not.toBeNull()
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
}

describe('isComponentFile', () => {
  it('accepts a component and rejects tests, stories and barrels', () => {
    expect(isComponentFile('Foo.tsx')).toBe(true)
    expect(isComponentFile('Foo.test.tsx')).toBe(false)
    expect(isComponentFile('Foo.stories.tsx')).toBe(false)
    expect(isComponentFile('index.tsx')).toBe(false)
    expect(isComponentFile('use-foo.ts')).toBe(false)
  })
})

describe('listComponents', () => {
  it('walks nested directories and returns repo-relative paths', () => {
    const root = fixture([
      'src/components/Foo.tsx',
      'src/components/Foo.test.tsx',
      'src/components/deep/nested/Bar.tsx',
      'src/components/deep/index.tsx',
    ])
    expect(listComponents(root)).toEqual([
      'src/components/Foo.tsx',
      'src/components/deep/nested/Bar.tsx',
    ])
  })
})

describe('findViolations', () => {
  it('passes a component whose story differs only in case', () => {
    const root = fixture(['src/components/ui/Button.tsx', 'src/components/ui/button.stories.tsx'])
    expect(findViolations(root, [])).toEqual([])
  })

  it('does not accept a story from a different directory', () => {
    const root = fixture(['src/components/a/Foo.tsx', 'src/components/b/Foo.stories.tsx'])
    expect(findViolations(root, []).map((v) => v.path)).toEqual(['src/components/a/Foo.tsx'])
  })

  it('names the path and both fixes for a component with no story', () => {
    const root = fixture(['src/components/ZzzTest.tsx'])
    const [violation, ...rest] = findViolations(root, [])
    expect(rest).toEqual([])
    expect(violation?.message).toBe(
      'src/components/ZzzTest.tsx has no colocated story — add src/components/ZzzTest.stories.tsx ' +
        '(see .storybook/README.md) or allowlist it with a reason in scripts/check-colocated-stories.ts',
    )
  })

  it('passes an allowlisted component with no story', () => {
    const root = fixture(['src/components/Provider.tsx'])
    const allowlist = [{ path: 'src/components/Provider.tsx', why: 'No UI.' }]
    expect(findViolations(root, allowlist)).toEqual([])
  })

  it('fails an allowlist entry with an empty why', () => {
    const root = fixture(['src/components/Provider.tsx'])
    const violations = findViolations(root, [{ path: 'src/components/Provider.tsx', why: '  ' }])
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringContaining('src/components/Provider.tsx has no reason'),
    ])
  })

  it('fails an allowlist entry whose path no longer exists', () => {
    const root = fixture([])
    const violations = findViolations(root, [{ path: 'src/components/Gone.tsx', why: 'No UI.' }])
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringContaining('src/components/Gone.tsx no longer exists'),
    ])
  })

  it('fails an allowlist entry whose component now has a story', () => {
    const root = fixture(['src/components/Foo.tsx', 'src/components/foo.stories.tsx'])
    const violations = findViolations(root, [{ path: 'src/components/Foo.tsx', why: 'No UI.' }])
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringContaining('src/components/Foo.tsx now has a colocated story'),
    ])
  })
})

describe('the real tree', () => {
  it('has a story or an allowlisted reason for every component', () => {
    expect(checkTree(repoRoot).violations).toEqual([])
  })

  it('pairs ui/button.tsx with button.stories.tsx', () => {
    expect(listComponents(repoRoot)).toContain('src/components/ui/button.tsx')
    expect(fs.existsSync(path.join(repoRoot, 'src/components/ui/button.stories.tsx'))).toBe(true)
  })

  it('gives every allowlist entry a reason', () => {
    for (const entry of ALLOWLIST) expect(entry.why.trim(), entry.path).not.toBe('')
  })
})

describe('checkTree', () => {
  it('refuses to pass a tree too small to be this repo', () => {
    const root = fixture(['src/components/Foo.tsx', 'src/components/Foo.stories.tsx'])
    expect(() => checkTree(root)).toThrow(/holds 1 component\(s\)/)
  })
})

describe('CLI', () => {
  it('exits 0 on the real tree', () => {
    const { status, output } = run()
    expect(output).toMatch(/✓ src\/components: \d+ component\(s\)/)
    expect(status).toBe(0)
  }, 60_000)

  it('exits 1 and names the path when a component has no story', () => {
    const covered = Array.from({ length: MIN_PLAUSIBLE_COMPONENTS }, (_, i) => [
      `src/components/C${i}.tsx`,
      `src/components/C${i}.stories.tsx`,
    ]).flat()
    // The real allowlist applies to the CLI, so the fixture needs its paths too.
    const root = fixture([
      ...covered,
      ...ALLOWLIST.map((e) => e.path),
      'src/components/ZzzTest.tsx',
    ])
    const { status, output } = run(root)
    expect(output).toContain('src/components/ZzzTest.tsx has no colocated story')
    expect(status).toBe(1)
  }, 60_000)
})
