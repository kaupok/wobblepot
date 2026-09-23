/**
 * PreToolUse guard for the Bash tool (HON-727).
 *
 * Autonomous workers run `claude --dangerously-skip-permissions`
 * (`scripts/worktree-claude.sh`), so the permission system never asks before a
 * command. PreToolUse hooks still fire under that flag, which makes this file
 * the only mechanical enforcement of three CLAUDE.md rules:
 *
 * - never run destructive database commands (`migrate reset`, `db push
 *   --force-reset`, `DROP`, …) — they destroy staging/production data;
 * - never push to `main`, and never rewrite pushed history (force push);
 * - never merge a PR without an explicit user request. `/merge` and
 *   `/auto-implement` merge legitimately, so they opt in by prefixing the
 *   command with `WOBBLEPOT_ALLOW_MERGE=1`.
 *
 * It guards against accidents, not adversaries: the command is split into the
 * simple commands that would actually *execute* (quote- and heredoc-aware), so
 * `grep "migrate reset" docs/` or a commit message that mentions `gh pr merge`
 * passes. Deliberately obfuscated input (variables, `$(…)` inside double
 * quotes, scripts on disk) is out of scope.
 *
 * Invoked through `block-destructive.sh`, registered in `.claude/settings.json`.
 * Exit 2 blocks the call and feeds stderr back to Claude; any internal error
 * exits 0 with a warning, because a hook bug must not stall every worker.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MERGE_OPT_IN = 'WOBBLEPOT_ALLOW_MERGE'

export type Verdict = { blocked: false } | { blocked: true; reason: string }

export interface CheckContext {
  /** Directory the command runs in — the hook input's `cwd`. */
  cwd: string
  /** Environment of the Claude process (inline `VAR=1 cmd` assignments are added per command). */
  env: Record<string, string | undefined>
  /** Current branch of the repository at `dir`, or null when unknown. */
  currentBranch?: (dir: string) => string | null
  /** `package.json` scripts; read from `cwd` when omitted. */
  scripts?: Record<string, string>
  /** Reads a SQL file passed to `psql -f` / `prisma db execute --file`; null when unreadable. */
  readFile?: (file: string) => string | null
}

const DESTRUCTIVE_SQL = /\b(drop\s+(table|database|schema)|truncate)\b/i
const PROTECTED_BRANCHES = new Set(['main', 'refs/heads/main'])
const MAX_DEPTH = 5

// ─── Shell splitting ──────────────────────────────────────────────────────────

/** One simple command, plus the bodies of any heredocs it feeds itself. */
export interface Segment {
  text: string
  heredocs: string[]
}

/**
 * Splits a shell command into the simple commands it would run: on unquoted
 * `;`, `&`, `&&`, `|`, `||`, newlines, parentheses, backticks and `$(`. Quoted
 * text stays inside its segment and heredoc bodies are set aside on the
 * segment that reads them, so text that is only *data* never reaches the rules
 * as a command.
 */
export function splitCommand(command: string): Segment[] {
  const segments: Segment[] = []
  let current: Segment = { text: '', heredocs: [] }
  let quote: "'" | '"' | null = null
  const pendingHeredocs: { delimiter: string; stripTabs: boolean; owner: Segment }[] = []

  const flush = () => {
    current.text = current.text.trim()
    if (current.text) segments.push(current)
    current = { text: '', heredocs: [] }
  }

  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    const next = command[i + 1]

    if (quote === "'") {
      current.text += ch
      if (ch === "'") quote = null
      i++
      continue
    }
    if (ch === '\\' && next !== undefined) {
      current.text += ch + next
      i += 2
      continue
    }
    if (quote === '"') {
      current.text += ch
      if (ch === '"') quote = null
      i++
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      current.text += ch
      i++
      continue
    }

    // Comment: `#` at the start of a word runs to end of line.
    if (ch === '#' && (current.text === '' || /\s$/.test(current.text))) {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }

    // Heredoc (`<<EOF`, `<<-'EOF'`), but not a here-string (`<<<`).
    if (ch === '<' && next === '<' && command[i + 2] !== '<') {
      const match = /^<<(-?)\s*(['"]?)([A-Za-z0-9_.-]+)\2/.exec(command.slice(i))
      if (match) {
        pendingHeredocs.push({ delimiter: match[3]!, stripTabs: match[1] === '-', owner: current })
        current.text += match[0]
        i += match[0].length
        continue
      }
    }

    if (ch === '\n') {
      flush()
      i++
      // Set each pending heredoc body aside, line by line, up to its delimiter.
      while (pendingHeredocs.length > 0) {
        const { delimiter, stripTabs, owner } = pendingHeredocs.shift()!
        const body: string[] = []
        while (i < command.length) {
          const end = command.indexOf('\n', i)
          const line = command.slice(i, end === -1 ? command.length : end)
          i = end === -1 ? command.length : end + 1
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break
          body.push(line)
        }
        owner.heredocs.push(body.join('\n'))
      }
      continue
    }

    if (ch === '$' && next === '(') {
      flush()
      i += 2
      continue
    }
    // `2>&1`, `>&2` and `&>file` are redirections, not background operators.
    if (ch === '&' && (next === '>' || /[<>]$/.test(current.text))) {
      current.text += ch
      i++
      continue
    }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')' || ch === '`') {
      flush()
      i++
      continue
    }

    current.text += ch
    i++
  }
  flush()
  return segments
}

export const splitSegments = (command: string): string[] => splitCommand(command).map((s) => s.text)

/**
 * Splits one simple command into words, removing quotes and redirections.
 * Files redirected into stdin (`< drop.sql`) are appended to `inputs`.
 */
export function tokenize(segment: string, inputs: string[] = []): string[] {
  const words: string[] = []
  let word = ''
  let inWord = false
  let quote: "'" | '"' | null = null

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (quote === "'") {
      if (ch === "'") quote = null
      else word += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '\\' && /["\\$`]/.test(segment[i + 1] ?? '')) word += segment[++i]
      else word += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      inWord = true
      continue
    }
    // `\<newline>` is a line continuation: bash removes it entirely.
    if (ch === '\\' && segment[i + 1] === '\n') {
      i++
      continue
    }
    if (ch === '\\' && i + 1 < segment.length) {
      word += segment[++i]
      inWord = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
      continue
    }
    word += ch
    inWord = true
  }
  if (inWord) words.push(word)

  // Drop redirections: `2>&1`, `>out.log`, and a bare `>` / `2>>` with its target.
  const result: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (/^(\d*|&)(>>?|<<?<?)$/.test(w)) {
      if (/^0?<$/.test(w) && words[i + 1] !== undefined) inputs.push(words[i + 1]!)
      i++
      continue
    }
    if (/^0?<[^<>&]/.test(w)) inputs.push(w.replace(/^0?</, ''))
    if (/^(\d*|&)(>>?|<)/.test(w)) continue
    result.push(w)
  }
  return result
}

// ─── Command normalisation ────────────────────────────────────────────────────

const TRANSPARENT = new Set([
  'sudo',
  'env',
  'time',
  'nohup',
  'command',
  'exec',
  'nice',
  'ionice',
  'timeout',
  'stdbuf',
  'xargs',
  '{',
  '!',
  'if',
  'then',
  'elif',
  'else',
  'do',
  'while',
  'until',
])
const RUNNERS = new Set(['npx', 'pnpx', 'bunx'])
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])
/** Programs the rules act on, plus everything `unwrap` sees through. */
const KNOWN_PROGRAMS = new Set([
  ...TRANSPARENT,
  ...RUNNERS,
  ...PACKAGE_MANAGERS,
  'prisma',
  'psql',
  'git',
  'gh',
  'bash',
  'sh',
  'zsh',
  'eval',
])
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

/** `./node_modules/.bin/prisma` → `prisma`; `prisma@6.19.0` → `prisma`. */
const programName = (word: string): string => path.basename(word).replace(/(.)@[^@/]*$/, '$1')

/**
 * Strips what runs *in front of* the real program — inline env assignments,
 * `sudo`/`env`/`time`-style prefixes, `npx` and `pnpm exec` — and reduces the
 * program to its bare name (see `programName`).
 */
export function unwrap(words: string[]): { argv: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {}
  let argv = [...words]

  for (;;) {
    const head = argv[0]
    if (head === undefined) break
    const assignment = ASSIGNMENT.exec(head)
    if (assignment) {
      env[assignment[1]!] = assignment[2]!
      argv = argv.slice(1)
    } else if (TRANSPARENT.has(head) || RUNNERS.has(head)) {
      argv = argv.slice(1)
      // Prefix options can take values (`sudo -u postgres`, `nice -n 10`,
      // `timeout 60`), so jump to the next program the rules know about.
      const next = argv.findIndex((w) => ASSIGNMENT.test(w) || KNOWN_PROGRAMS.has(programName(w)))
      if (next !== -1) argv = argv.slice(next)
      else while (argv[0]?.startsWith('-')) argv = argv.slice(1)
    } else if (PACKAGE_MANAGERS.has(head) && (argv[1] === 'exec' || argv[1] === 'dlx')) {
      argv = argv.slice(2)
    } else {
      break
    }
  }
  if (argv[0] !== undefined) argv[0] = programName(argv[0])
  return { argv, env }
}

// ─── Rules ────────────────────────────────────────────────────────────────────

interface Analysis {
  verdict: Verdict
  /** A segment ran `psql` or `prisma db execute`, so SQL in the command is live. */
  runsSql: boolean
  sqlFiles: string[]
}

const PASS: Verdict = { blocked: false }
const block = (reason: string): Verdict => ({ blocked: true, reason })

function flagValue(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    for (const name of names) {
      if (arg === name) return args[i + 1]
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
      // Short flag with an attached value: `-fschema.sql`.
      if (name.length === 2 && arg.startsWith(name) && !arg.startsWith('--')) {
        return arg.slice(2)
      }
    }
  }
  return undefined
}

function followedBy(args: string[], first: string, second: string): boolean {
  const i = args.indexOf(first)
  if (i === -1) return false
  const next = args.slice(i + 1).find((a) => !a.startsWith('-'))
  return next === second
}

function checkPrisma(args: string[], ctx: CheckContext, analysis: Analysis): Verdict {
  if (followedBy(args, 'migrate', 'reset')) {
    return block('`prisma migrate reset` drops every table in the target database.')
  }
  if (followedBy(args, 'db', 'push')) {
    const flag = args.find((a) => a === '--force-reset' || a === '--accept-data-loss')
    if (flag) return block(`\`prisma db push ${flag}\` can destroy data in the target database.`)
  }
  if (followedBy(args, 'db', 'execute')) {
    analysis.runsSql = true
    const file = flagValue(args, ['--file'])
    if (file) analysis.sqlFiles.push(path.resolve(ctx.cwd, file))
  }
  return PASS
}

function checkPsql(args: string[], ctx: CheckContext, analysis: Analysis): Verdict {
  analysis.runsSql = true
  const file = flagValue(args, ['-f', '--file'])
  if (file) analysis.sqlFiles.push(path.resolve(ctx.cwd, file))
  return PASS
}

/** git options that take a separate value, before the subcommand. */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
/** `git push` options that take a separate value. */
const PUSH_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

function checkGit(args: string[], ctx: CheckContext): Verdict {
  let dir = ctx.cwd
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    const opt = args[i]!
    if (GIT_GLOBAL_WITH_VALUE.has(opt)) {
      if (opt === '-C' && args[i + 1]) dir = path.resolve(dir, args[i + 1]!)
      i += 2
    } else {
      i++
    }
  }
  if (args[i] !== 'push') return PASS

  const rest = args.slice(i + 1)
  const positionals: string[] = []
  let remoteGiven = false
  for (let j = 0; j < rest.length; j++) {
    const arg = rest[j]!
    if (arg === '--repo' || arg.startsWith('--repo=')) remoteGiven = true
    if (arg === '--force' || arg.startsWith('--force-with-lease') || arg === '--force-if-includes') {
      return block(`\`git push ${arg}\` rewrites remote history. Push a new commit instead.`)
    }
    if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) {
      return block(`\`git push ${arg}\` is a force push. Push a new commit instead.`)
    }
    if (arg === '--all' || arg === '--mirror' || arg === '--branches') {
      return block(`\`git push ${arg}\` pushes \`main\`. Push your feature branch by name.`)
    }
    if (PUSH_WITH_VALUE.has(arg)) {
      j++
      continue
    }
    if (arg === '--') continue
    if (!arg.startsWith('-')) positionals.push(arg)
  }

  const branch = () => (ctx.currentBranch ?? gitCurrentBranch)(dir)
  // With `--repo <remote>`, every positional is a refspec.
  const refspecs = remoteGiven ? positionals : positionals.slice(1)
  if (refspecs.length === 0) {
    return branch() === 'main'
      ? block('`git push` from `main` pushes `main`. Commit on a feature branch instead.')
      : PASS
  }
  for (const refspec of refspecs) {
    if (refspec.startsWith('+')) {
      return block(`\`git push ${refspec}\` is a force push. Push a new commit instead.`)
    }
    const colon = refspec.lastIndexOf(':')
    let destination = colon === -1 ? refspec : refspec.slice(colon + 1)
    if (destination === 'HEAD' || destination === '@') destination = branch() ?? destination
    if (PROTECTED_BRANCHES.has(destination)) {
      return block(
        `\`git push\` to \`main\` is not allowed (refspec \`${refspec}\`). Push a feature branch and open a PR.`,
      )
    }
  }
  return PASS
}

function checkGh(allArgs: string[], env: Record<string, string | undefined>): Verdict {
  // Drop `-R/--repo <owner/repo>` so its value is not read as a subcommand.
  const args = allArgs.filter((a, i) => a !== '-R' && a !== '--repo' && !['-R', '--repo'].includes(allArgs[i - 1] ?? ''))
  const positionals = args.filter((a) => !a.startsWith('-'))
  const isPrMerge = followedBy(args, 'pr', 'merge')
  const method = flagValue(args, ['-X', '--method'])
  const isApiMerge =
    positionals[0] === 'api' &&
    method?.toUpperCase() === 'PUT' &&
    positionals.some((a) => /pulls\/[^/\s]+\/merge\b/.test(a))
  if ((isPrMerge || isApiMerge) && env[MERGE_OPT_IN] !== '1') {
    return block(
      `Merging a PR requires an explicit user request (CLAUDE.md → Merging). ` +
        `/merge and /auto-implement opt in with \`${MERGE_OPT_IN}=1 gh pr merge …\`.`,
    )
  }
  return PASS
}

/** Package-manager options that take a separate value (`pnpm --filter web …`). */
const PM_WITH_VALUE = new Set(['--filter', '-F', '-C', '--dir', '--prefix', '--cwd', '-w', '--workspace'])

function checkScript(
  manager: string,
  args: string[],
  ctx: CheckContext,
  env: Record<string, string>,
  depth: number,
  analysis: Analysis,
): Verdict {
  let first = 0
  while (args[first]?.startsWith('-')) first += PM_WITH_VALUE.has(args[first]!) ? 2 : 1
  const rest = args.slice(first)
  let name: string | undefined
  let extra: string[] = []
  if (rest[0] === 'run' || rest[0] === 'run-script') {
    name = rest[1]
    extra = rest.slice(2)
  } else if (manager !== 'npm') {
    name = rest[0]
    extra = rest.slice(1)
  }
  if (!name) return PASS
  if (/reset/i.test(name)) {
    return block(`\`${manager} ${name}\` looks like a database reset wrapper.`)
  }

  const scripts = ctx.scripts ?? readScripts(ctx.cwd)
  const body = scripts[name]
  if (body !== undefined) {
    // pnpm/npm append extra arguments to the script body.
    return absorb(analysis, analyse(`${body} ${extra.join(' ')}`, ctx, depth + 1, env))
  }
  // Not a script: pnpm/yarn/bun run a local binary (`pnpm prisma migrate reset`).
  return manager === 'npm' ? PASS : checkArgv(rest, ctx, env, depth, analysis)
}

function checkArgv(
  words: string[],
  ctx: CheckContext,
  inheritedEnv: Record<string, string>,
  depth: number,
  analysis: Analysis,
  heredocs: string[] = [],
): Verdict {
  const { argv, env: inline } = unwrap(words)
  const env = { ...inheritedEnv, ...inline }
  const [program, ...args] = argv
  if (program === undefined) return PASS

  switch (program) {
    case 'prisma':
      return checkPrisma(args, ctx, analysis)
    case 'psql':
      return checkPsql(args, ctx, analysis)
    case 'git':
      return checkGit(args, ctx)
    case 'gh':
      return checkGh(args, { ...ctx.env, ...env })
    case 'pnpm':
    case 'npm':
    case 'yarn':
    case 'bun':
      return checkScript(program, args, ctx, env, depth, analysis)
    case 'bash':
    case 'sh':
    case 'zsh': {
      const flag = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
      // `bash -c '…'` runs its argument; `bash <<EOF` runs the heredoc body.
      const scripts = flag === -1 ? heredocs : [args[flag + 1] ?? '']
      for (const script of scripts) {
        const verdict = absorb(analysis, analyse(script, ctx, depth + 1, env))
        if (verdict.blocked) return verdict
      }
      return PASS
    }
    case 'eval':
      return absorb(analysis, analyse(args.join(' '), ctx, depth + 1, env))
    default:
      return PASS
  }
}

function absorb(into: Analysis, from: Analysis): Verdict {
  into.runsSql ||= from.runsSql
  into.sqlFiles.push(...from.sqlFiles)
  return from.verdict
}

function analyse(
  command: string,
  ctx: CheckContext,
  depth: number,
  env: Record<string, string> = {},
): Analysis {
  const analysis: Analysis = { verdict: PASS, runsSql: false, sqlFiles: [] }
  if (depth > MAX_DEPTH) return analysis
  // Earlier commands can change where a later bare `git push` runs from.
  let local = ctx
  for (const segment of splitCommand(command)) {
    // Files that could be SQL on stdin: `psql < drop.sql`, `cat drop.sql | psql`.
    // Only read when a segment turns out to run SQL (see `checkCommand`).
    const inputs: string[] = []
    const words = tokenize(segment.text, inputs)
    const [program, ...args] = unwrap(words).argv
    if (program === 'cat') inputs.push(...args.filter((a) => !a.startsWith('-')))
    analysis.sqlFiles.push(...inputs.map((f) => path.resolve(local.cwd, f)))
    const verdict = checkArgv(words, local, env, depth, analysis, segment.heredocs)
    if (verdict.blocked) {
      analysis.verdict = verdict
      return analysis
    }
    local = track(words, local)
  }
  return analysis
}

/** Follows `cd <dir>` and `git checkout|switch <branch>` into the context of later commands. */
function track(words: string[], ctx: CheckContext): CheckContext {
  const [program, ...args] = unwrap(words).argv
  if (program === 'cd') {
    const dir = args.find((a) => !a.startsWith('-'))
    return dir && !dir.startsWith('~') && !dir.includes('$') ? { ...ctx, cwd: path.resolve(ctx.cwd, dir) } : ctx
  }
  const sub = args.findIndex((a) => !a.startsWith('-'))
  if (program !== 'git' || (args[sub] !== 'checkout' && args[sub] !== 'switch')) return ctx
  const rest = args.slice(sub + 1)
  if (rest.includes('--')) return ctx // `git checkout main -- file` restores a file, no switch
  const create = rest.findIndex((a) => ['-b', '-B', '-c', '-C'].includes(a))
  const branch = create !== -1 ? rest[create + 1] : rest.find((a) => !a.startsWith('-'))
  return branch ? { ...ctx, currentBranch: () => branch } : ctx
}

/** Decides whether a Bash tool command may run. */
export function checkCommand(command: string, ctx: CheckContext): Verdict {
  const analysis = analyse(command, ctx, 0)
  if (analysis.verdict.blocked || !analysis.runsSql) return analysis.verdict

  // SQL reaches psql / `prisma db execute` by -c, pipe, heredoc or file, so
  // look at the whole command text plus any file it names or redirects in.
  const read = ctx.readFile ?? readFileOrNull
  const sources = [command, ...analysis.sqlFiles.map((f) => read(f) ?? '')]
  const hit = sources.map((s) => DESTRUCTIVE_SQL.exec(s)).find(Boolean)
  return hit
    ? block(`\`${hit[0]}\` destroys data. Write a migration that fixes forward instead.`)
    : PASS
}

// ─── IO ───────────────────────────────────────────────────────────────────────

function gitCurrentBranch(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function readScripts(dir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg.scripts ?? {}
  } catch {
    return {}
  }
}

/** Files past this size are not SQL scripts worth scanning on every Bash call. */
const MAX_SQL_FILE_BYTES = 1_000_000

function readFileOrNull(file: string): string | null {
  try {
    if (fs.statSync(file).size > MAX_SQL_FILE_BYTES) return null
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

async function main(): Promise<number> {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  const command = input?.tool_input?.command
  if (input?.tool_name !== 'Bash' || typeof command !== 'string') return 0

  const verdict = checkCommand(command, {
    cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    env: process.env,
  })
  if (!verdict.blocked) return 0
  process.stderr.write(`Blocked by .claude/hooks/block-destructive.mts: ${verdict.reason}\n`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`block-destructive hook failed open: ${String(error)}\n`)
      process.exit(0)
    },
  )
}
