import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkBoundary,
  importsPrisma,
  isScanned,
  parseAllowlist,
  resolvesToPrisma,
} from './check-prisma-boundary'

/**
 * The gate is green on `main` by design, so these tests exist to prove it
 * fires: on a new importer, and on an allowlist line removed while its file
 * still imports the client.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'check-prisma-boundary.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

/** Run the script exactly as `pnpm prisma-boundary:check` does. */
function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync(tsx, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repoRoot,
  })
  // A missing tsx binary or a timeout leaves `status` null, which would satisfy
  // an "exits non-zero" assertion for the wrong reason. Fail on it here.
  expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
  expect(result.status, 'process did not exit normally').not.toBeNull()
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('isScanned', () => {
  it.each([
    ['src/app/api/meals/route.ts', true],
    ['src/app/admin/page.tsx', true],
    ['src/components/ui/typography.stories.tsx', true],
    ['src/lib/meal-plans.ts', false],
    ['src/lib/prisma.ts', false],
    ['src/app/api/meals/route.test.ts', false],
    ['src/components/Foo.test.tsx', false],
    ['src/app/foo.spec.ts', false],
    ['src/app/styles.css', false],
    ['scripts/seed.ts', false],
  ])('%s → %s', (file, expected) => {
    expect(isScanned(file)).toBe(expected)
  })
})

describe('resolvesToPrisma', () => {
  it.each([
    ['@/lib/prisma', 'src/app/api/x/route.ts', true],
    ['@/lib/prisma.ts', 'src/app/api/x/route.ts', true],
    ['../../../lib/prisma', 'src/app/api/x/route.ts', true],
    ['../lib/prisma/index', 'src/app/page.tsx', true],
    ['@/lib/prisma-errors', 'src/app/api/x/route.ts', false],
    ['@/lib/prisma/extensions', 'src/app/api/x/route.ts', false],
    ['@/generated/prisma/client', 'src/app/api/x/route.ts', false],
    ['@prisma/client', 'src/app/api/x/route.ts', false],
    ['./prisma', 'src/app/api/x/route.ts', false],
  ])('%s from %s → %s', (specifier, file, expected) => {
    expect(resolvesToPrisma(specifier, file)).toBe(expected)
  })
})

describe('importsPrisma', () => {
  const file = 'src/app/api/x/route.ts'

  it.each([
    ["import { prisma } from '@/lib/prisma'", 'a named import'],
    ['import { prisma } from "@/lib/prisma"', 'double quotes'],
    ["import type { PrismaTx } from '@/lib/prisma'", 'a type-only import'],
    ["export { prisma } from '@/lib/prisma'", 'a re-export'],
    ["const { prisma } = await import('@/lib/prisma')", 'a dynamic import'],
    ["import '@/lib/prisma'", 'a side-effect import'],
    ["import { prisma } from '../../../lib/prisma'", 'a relative path'],
  ])('matches %s (%s)', (source) => {
    expect(importsPrisma(file, source)).toBe(true)
  })

  it.each([
    ["const sample = `import { prisma } from '@/lib/prisma'`", 'a template literal'],
    ["// import { prisma } from '@/lib/prisma'", 'a line comment'],
    ["/* import { prisma } from '@/lib/prisma' */", 'a block comment'],
    ["import { mapPrismaError } from '@/lib/prisma-errors'", 'a lookalike module'],
    ["import { getMeals } from '@/lib/meals'", 'a lib function'],
  ])('ignores %s (%s)', (source) => {
    expect(importsPrisma(file, source)).toBe(false)
  })
})

describe('parseAllowlist', () => {
  it('drops comments and blank lines and trims entries', () => {
    const text = '# header\n\nsrc/a.ts\n  src/b.ts  # trailing note\n# src/c.ts\n'
    expect(parseAllowlist(text)).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('the check on a fixture tree', () => {
  let root: string
  let allowlistPath: string

  function write(relativePath: string, contents: string): void {
    const file = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-boundary-'))
    allowlistPath = path.join(root, 'allowlist.txt')
    // Enough unrelated files to clear MIN_PLAUSIBLE_FILES, as a real tree does.
    for (let i = 0; i < 200; i++) {
      write(`src/components/filler/Filler${i}.tsx`, 'export const x = 1\n')
    }
    write('src/lib/prisma.ts', 'export const prisma = {}\n')
    write('src/lib/meals.ts', "import { prisma } from '@/lib/prisma'\n")
    write('src/app/api/old/route.ts', "import { prisma } from '@/lib/prisma'\n")
    write('src/app/api/old/route.test.ts', "vi.mock('@/lib/prisma')\n")
    fs.writeFileSync(allowlistPath, '# header\nsrc/app/api/old/route.ts\n')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('passes when every importer outside src/lib is allowlisted', () => {
    const { status, output } = run(root, allowlistPath)
    expect(status, output).toBe(0)
    expect(output).toContain('1 allowlisted file(s) import @/lib/prisma')
  })

  it('fails on a new route that imports the client, and names the file', () => {
    write('src/app/api/new-thing/route.ts', "import { prisma } from '@/lib/prisma'\n")
    const { status, output } = run(root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('✗ src/app/api/new-thing/route.ts')
    expect(output).not.toContain('✗ src/app/api/old/route.ts')
  })

  it('fails when an allowlist line is removed while its file still imports the client', () => {
    fs.writeFileSync(allowlistPath, '# header\n')
    const { status, output } = run(root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('✗ src/app/api/old/route.ts')
  })

  it('warns, without failing, on an entry that no longer imports the client', () => {
    write('src/app/api/old/route.ts', "import { getMeals } from '@/lib/meals'\n")
    fs.writeFileSync(allowlistPath, 'src/app/api/old/route.ts\nsrc/app/api/deleted/route.ts\n')
    const { status, output } = run(root, allowlistPath)
    expect(status, output).toBe(0)
    expect(output).toContain('2 allowlist entries no longer import @/lib/prisma')
    expect(output).toContain('- src/app/api/old/route.ts')
    expect(output).toContain('- src/app/api/deleted/route.ts')
  })

  it('refuses to pass on a tree too small to be this repo', () => {
    expect(() => checkBoundary(root, [], 10_000)).toThrow(/Refusing to report/)
  })
})

describe('the real repository', () => {
  // Stale entries are not asserted: the check only warns on them, so a test
  // that failed would be stricter than the gate it covers.
  it('holds the boundary', () => {
    const allowlist = parseAllowlist(
      fs.readFileSync(path.join(scriptsDir, 'prisma-import-allowlist.txt'), 'utf8'),
    )
    expect(checkBoundary(repoRoot, allowlist).violations).toEqual([])
  })
})
