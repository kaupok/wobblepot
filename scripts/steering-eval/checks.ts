/**
 * The mechanical checks of the steering eval (HON-1345, docs/STEERING_EVAL.md).
 *
 *   tsx scripts/steering-eval/checks.ts <check> <worktree> <stream.jsonl> <diff.patch>
 *
 * Each check reads the run's diff and prints `PASS` or `FAIL` as its last line,
 * with the reason for a FAIL on stderr. A check judges added lines in `src/`
 * only, because the tasks are features in `src/`. Where a check needs a whole
 * file (a modified file has only its changed lines in the patch), it reads the
 * file from the worktree and falls back to the added lines.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface FileDiff {
  path: string
  added: string[]
}

export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | undefined
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(line)
    if (header) {
      current = { path: header[1] ?? '', added: [] }
      files.push(current)
    } else if (current && line.startsWith('+') && !line.startsWith('+++ ')) {
      current.added.push(line.slice(1))
    }
  }
  return files
}

/** Source the task asked for: `src/` code, not its tests or stories. */
function isSource(file: string): boolean {
  return file.startsWith('src/') && /\.tsx?$/.test(file) && !/\.(test|stories)\.tsx?$/.test(file)
}

function fullText(worktree: string, file: FileDiff): string {
  const onDisk = path.join(worktree, file.path)
  return fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : file.added.join('\n')
}

function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line) || /\{\s*\/\*/.test(line)
}

/** A check returns the reasons it fails; none is a PASS. */
type Check = (files: FileDiff[], worktree: string) => string[]

const TYPE_GUARDS = [
  /(?<!JSON|Date)\.(safeParse|parse|parseAsync|safeParseAsync)\(/,
  /typeof\s+[\w.$?[\]'"]+\s*[!=]==?\s*['"](string|number|boolean|bigint|object)['"]/,
  /\bNumber\.is(Finite|NaN|Integer|SafeInteger)\(/,
  /(?<![.\w])is(NaN|Finite)\(/,
  /\bArray\.isArray\(/,
  // A range check the route's schema already made: `if (factor <= 0) throw`.
  /\bif\s*\(.*[\w.\]]\s*(<=?|>=?)\s*0\b.*\)\s*(\{|throw|return)/,
  /\bif\s*\(.*[\w.\]]\s*(<=?|>=?)\s*0\b[^)]*\)\s*$/,
]

// `.claude/rules/code.md` bullet 1: the route owns the body check, so a lib
// function or component that checks the typed value again fails.
const validateOnce: Check = (files) =>
  files
    .filter((f) => isSource(f.path))
    .filter((f) => !/^src\/app\/.*\/route\.ts$/.test(f.path) && f.path !== 'src/lib/env.ts')
    .flatMap((f) =>
      f.added
        .filter((line) => !isComment(line) && TYPE_GUARDS.some((re) => re.test(line)))
        .map((line) => `${f.path}: second check of a typed value: ${line.trim()}`),
    )

const TOP_LEVEL_FUNCTION = [
  /^(?:async\s+)?function\s+([a-z_$][\w$]*)\s*[<(]/,
  /^const\s+([a-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/,
]

// `.claude/rules/code.md` bullet 2: a new module-level helper that is not
// exported and has exactly one caller fails. Handlers inside a component are
// indented, so they are not module-level and do not count.
const inlineSingleUse: Check = (files, worktree) =>
  files
    .filter((f) => isSource(f.path))
    .flatMap((f) => {
      const text = fullText(worktree, f)
      return f.added.flatMap((line) => {
        const name = TOP_LEVEL_FUNCTION.map((re) => re.exec(line)?.[1]).find(Boolean)
        if (!name) return []
        const uses = text.split(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`)).length - 2
        return uses === 1 ? [`${f.path}: helper with one caller: ${name}`] : []
      })
    })

const SPECULATIVE_COMMENT =
  /\b(race|races|racing|concurrent(ly)?|just in case|defensive(ly)?|should never|never happen|can'?t happen|cannot happen|unreachable|paranoi\w*)\b/i

const SPECULATIVE_CODE = [
  /typeof\s+(window|navigator|document|globalThis)\s*[!=]==?\s*['"]undefined['"]/,
  /!\s*navigator\.clipboard\b/,
  /navigator(\.clipboard)?\s*\?\./,
  /['"]clipboard['"]\s+in\s+navigator/,
  /\bif\s*\(\s*!\s*(window|document|navigator)\s*\)/,
]

// CLAUDE.md → Working style, "Ask before you guard against an unlikely case":
// a check for a missing browser API in a client handler, or a comment that
// names a theoretical race or an impossible path, fails.
const guardUnlikely: Check = (files) =>
  files
    .filter((f) => isSource(f.path))
    .flatMap((f) =>
      f.added
        .filter((line) =>
          isComment(line)
            ? SPECULATIVE_COMMENT.test(line)
            : SPECULATIVE_CODE.some((re) => re.test(line)),
        )
        .map((line) => `${f.path}: speculative guard: ${line.trim()}`),
    )

// CLAUDE.md → Architecture Overview, "Server Components by default": a file
// that gains "use client" but calls no hook, sets no event handler and touches
// no browser API fails. next-intl's hooks run in Server Components, so they do
// not count as a reason for "use client".
const CLIENT_HOOK =
  /\buse(?!Translations\b|Locale\b|Formatter\b|Now\b|TimeZone\b|Messages\b)[A-Z]\w*\s*[(<]/
const serverComponentsDefault: Check = (files, worktree) =>
  files
    .filter((f) => isSource(f.path) && f.path.endsWith('.tsx'))
    .filter((f) => f.added.some((line) => /^\s*['"]use client['"]/.test(line)))
    .filter((f) => {
      const text = fullText(worktree, f)
      return (
        !CLIENT_HOOK.test(text) &&
        !/\bon[A-Z]\w*=\{/.test(text) &&
        !/\b(window|document|navigator|localStorage|sessionStorage)\b/.test(text)
      )
    })
    .map((f) => `${f.path}: "use client" with no hook, handler or browser API`)

// `.claude/rules/ui.md` → Typography Components: a raw text tag outside the
// primitives fails.
const typographyComponents: Check = (files) =>
  files
    .filter((f) => isSource(f.path) && f.path.endsWith('.tsx'))
    .filter((f) => !f.path.startsWith('src/components/ui/'))
    .flatMap((f) =>
      f.added
        .filter((line) => /<(h[1-6]|p|ul|ol|li|blockquote|pre|code)(\s|>|\/>)/.test(line))
        .map((line) => `${f.path}: raw text tag: ${line.trim()}`),
    )

// `.claude/rules/auth.md` → Client: sign-in goes through
// `authClient.signIn.email()` with callbacks, never a raw fetch to /api/auth.
const authClientSignIn: Check = (files, worktree) => {
  const source = files.filter((f) => isSource(f.path))
  const reasons = source.flatMap((f) =>
    f.added
      .filter((line) => /fetch\(\s*[`'"][^`'"]*\/api\/auth/.test(line))
      .map((line) => `${f.path}: raw fetch to /api/auth: ${line.trim()}`),
  )
  const signIns = source.filter((f) => f.added.some((line) => /\bsignIn\.email\(/.test(line)))
  if (signIns.length === 0) reasons.push('no authClient.signIn.email() call')
  for (const f of signIns) {
    if (!/\bon(Success|Error)\s*[:(]/.test(fullText(worktree, f)))
      reasons.push(`${f.path}: signIn.email() without onSuccess/onError callbacks`)
  }
  return reasons
}

export const CHECKS: Record<string, Check> = {
  'validate-once': validateOnce,
  'inline-single-use': inlineSingleUse,
  'guard-unlikely': guardUnlikely,
  'server-components-default': serverComponentsDefault,
  'typography-components': typographyComponents,
  'auth-client-sign-in': authClientSignIn,
}

function main(argv: string[]): number {
  const [name, worktree, , patchFile] = argv
  const check = name ? CHECKS[name] : undefined
  if (!check || !worktree || !patchFile) {
    process.stderr.write(
      `Usage: checks.ts <${Object.keys(CHECKS).join('|')}> <worktree> <stream> <patch>\n`,
    )
    return 2
  }
  const reasons = check(parsePatch(fs.readFileSync(patchFile, 'utf8')), worktree)
  for (const reason of reasons) process.stderr.write(`${reason}\n`)
  process.stdout.write(reasons.length === 0 ? 'PASS\n' : 'FAIL\n')
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
