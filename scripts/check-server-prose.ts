/**
 * Server-prose guard (HON-915).
 *
 * Fails when a component hands a caught error's `.message` to a toast or to
 * error state. CLAUDE.md → Localization: a route's `error` string is English
 * and `apiFetch` puts it into `ApiError.message`, so `toast.error(err.message)`
 * shows English to an Estonian household. The pattern recurred in HON-700,
 * HON-725, HON-888 and HON-914 before this check existed.
 *
 * What is flagged — deliberately narrow, so a hit is almost always real:
 *
 * - A call to `toast(…)`, `toast.<method>(…)`, `setError(…)` or
 *   `set<Something>Error(…)`,
 * - one of whose arguments reads `<x>.message` (or `<x>?.message`), where `<x>`
 *   is named `e`, `err`, `error`, or ends in `Err` / `Error` (`_err`,
 *   `mutation.error`, `saveError`),
 * - and that read is not inside another call or a function in the argument.
 *   `toast.error(friendlyError(err.message))` is not flagged: the mapper owns
 *   the mapping to catalog copy. `err instanceof Error ? err.message : t('x')`
 *   and `` `Failed: ${err.message}` `` are. A callback argument is not walked
 *   either, so `toast.promise(p, { error: (e) => e.message })` would pass; no
 *   `toast.promise` exists in `src/` today.
 *
 * It walks the TypeScript AST rather than matching lines, so a call split
 * across lines is caught and a comment that quotes the pattern is not.
 *
 * Fixing a hit: log the server string, then render catalog copy chosen by
 * `ApiError.status` / `code` / `body` (`src/components/recipes/ImagineReviewDialog.tsx`).
 * There is no allowlist; a false positive is fixed by restructuring the line.
 *
 * Usage: `pnpm i18n:prose-check [repoRoot]`. `scripts/check-server-prose.test.ts`
 * runs the same scan under `pnpm test`, which is what CI relies on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SOURCE_DIR = 'src'

/**
 * Directories under `src/` that are out of scope, each with its reason. This is
 * a scope boundary, not an allowlist of offenders: nothing here is shown to a
 * household.
 */
export const EXCLUDED_DIRS: { path: string; why: string }[] = [
  {
    path: 'src/app/admin',
    why: 'Operator console behind the admin gate. It has no catalog and is English by design, and the route errors it toasts are written for the operator.',
  },
  {
    path: 'src/generated',
    why: 'Generated Prisma client, not app code.',
  },
]

export interface Violation {
  /** Repo-relative path with forward slashes. */
  file: string
  line: number
  /** The offending call, collapsed to one line. */
  snippet: string
}

const ERROR_NAME = /^_?(?:e|err|error)$|(?:Err|Error)$/

/** `toast`, `toast.<method>`, `setError`, `set<Something>Error`. */
function isSinkCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) {
    return callee.text === 'toast' || /^set(?:[A-Z]\w*)?Error$/.test(callee.text)
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'toast'
  )
}

/** The trailing name of `err`, `ctx.error`, `mutation.error`, else undefined. */
function trailingName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isParenthesizedExpression(expression)) return trailingName(expression.expression)
  if (ts.isNonNullExpression(expression)) return trailingName(expression.expression)
  if (ts.isAsExpression(expression)) return trailingName(expression.expression)
  return undefined
}

/**
 * Whether `node` reads an error's `.message` outside any nested call or
 * function — i.e. whether that string can reach the sink unmapped.
 */
function readsErrorMessage(node: ts.Node): boolean {
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isFunctionLike(node)) {
    return false
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'message') {
    const owner = trailingName(node.expression)
    if (owner !== undefined && ERROR_NAME.test(owner)) return true
  }
  return ts.forEachChild(node, (child) => (readsErrorMessage(child) ? true : undefined)) ?? false
}

/** Violations in one file's source text. `file` is only used for reporting. */
export function findViolations(file: string, source: string): Violation[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const violations: Violation[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isSinkCallee(node.expression) &&
      node.arguments.some(readsErrorMessage)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push({
        file,
        line: line + 1,
        snippet: node.getText(sourceFile).replace(/\s+/g, ' '),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations
}

/** Whether a repo-relative path is app source the guard should read. */
export function isScannedFile(relativePath: string): boolean {
  if (!/\.tsx?$/.test(relativePath) || relativePath.endsWith('.d.ts')) return false
  if (/\.(test|spec|stories)\.tsx?$/.test(relativePath)) return false
  return !EXCLUDED_DIRS.some(
    (dir) => relativePath === dir.path || relativePath.startsWith(`${dir.path}/`),
  )
}

/** Repo-relative paths of every scanned file under `src/`, sorted. */
export function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(absolute)
      } else if (isScannedFile(relative)) {
        files.push(relative)
      }
    }
  }
  walk(path.join(repoRoot, SOURCE_DIR))
  return files.sort()
}

export function checkTree(repoRoot: string): { count: number; violations: Violation[] } {
  const files = listSourceFiles(repoRoot)
  const violations = files.flatMap((file) =>
    findViolations(file, fs.readFileSync(path.join(repoRoot, file), 'utf8')),
  )
  return { count: files.length, violations }
}

function main(): void {
  const repoRoot = path.resolve(process.argv[2] ?? defaultRepoRoot)
  const { count, violations } = checkTree(repoRoot)

  if (violations.length === 0) {
    // Say what was checked, so a green run proves the scan ran.
    console.log(`✓ ${SOURCE_DIR}: ${count} file(s) render no caught error's .message`)
    return
  }

  console.error(`\n✗ ${violations.length} call(s) render a caught error's .message\n`)
  for (const violation of violations) {
    console.error(`  ✗ ${violation.file}:${violation.line}  ${violation.snippet}`)
  }
  console.error(
    '\nCLAUDE.md → Localization: do not render server error text. Log the server\n' +
      'string and render catalog copy chosen by ApiError.status / code / body\n' +
      '(pattern: src/components/recipes/ImagineReviewDialog.tsx).\n',
  )
  process.exitCode = 1
}

// Guarded so the unit test can import the helpers without running the scan.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\ncheck-server-prose failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
