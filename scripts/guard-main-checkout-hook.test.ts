/**
 * The main-checkout PreToolUse guard (`.claude/hooks/guard-main-checkout.mts`).
 *
 * Interactive sessions share the main checkout, so the first write in one of
 * them must move it into a worktree instead. These tests pin what counts as a
 * write there, what stays allowed (`/merge` returns to `main`), and the opt-in.
 * The last block runs the real `.sh` entrypoint against a scratch repository
 * with a linked worktree, which is what Claude Code runs.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkBashCommand,
  checkFileWrite,
  MAIN_CHECKOUT_OPT_IN,
  type GuardContext,
} from '../.claude/hooks/guard-main-checkout.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hook = path.join(repoRoot, '.claude/hooks/guard-main-checkout.sh')

const MAIN = '/repo/main'
const WORKTREE = '/worktrees/feature'

const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({
  cwd: MAIN,
  env: {},
  mainCheckoutOf: (dir) => (dir === MAIN || dir.startsWith(`${MAIN}/`) ? MAIN : null),
  ...overrides,
})

describe('file tools', () => {
  it.each(['src/app/page.tsx', `${MAIN}/docs/PROJECT_SPEC.md`, 'new/dir/file.ts'])(
    'blocks a write inside the main checkout: %s',
    (file) => {
      expect(checkFileWrite(file, ctx()).blocked).toBe(true)
    },
  )

  it.each([`${WORKTREE}/src/app/page.tsx`, '/tmp/scratch/notes.md'])(
    'allows a write outside the main checkout: %s',
    (file) => {
      expect(checkFileWrite(file, ctx()).blocked).toBe(false)
    },
  )

  it('allows a relative write once the session is in a worktree', () => {
    expect(checkFileWrite('src/app/page.tsx', ctx({ cwd: WORKTREE })).blocked).toBe(false)
  })

  it('tells Claude to call EnterWorktree', () => {
    const verdict = checkFileWrite('src/app/page.tsx', ctx())
    expect(verdict.blocked ? verdict.reason : '').toMatch(/EnterWorktree/)
  })

  it('allows everything when the session opted in', () => {
    expect(
      checkFileWrite('src/app/page.tsx', ctx({ env: { [MAIN_CHECKOUT_OPT_IN]: '1' } })).blocked,
    ).toBe(false)
  })
})

describe('git commands in the main checkout', () => {
  it.each([
    'git checkout -b kaupo/hon-1-feature',
    'git checkout kaupo/hon-1-feature',
    'git switch -c fix/thing',
    'git switch feature',
    'git checkout -- src/app/page.tsx',
    'git checkout main -- src/app/page.tsx',
    'git stash',
    'git stash push -m wip',
    'git stash pop',
    'git restore src/app/page.tsx',
    'git clean -fd',
    'git reset --hard origin/main',
    'git reset --merge',
    'git status && git checkout -b foo',
    `git -C ${MAIN} switch feature`,
  ])('blocks: %s', (command) => {
    expect(checkBashCommand(command, ctx()).blocked).toBe(true)
  })

  it.each([
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'git checkout main',
    'git switch main',
    'git checkout main && git pull origin main',
    'git fetch origin main',
    'git branch -d kaupo/hon-1-feature',
    'git stash list',
    'git stash show -p',
    'git reset',
    'git reset --soft HEAD~1',
    'echo "git checkout -b foo"',
    'grep -rn "git stash" .claude/skills',
  ])('allows: %s', (command) => {
    expect(checkBashCommand(command, ctx()).blocked).toBe(false)
  })

  it('allows a one-command opt-in prefix', () => {
    expect(checkBashCommand(`${MAIN_CHECKOUT_OPT_IN}=1 git checkout -b foo`, ctx()).blocked).toBe(
      false,
    )
  })

  it('allows a session-wide opt-in', () => {
    expect(
      checkBashCommand('git checkout -b foo', ctx({ env: { [MAIN_CHECKOUT_OPT_IN]: '1' } }))
        .blocked,
    ).toBe(false)
  })
})

describe('git commands elsewhere', () => {
  it.each(['git checkout -b foo', 'git stash', 'git reset --hard'])(
    'allows in a worktree: %s',
    (command) => {
      expect(checkBashCommand(command, ctx({ cwd: WORKTREE })).blocked).toBe(false)
    },
  )

  it('follows cd into the main checkout', () => {
    expect(checkBashCommand(`cd ${MAIN} && git stash`, ctx({ cwd: WORKTREE })).blocked).toBe(true)
  })

  it('follows git -C into the main checkout', () => {
    expect(checkBashCommand(`git -C ${MAIN} reset --hard`, ctx({ cwd: WORKTREE })).blocked).toBe(
      true,
    )
  })
})

describe('the real hook', () => {
  let scratch: string
  let main: string
  let worktree: string

  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    })

  const run = (input: object, env: Record<string, string> = {}) => {
    const { [MAIN_CHECKOUT_OPT_IN]: _ignored, ...base } = process.env
    return spawnSync(hook, {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...base, ...env },
    })
  }

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-main-checkout-')))
    main = path.join(scratch, 'main')
    worktree = path.join(scratch, 'feature')
    fs.mkdirSync(main)
    git(main, 'init', '-q', '-b', 'main')
    git(
      main,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    )
    git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree)
  })

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('exits 2 with the reason on stderr for an Edit in the main checkout', () => {
    const result = run({
      tool_name: 'Edit',
      cwd: main,
      tool_input: { file_path: path.join(main, 'a.ts') },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/EnterWorktree/)
  })

  it('exits 0 for an Edit in a linked worktree', () => {
    const result = run({
      tool_name: 'Edit',
      cwd: worktree,
      tool_input: { file_path: path.join(worktree, 'a.ts') },
    })
    expect(result.status).toBe(0)
  })

  it('exits 2 for a branch switch in the main checkout', () => {
    const result = run({ tool_name: 'Bash', cwd: main, tool_input: { command: 'git switch -c x' } })
    expect(result.status).toBe(2)
  })

  it('exits 0 when the Claude process opted in', () => {
    const result = run(
      { tool_name: 'Write', cwd: main, tool_input: { file_path: path.join(main, 'a.ts') } },
      { [MAIN_CHECKOUT_OPT_IN]: '1' },
    )
    expect(result.status).toBe(0)
  })

  it('fails open on malformed input', () => {
    const result = spawnSync(hook, { input: 'not json', encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/failed open/)
  })
})
