/**
 * PreToolUse guard: no file changes in the main checkout.
 *
 * Several interactive sessions share the main checkout (`~/Projects/wobblepot`)
 * while the orchestrator's workers run in their own worktrees. When one of
 * those sessions edits a file or switches branch, every other session sees its
 * files change underneath it. So a session that starts as a chat in the main
 * checkout moves into its own worktree at its first write: this hook blocks
 * the write, and the message tells Claude to call `EnterWorktree`. The
 * `WorktreeCreate` hook (`worktree-create.sh`) then builds the worktree the way
 * `wt new` does.
 *
 * What it blocks, only when the target is the main checkout:
 *
 * - `Edit`, `Write` and `NotebookEdit` on a file inside it;
 * - Bash `git` commands that change the shared working tree or branch:
 *   `checkout`/`switch` to anything but `main`, `stash` (except `list`/`show`),
 *   `restore`, `clean`, and `reset --hard|--merge|--keep`.
 *
 * `git checkout main` and `git pull` stay allowed, because `/merge` returns to
 * `main` that way. Reads, Linear, planning and `/branch-review` are untouched.
 * File writes through Bash (`sed -i`, redirects) are not parsed: CLAUDE.md →
 * "Parallel sessions" carries that half of the rule.
 *
 * Opt out with `WOBBLEPOT_ALLOW_MAIN_CHECKOUT=1`: in the environment of the
 * Claude process for a whole session, or as an inline prefix on one Bash
 * command.
 *
 * Invoked through `guard-main-checkout.sh`, registered in
 * `.claude/settings.json`. Exit 2 blocks the call and feeds stderr back to
 * Claude; an internal error exits 0 with a warning, so a hook bug cannot stall
 * a session.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { splitCommand, tokenize, unwrap, type Verdict } from './block-destructive.mts'

export const MAIN_CHECKOUT_OPT_IN = 'WOBBLEPOT_ALLOW_MAIN_CHECKOUT'

export interface GuardContext {
  /** Directory the tool call runs in — the hook input's `cwd`. */
  cwd: string
  env: Record<string, string | undefined>
  /** Root of the main checkout that contains `target`, or null when it is in a linked worktree or outside git. */
  mainCheckoutOf?: (target: string) => string | null
}

const PASS: Verdict = { blocked: false }

const reason = (what: string, root: string) =>
  [
    `${what} would change the main checkout (${root}), which other Claude sessions share.`,
    'Move this session into its own worktree first: call the EnterWorktree tool (load it with ToolSearch if needed),',
    "with the Linear issue's gitBranchName as the name when there is an issue, or `<prefix>/<short-slug>` otherwise",
    '(the prefix of the branch names in `git branch`). Then retry the change there, with paths inside the worktree.',
    `To work in the main checkout on purpose, the user starts Claude with ${MAIN_CHECKOUT_OPT_IN}=1.`,
  ].join(' ')

const optedIn = (env: Record<string, string | undefined>) => env[MAIN_CHECKOUT_OPT_IN] === '1'

/** Nearest existing directory at or above `p`, so a new file's checkout can be resolved. */
function existingDir(p: string): string {
  let dir = p
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir)
    if (parent === dir) return dir
    dir = parent
  }
  return fs.statSync(dir).isDirectory() ? dir : path.dirname(dir)
}

/** Main checkout root for `target` (a file need not exist yet); null in a linked worktree, outside git, or inside `.git`. */
export function gitMainCheckoutOf(target: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
      { cwd: existingDir(target), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const [gitDir, commonDir, toplevel] = out.trim().split('\n')
    return gitDir && toplevel && gitDir === commonDir ? toplevel : null
  } catch {
    return null
  }
}

/** Decides whether an `Edit`/`Write`/`NotebookEdit` on `file` may run. */
export function checkFileWrite(file: string, ctx: GuardContext): Verdict {
  if (optedIn(ctx.env)) return PASS
  const target = path.resolve(ctx.cwd, file)
  const root = (ctx.mainCheckoutOf ?? gitMainCheckoutOf)(target)
  return root ? { blocked: true, reason: reason(`Writing ${path.relative(root, target)}`, root) } : PASS
}

const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const STASH_READ_ONLY = new Set(['list', 'show'])
const RESET_DISCARDS = new Set(['--hard', '--merge', '--keep'])

/** What a git command would change in its working tree, or null; `dir` is its `-C` directory. */
function gitChangesTree(args: string[]): { dir?: string; what: string } | null {
  let dir: string | undefined
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    if (GIT_GLOBAL_WITH_VALUE.has(args[i]!)) {
      if (args[i] === '-C') dir = args[i + 1]
      i += 2
    } else {
      i++
    }
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  const what = `\`git ${sub}\``
  switch (sub) {
    case 'checkout':
    case 'switch': {
      const positionals = rest.filter((a) => !a.startsWith('-'))
      const onlyMain = positionals.length === 1 && positionals[0] === 'main' && !rest.includes('--')
      const creates = rest.some((a) => ['-b', '-B', '-c', '-C', '--orphan'].includes(a))
      return onlyMain && !creates ? null : { dir, what }
    }
    case 'stash': {
      const action = rest.find((a) => !a.startsWith('-'))
      return action && STASH_READ_ONLY.has(action) ? null : { dir, what }
    }
    case 'restore':
    case 'clean':
      return { dir, what }
    case 'reset':
      return rest.some((a) => RESET_DISCARDS.has(a)) ? { dir, what: `\`git reset ${rest.find((a) => RESET_DISCARDS.has(a))}\`` } : null
    default:
      return null
  }
}

/** Decides whether a Bash command may run. Follows `cd` like block-destructive does. */
export function checkBashCommand(command: string, ctx: GuardContext): Verdict {
  if (optedIn(ctx.env)) return PASS
  let cwd = ctx.cwd
  for (const segment of splitCommand(command)) {
    const { argv, env } = unwrap(tokenize(segment.text))
    const [program, ...args] = argv
    if (program === 'cd') {
      const dir = args.find((a) => !a.startsWith('-'))
      if (dir && !dir.startsWith('~') && !dir.includes('$')) cwd = path.resolve(cwd, dir)
      continue
    }
    if (program !== 'git' || optedIn(env)) continue
    const hit = gitChangesTree(args)
    if (!hit) continue
    const dir = hit.dir ? path.resolve(cwd, hit.dir) : cwd
    const root = (ctx.mainCheckoutOf ?? gitMainCheckoutOf)(dir)
    if (root) return { blocked: true, reason: reason(hit.what, root) }
  }
  return PASS
}

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

async function main(): Promise<number> {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  const ctx: GuardContext = {
    cwd: typeof input?.cwd === 'string' ? input.cwd : process.cwd(),
    env: process.env,
  }
  const tool = input?.tool_name
  let verdict: Verdict = PASS
  if (tool === 'Bash' && typeof input?.tool_input?.command === 'string') {
    verdict = checkBashCommand(input.tool_input.command, ctx)
  } else if (tool in FILE_TOOLS && typeof input?.tool_input?.[FILE_TOOLS[tool]!] === 'string') {
    verdict = checkFileWrite(input.tool_input[FILE_TOOLS[tool]!], ctx)
  }
  if (!verdict.blocked) return 0
  process.stderr.write(`Blocked by .claude/hooks/guard-main-checkout.mts: ${verdict.reason}\n`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`guard-main-checkout hook failed open: ${String(error)}\n`)
      process.exit(0)
    },
  )
}
