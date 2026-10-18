/**
 * File size gate (HON-1241)
 *
 * A large file costs an agent context on every read, and an edit to it tends to
 * touch code the change is not about. This check caps agent-written code files
 * at 5,000 tokens, counted as bytes / 4 (no tokenizer dependency).
 *
 * On 2026-10-18, 93 tracked code files were over the limit. A hard cap would
 * block a three-line fix in any of them, so the gate is a ratchet:
 *
 * - A file not in `scripts/file-size-allowlist.txt` fails above 5,000 tokens.
 * - A listed file carries a cap, its size when listed. It may grow 5% over the
 *   cap, so a small fix never forces a split, and fails beyond that.
 * - Caps never rise. `--update` lowers a cap to the file's current size and
 *   drops a file that is back under the limit, so the headroom counts from the
 *   new, lower cap.
 *
 * Prettier runs in lint-staged before this check, so packing lines together
 * cannot pass it. Deleting comments can, so the error forbids it and
 * /branch-review looks for it.
 *
 * Usage:
 *   pnpm file-size:check [--staged | --update | --base <commit>] [repo-root] [allowlist]
 *   --staged  Judge only the staged files, by their index content (pre-commit).
 *   --update  Lower caps and drop entries back under the limit, then check.
 *   --base    Only compare the allowlist with <commit>: fail on a raised cap or
 *             a new entry that is not a rename (CI, pull requests).
 *   Both paths default to this repo, resolved from this file's own location.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ============================================
// RULES
// ============================================

export const TOKEN_LIMIT = 5000

/** How far a listed file may grow past its cap, as a fraction. */
export const HEADROOM = 0.05

const SCANNED_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sh|css)$/

/** Frozen SQL, seed data and codegen: nobody gains from splitting them. */
const EXCLUDED_PATHS = [
  /^prisma\/migrations\//,
  /^prisma\/seed[^/]*\.ts$/,
  /^src\/generated\//,
  /^public\//,
]

/**
 * Smallest number of in-scope files a real checkout of this repo holds (1,364
 * on 2026-10-18). A wrong root or a broken `git ls-files` reads next to
 * nothing and would pass green. Refuse to pass on it instead. If the real tree
 * ever shrinks below this, lower the constant in the same commit.
 */
export const MIN_PLAUSIBLE_FILES = 300

export function isScanned(relativePath: string): boolean {
  if (!SCANNED_EXTENSIONS.test(relativePath)) return false
  return !EXCLUDED_PATHS.some((pattern) => pattern.test(relativePath))
}

export function tokensOf(bytes: number): number {
  return Math.ceil(bytes / 4)
}

/** The most tokens a file may hold: the limit, or its cap plus headroom. */
export function allowedTokens(cap: number | undefined): number {
  if (cap === undefined) return TOKEN_LIMIT
  return Math.max(TOKEN_LIMIT, Math.ceil(cap * (1 + HEADROOM)))
}

// ============================================
// ALLOWLIST
// ============================================

/** `<maxTokens> <path>` per line. `#` comments and blank lines are ignored. */
export function parseAllowlist(text: string): Map<string, number> {
  const caps = new Map<string, number>()
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/#.*/, '').trim()
    if (line === '') return
    const [, cap, file] = /^(\d+)\s+(\S+)$/.exec(line) ?? []
    if (cap === undefined || file === undefined) {
      throw new Error(`allowlist line ${index + 1} is not "<maxTokens> <path>": ${raw}`)
    }
    caps.set(file, Number(cap))
  })
  return caps
}

/** The header: every leading line that is a comment or blank. */
function allowlistHeader(text: string): string {
  const lines = text.split('\n')
  const end = lines.findIndex((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  return lines
    .slice(0, end === -1 ? lines.length : end)
    .join('\n')
    .trimEnd()
}

export function formatAllowlist(header: string, caps: Map<string, number>): string {
  const entries = [...caps.entries()].sort(([a], [b]) => a.localeCompare(b))
  const body = entries.map(([file, cap]) => `${cap} ${file}`).join('\n')
  return `${header}\n\n${body}\n`
}

/**
 * Lower each cap to its file's current size and drop entries that are deleted
 * or back under the limit. Never raises a cap and never adds a file.
 */
export function lowerCaps(
  caps: Map<string, number>,
  sizes: Map<string, number>,
): Map<string, number> {
  const lowered = new Map<string, number>()
  for (const [file, cap] of caps) {
    const tokens = sizes.get(file)
    if (tokens === undefined || tokens <= TOKEN_LIMIT) continue
    lowered.set(file, Math.min(cap, tokens))
  }
  return lowered
}

// ============================================
// EVALUATE
// ============================================

export interface Oversize {
  file: string
  tokens: number
  allowed: number
  /** Set when the file is listed. */
  cap?: number
}

export interface SizeResult {
  /** Files over what they may hold. */
  failures: Oversize[]
  /** Listed files now under their cap; `--update` lowers it. */
  shrunk: { file: string; tokens: number; cap: number }[]
  /** Listed files that are deleted or back under the limit. */
  stale: string[]
}

/**
 * Judge each measured file. `sizes` maps a repo-relative path to tokens. With
 * `partial`, `sizes` holds only some files (the staged ones), so a listed file
 * missing from it is not stale.
 */
export function evaluate(
  sizes: Map<string, number>,
  caps: Map<string, number>,
  partial = false,
): SizeResult {
  const failures: Oversize[] = []
  const shrunk: SizeResult['shrunk'] = []
  for (const [file, tokens] of sizes) {
    const cap = caps.get(file)
    const allowed = allowedTokens(cap)
    if (tokens > allowed) failures.push({ file, tokens, allowed, cap })
    else if (cap !== undefined && tokens > TOKEN_LIMIT && tokens < cap) {
      shrunk.push({ file, tokens, cap })
    }
  }
  const stale = [...caps.keys()].filter((file) => {
    const tokens = sizes.get(file)
    return tokens === undefined ? !partial : tokens <= TOKEN_LIMIT
  })
  return { failures, shrunk, stale }
}

// ============================================
// MEASURE
// ============================================

function git(root: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    // Capture stderr: it goes into the thrown error, not onto the console.
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Tracked in-scope files, measured in the working tree. */
export function measureTree(root: string): Map<string, number> {
  const files = git(root, ['ls-files', '-z']).split('\0').filter(isScanned)
  const sizes = new Map<string, number>()
  for (const file of files) {
    // A tracked file deleted but not yet staged is gone from disk; skip it.
    try {
      sizes.set(file, tokensOf(statSync(path.join(root, file)).size))
    } catch {
      continue
    }
  }
  return sizes
}

/** Staged in-scope files (added, copied, modified, renamed), measured in the index. */
export function measureStaged(root: string): Map<string, number> {
  const files = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(isScanned)
  const sizes = new Map<string, number>()
  if (files.length === 0) return sizes
  // One `cat-file` for every blob; each output line is `<sha> <type> <bytes>`.
  const output = git(
    root,
    ['cat-file', '--batch-check'],
    files.map((file) => `:${file}\n`).join(''),
  )
  output
    .trimEnd()
    .split('\n')
    .forEach((line, index) => {
      const file = files[index]
      const bytes = Number(line.split(' ')[2])
      if (file !== undefined && Number.isFinite(bytes)) sizes.set(file, tokensOf(bytes))
    })
  return sizes
}

/**
 * Renames in a diff, new path → old path. `range` is `['--cached']` for the
 * staged changes or `[base, 'HEAD']` for a branch. A renamed listed file is
 * unlisted under its new path, so the error points at the allowlist line to
 * move, and `--base` accepts the moved line.
 */
export function renamesIn(root: string, range: string[]): Map<string, string> {
  // `--name-status -z` prints `R<score>\0<old>\0<new>\0` per rename.
  const fields = git(root, ['diff', ...range, '--name-status', '-M', '--diff-filter=R', '-z'])
    .split('\0')
    .filter((field) => field !== '')
  const renames = new Map<string, string>()
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const from = fields[i + 1]
    const to = fields[i + 2]
    if (from !== undefined && to !== undefined) renames.set(to, from)
  }
  return renames
}

// ============================================
// BASE COMPARISON
// ============================================

/**
 * The check reads caps from the branch's own allowlist, so on its own it
 * cannot see a branch that raises a cap or lists a new file. This compares the
 * allowlist with the base: every entry must exist there at the same or a
 * higher cap, or be a rename of an entry that does, at no higher a cap.
 * Returns one line per violation.
 */
export function allowlistGrowth(
  baseCaps: Map<string, number>,
  headCaps: Map<string, number>,
  renames: Map<string, string>,
): string[] {
  const violations: string[] = []
  for (const [file, cap] of headCaps) {
    const baseCap = baseCaps.get(file)
    if (baseCap !== undefined) {
      if (cap > baseCap) violations.push(`${file}: cap raised from ${baseCap} to ${cap}`)
      continue
    }
    const from = renames.get(file)
    const fromCap = from === undefined ? undefined : baseCaps.get(from)
    if (from === undefined || fromCap === undefined) {
      violations.push(`${file}: new entry at cap ${cap}`)
    } else if (cap > fromCap) {
      violations.push(`${file}: renamed from ${from}, cap raised from ${fromCap} to ${cap}`)
    }
  }
  return violations
}

function checkAgainstBase(root: string, allowlistPath: string, base: string): void {
  const relative = path.relative(root, allowlistPath).split(path.sep).join('/')
  let baseText: string
  try {
    baseText = git(root, ['show', `${base}:${relative}`])
  } catch {
    // The PR that introduces the allowlist has nothing to compare with.
    console.log(`✓ ${relative} does not exist at ${base}; nothing to compare.`)
    return
  }
  const violations = allowlistGrowth(
    parseAllowlist(baseText),
    parseAllowlist(readFileSync(allowlistPath, 'utf8')),
    renamesIn(root, [base, 'HEAD']),
  )
  if (violations.length === 0) {
    console.log(`✓ ${relative} only shrank against ${base}.`)
    return
  }
  console.error(`\n✗ ${relative} grew against ${base}:\n`)
  for (const violation of violations) console.error(`  ✗ ${violation}`)
  console.error(
    '\nThe allowlist only shrinks. Restore the base cap and split the file instead\n' +
      '(run `pnpm file-size:check` for split advice). A renamed listed file may move\n' +
      'its line to the new path, at no higher a cap.\n',
  )
  process.exitCode = 1
}

// ============================================
// MESSAGES
// ============================================

/** How to split a file, by what kind of file it is. */
export function splitAdvice(file: string): string {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    return (
      'Split the tests: one file per top-level `describe`, named `<Source>.<topic>.test.ts(x)`, ' +
      'next to the source. Move shared setup and fixtures into a colocated `<Source>.fixtures.ts`.'
    )
  }
  if (file.endsWith('.stories.tsx')) {
    return (
      'Split the stories: one file per scenario group, with a distinct `title` for each. ' +
      'Move shared args and mock data into a colocated `<Component>.fixtures.ts`.'
    )
  }
  if (file.endsWith('.sh')) {
    return 'Move groups of functions into a sourced `scripts/lib/<name>.sh`, one file per responsibility.'
  }
  if (file.endsWith('.css')) {
    return 'Move a group of rules into its own stylesheet and import it from this one.'
  }
  if (file.endsWith('.tsx')) {
    return (
      'Move sub-components, with the hooks and helpers only they use, into sibling files in the ' +
      'same folder. A new component under `src/components` gets its own colocated story.'
    )
  }
  return (
    'Split by responsibility: one module per concern, next to this one. Callers import the new ' +
    'module directly; keep a re-export here only if many callers depend on this path.'
  )
}

function describeLimit({ allowed, cap }: Oversize): string {
  return cap === undefined
    ? `limit ${TOKEN_LIMIT}`
    : `cap ${cap} + ${HEADROOM * 100}% headroom = ${allowed}`
}

// ============================================
// MAIN
// ============================================

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function main(): void {
  const args = process.argv.slice(2)
  const staged = args.includes('--staged')
  const update = args.includes('--update')
  const baseIndex = args.indexOf('--base')
  const base = baseIndex === -1 ? undefined : args[baseIndex + 1]
  if (baseIndex !== -1 && (base === undefined || base.startsWith('--'))) {
    throw new Error('--base needs a commit, for example --base "$BASE_SHA".')
  }
  const positional = args.filter(
    (arg, i) => !arg.startsWith('--') && (baseIndex === -1 || i !== baseIndex + 1),
  )
  const root = path.resolve(positional[0] ?? repoRoot)
  const allowlistPath = path.resolve(
    positional[1] ?? path.join(root, 'scripts', 'file-size-allowlist.txt'),
  )
  if (base !== undefined) {
    checkAgainstBase(root, allowlistPath, base)
    return
  }
  const allowlistText = readFileSync(allowlistPath, 'utf8')
  let caps = parseAllowlist(allowlistText)

  const sizes = staged ? measureStaged(root) : measureTree(root)
  if (!staged && sizes.size < MIN_PLAUSIBLE_FILES) {
    throw new Error(
      `${root} holds ${sizes.size} tracked file(s) to scan, expected at least ${MIN_PLAUSIBLE_FILES}. ` +
        'Refusing to pass over a tree the scan cannot read.',
    )
  }

  if (update) {
    if (staged) throw new Error('--update needs the whole tree; run it without --staged.')
    caps = lowerCaps(caps, sizes)
    writeFileSync(allowlistPath, formatAllowlist(allowlistHeader(allowlistText), caps))
    console.log(`✓ Allowlist rewritten: ${caps.size} file(s) over ${TOKEN_LIMIT} tokens remain.`)
  }

  const { failures, shrunk, stale } = evaluate(sizes, caps, staged)
  const renames =
    staged && failures.length > 0 ? renamesIn(root, ['--cached']) : new Map<string, string>()

  if (shrunk.length > 0 || stale.length > 0) {
    console.warn(
      `\n⚠ ${shrunk.length + stale.length} allowlist entr${shrunk.length + stale.length === 1 ? 'y is' : 'ies are'} ` +
        'above the file now. Run `pnpm file-size:check --update` and commit the allowlist:\n',
    )
    for (const { file, tokens, cap } of shrunk)
      console.warn(`  - ${file}: ${tokens} tokens, cap ${cap}`)
    for (const file of stale) console.warn(`  - ${file}: deleted or under ${TOKEN_LIMIT} tokens`)
    console.warn('')
  }

  if (failures.length === 0) {
    // Say what was checked, so a green step proves the scan ran.
    console.log(
      `✓ ${sizes.size} ${staged ? 'staged ' : ''}file(s) scanned; none over ${TOKEN_LIMIT} tokens ` +
        `(bytes / 4) or over its allowlist cap.`,
    )
    return
  }

  console.error(`\n✗ ${failures.length} file(s) too large (tokens = bytes / 4):\n`)
  for (const failure of failures) {
    console.error(`  ✗ ${failure.file}: ${failure.tokens} tokens, ${describeLimit(failure)}`)
    const from = renames.get(failure.file)
    const fromCap = from === undefined ? undefined : caps.get(from)
    if (from !== undefined && fromCap !== undefined) {
      console.error(
        `    Renamed from ${from}, which is listed at cap ${fromCap}. Change that line in\n` +
          `    scripts/file-size-allowlist.txt to "${fromCap} ${failure.file}" and stage it.\n`,
      )
      continue
    }
    console.error(`    ${splitAdvice(failure.file)}\n`)
  }
  console.error(
    'Split the file by responsibility, so each part is one thing an agent can read whole.\n' +
      'Do not delete comments, shorten names or compress code to pass: that hides the size\n' +
      'and loses the reasons the comments hold. Do not add the file to, or raise a cap in,\n' +
      'scripts/file-size-allowlist.txt: that list only shrinks. A renamed listed file is the\n' +
      'one exception: move its line to the new path and keep the cap.\n',
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
      `\ncheck-file-size failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
