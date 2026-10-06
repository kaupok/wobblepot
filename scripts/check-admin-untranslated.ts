/**
 * Admin-untranslated guard (HON-1093).
 *
 * The admin pages are an English operator console for one person, so they do
 * not go through the catalogs (docs/LOCALIZATION.md → Decided principles).
 * Agents follow the general rule "UI strings come from the catalogs", so
 * without this check each new admin page gets catalog keys and Estonian copy
 * that nobody reads.
 *
 * What is flagged:
 *
 * - In an admin file (`ADMIN_PATHS`, tests and stories excluded): an import or
 *   re-export from `next-intl` or `next-intl/<subpath>`, a dynamic
 *   `import('next-intl…')`, or a call to `useEnumLabel`.
 * - In `messages/en.json` and `messages/et.json`: a key named `admin` at any
 *   depth.
 *
 * It walks the TypeScript AST rather than matching lines, so a comment or a
 * string that quotes an import is not flagged.
 *
 * What stays translated, and is not scanned: the shared 404 a non-admin gets
 * from `/admin`, the app chrome around admin pages, and emails that admin
 * actions send to users.
 *
 * Usage: `pnpm i18n:admin-check [repoRoot]`. `scripts/check-admin-untranslated.test.ts`
 * runs the same scan under `pnpm test`, which is what CI relies on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The admin surface: directories (with a trailing slash) and single files. */
export const ADMIN_PATHS = ['src/app/admin/', 'src/app/api/admin/', 'src/lib/admin-links.ts']

export const CATALOGS = ['messages/en.json', 'messages/et.json']

export const RULE =
  'Admin pages are English-only: write the string inline, not through the catalogs ' +
  '(docs/LOCALIZATION.md → Decided principles → Admin pages are English-only).'

export interface Violation {
  /** Repo-relative path with forward slashes. */
  file: string
  line: number
  /** What was found, collapsed to one line. */
  snippet: string
}

const isNextIntl = (specifier: string) =>
  specifier === 'next-intl' || specifier.startsWith('next-intl/')

/** Violations in one admin file's source text. `file` is only used for reporting. */
export function findSourceViolations(file: string, source: string): Violation[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const violations: Violation[] = []

  const report = (node: ts.Node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file,
      line: line + 1,
      snippet: node.getText(sourceFile).replace(/\s+/g, ' '),
    })
  }

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isNextIntl(node.moduleSpecifier.text)
    ) {
      report(node)
    } else if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments
      const isNextIntlImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        firstArgument !== undefined &&
        ts.isStringLiteralLike(firstArgument) &&
        isNextIntl(firstArgument.text)
      const isEnumLabel =
        ts.isIdentifier(node.expression) && node.expression.text === 'useEnumLabel'
      if (isNextIntlImport || isEnumLabel) report(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations
}

/** Every key named `admin` in a catalog's JSON text, at any depth. */
export function findCatalogViolations(file: string, json: string): Violation[] {
  const sourceFile = ts.parseJsonText(file, json)
  const violations: Violation[] = []

  const visit = (node: ts.Node, keyPath: string[]): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue
        const childPath = [...keyPath, property.name.text]
        if (property.name.text === 'admin') {
          const start = property.name.getStart(sourceFile)
          const { line } = sourceFile.getLineAndCharacterOfPosition(start)
          violations.push({ file, line: line + 1, snippet: `key ${childPath.join('.')}` })
        }
        visit(property.initializer, childPath)
      }
    }
  }
  for (const statement of sourceFile.statements) visit(statement.expression, [])

  return violations
}

/** Whether a repo-relative path is admin source the guard should read. */
export function isScannedFile(relativePath: string): boolean {
  if (!/\.tsx?$/.test(relativePath) || relativePath.endsWith('.d.ts')) return false
  if (/\.(test|spec|stories)\.tsx?$/.test(relativePath)) return false
  return ADMIN_PATHS.some((admin) =>
    admin.endsWith('/') ? relativePath.startsWith(admin) : relativePath === admin,
  )
}

/** Repo-relative paths of every scanned admin file, sorted. */
export function listAdminFiles(repoRoot: string): string[] {
  const files: string[] = []
  const walk = (absolute: string): void => {
    if (!fs.existsSync(absolute)) return
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
    if (fs.statSync(absolute).isDirectory()) {
      for (const entry of fs.readdirSync(absolute)) walk(path.join(absolute, entry))
    } else if (isScannedFile(relative)) {
      files.push(relative)
    }
  }
  for (const admin of ADMIN_PATHS) walk(path.join(repoRoot, admin))
  return files.sort()
}

export function checkTree(repoRoot: string): { count: number; violations: Violation[] } {
  const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
  const files = listAdminFiles(repoRoot)
  const violations = [
    ...files.flatMap((file) => findSourceViolations(file, read(file))),
    ...CATALOGS.flatMap((file) => findCatalogViolations(file, read(file))),
  ]
  return { count: files.length, violations }
}

function main(): void {
  const repoRoot = path.resolve(process.argv[2] ?? defaultRepoRoot)
  const { count, violations } = checkTree(repoRoot)

  if (violations.length === 0) {
    // Say what was checked, so a green run proves the scan ran.
    console.log(
      `✓ ${count} admin file(s) and ${CATALOGS.length} catalog(s) carry no admin translation`,
    )
    return
  }

  console.error(`\n✗ ${violations.length} admin translation(s)\n`)
  for (const violation of violations) {
    console.error(`  ✗ ${violation.file}:${violation.line}  ${violation.snippet}`)
  }
  console.error(`\n${RULE}\n`)
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
      `\ncheck-admin-untranslated failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
