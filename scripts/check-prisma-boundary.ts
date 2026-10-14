/**
 * Persistence boundary gate (HON-1185)
 *
 * Route handlers, pages and components must not import `@/lib/prisma`: the
 * persistence they need lives in a `src/lib` module, so a test of the caller
 * mocks one lib function instead of the Prisma client, and the lib function can
 * be tested against a real database. On 2026-10-13, 40 files outside `src/lib`
 * still imported the client directly, and 94 test files mocked it to cope.
 *
 * HON-1189 and HON-1191 moved those 40 behind lib functions, and HON-1218
 * emptied `scripts/prisma-import-allowlist.txt`. This check keeps it that way:
 * every file outside `src/lib` that imports the client must be listed there,
 * and the list stays empty, so any such file fails.
 *
 * Imports are found with `ts.preProcessFile`, not a regex. A regex also matches
 * the text inside strings and comments — `typography.stories.tsx` shows
 * `import { prisma } from '@/lib/prisma'` as a code sample — and misses nothing
 * the scanner sees: `import type`, `export … from` and dynamic `import()`.
 *
 * Usage: pnpm prisma-boundary:check [repo-root] [allowlist]
 *   Both default to this repo, resolved from this file's own location. The
 *   arguments exist so the unit test can point the check at a fixture tree.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

// ============================================
// SCAN
// ============================================

/** The client module, repo-relative and without an extension. */
const PRISMA_MODULE = 'src/lib/prisma'

/** Repo-relative, `/`-separated — the form the allowlist and messages use. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Whether a repo-relative path is in scope: `.ts` / `.tsx` under `src/`,
 * outside `src/lib/`, and not a test. Stories are in scope — they are not
 * tests, and a story that imports the server-only client is a bug of its own.
 */
export function isScanned(relativePath: string): boolean {
  if (!relativePath.startsWith('src/') || relativePath.startsWith('src/lib/')) return false
  if (!/\.tsx?$/.test(relativePath)) return false
  return !/\.(test|spec)\.tsx?$/.test(relativePath)
}

/**
 * Whether a module specifier, written in the file at `relativePath`, names the
 * Prisma client module. Handles the `@/` alias and relative paths, with or
 * without an extension or an `/index` suffix.
 */
export function resolvesToPrisma(specifier: string, relativePath: string): boolean {
  let target: string
  if (specifier.startsWith('@/')) {
    target = `src/${specifier.slice(2)}`
  } else if (specifier.startsWith('.')) {
    target = path.posix.join(path.posix.dirname(relativePath), specifier)
  } else {
    return false
  }
  target = target.replace(/\.(ts|tsx|js)$/, '').replace(/\/index$/, '')
  return target === PRISMA_MODULE
}

/** Whether the source text imports the Prisma client, in any import form. */
export function importsPrisma(relativePath: string, text: string): boolean {
  const { importedFiles } = ts.preProcessFile(text, true, true)
  return importedFiles.some(({ fileName }) => resolvesToPrisma(fileName, relativePath))
}

/** Every in-scope file under `<root>/src`, repo-relative and sorted. */
export function listScannedFiles(root: string): string[] {
  const entries = readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => toPosix(path.relative(root, path.join(entry.parentPath, entry.name))))
    .filter(isScanned)
    .sort()
}

/** Allowlist paths, in file order. `#` comments and blank lines are ignored. */
export function parseAllowlist(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '')
}

export interface BoundaryResult {
  /** Files that import the client and are not in the allowlist. */
  violations: string[]
  /** Allowlist entries that no longer import the client, or no longer exist. */
  stale: string[]
  /** How many files the scan read. */
  scanned: number
}

/**
 * Smallest number of in-scope files a real checkout of this repo holds (533
 * on 2026-10-13). A wrong root, a sparse checkout or a broken walk reads
 * next to nothing, finds no importers, and would report every allowlist entry
 * as stale over a green exit. Refuse to pass on it instead. If the real tree
 * ever shrinks below this, lower the constant in the same commit.
 */
export const MIN_PLAUSIBLE_FILES = 200

export function checkBoundary(
  root: string,
  allowlist: string[],
  minFiles = MIN_PLAUSIBLE_FILES,
): BoundaryResult {
  const files = listScannedFiles(root)
  if (files.length < minFiles) {
    throw new Error(
      `${root} holds ${files.length} file(s) to scan under src/, expected at least ${minFiles}. ` +
        'Refusing to report the boundary as holding over a tree the scan cannot read.',
    )
  }

  const importers = new Set(
    files.filter((file) => importsPrisma(file, readFileSync(path.join(root, file), 'utf8'))),
  )
  const allowed = new Set(allowlist)

  return {
    violations: [...importers].filter((file) => !allowed.has(file)),
    stale: [...allowed].filter((entry) => !importers.has(entry)),
    scanned: files.length,
  }
}

// ============================================
// MAIN
// ============================================

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function main(): void {
  const root = path.resolve(process.argv[2] ?? repoRoot)
  const allowlistPath = path.resolve(
    process.argv[3] ?? path.join(root, 'scripts', 'prisma-import-allowlist.txt'),
  )
  const allowlist = parseAllowlist(readFileSync(allowlistPath, 'utf8'))
  const { violations, stale, scanned } = checkBoundary(root, allowlist)

  if (stale.length > 0) {
    console.warn(
      `\n⚠ ${stale.length} allowlist entr${stale.length === 1 ? 'y no longer imports' : 'ies no longer import'} @/lib/prisma. ` +
        'Remove the line(s) from scripts/prisma-import-allowlist.txt:\n',
    )
    for (const entry of stale) console.warn(`  - ${entry}`)
    console.warn('')
  }

  if (violations.length === 0) {
    // Say what was checked, so a green step proves the scan ran.
    console.log(
      `✓ ${scanned} file(s) scanned; ${allowlist.length - stale.length} allowlisted file(s) import @/lib/prisma, no others.`,
    )
    return
  }

  console.error(
    `\n✗ ${violations.length} file(s) outside src/lib import @/lib/prisma and are not allowlisted:\n`,
  )
  for (const file of violations) console.error(`  ✗ ${file}`)
  console.error(
    '\nRoute handlers, pages and components do not import the Prisma client. Put the\n' +
      'query in a src/lib module and call that function instead, so a test of this\n' +
      'file mocks one lib function rather than Prisma (CLAUDE.md → Database Patterns).\n' +
      'Do not add the file to scripts/prisma-import-allowlist.txt: that list only\n' +
      'shrinks. If you removed a line from it, the file above still imports the\n' +
      'client — move its persistence into src/lib first.\n',
  )
  process.exitCode = 1
}

// Guarded so the unit test can import the pure helpers without running the scan.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\ncheck-prisma-boundary failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
