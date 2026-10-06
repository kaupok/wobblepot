import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Drives `wt prepare`'s issue-ID resolution (`resolve_prepare_branch` and
 * `cmd_prepare` in scripts/worktree-claude.sh, HON-1094) against a real git
 * repository in a temp dir, with a bare `origin` and `curl` / `pnpm` replaced
 * by stubs on PATH. EnterWorktree rejects a name over 64 characters, so the
 * main-checkout guard tells Claude to pass `hon-123`, and prepare turns it back
 * into the issue's Linear branch.
 *
 * The script derives REPO_ROOT from its own path, so each test commits a copy
 * of it into the temp repository and sources that copy. It is sourced, not
 * executed, so its dispatcher and `.env` load never run, and LINEAR_API_KEY is
 * set only where a test sets it.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')

// Records each call and answers with $STUB_DIR/linear.json, or fails as curl
// does on a network error when STUB_CURL_FAILS=1.
const CURL_STUB = `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls"
[ "$STUB_CURL_FAILS" = 1 ] && exit 7
cat "$STUB_DIR/linear.json"
`

const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls"
exit 0
`

let tmp: string
let main: string
let stubDir: string

function gitEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: tmp,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim()
}

function commit(cwd: string, file: string): void {
  fs.writeFileSync(path.join(cwd, file), file)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `add ${file}`)
}

/** A local branch with one commit, not pushed. */
function localBranch(branch: string): void {
  git(main, 'checkout', '-q', '-b', branch, 'main')
  commit(main, `${branch.replace(/\//g, '-')}.txt`)
  git(main, 'checkout', '-q', 'main')
}

/** A branch pushed to origin from another clone, so the main checkout has no ref for it yet. */
function remoteOnlyBranch(branch: string): void {
  const other = path.join(tmp, 'other')
  git(tmp, 'clone', '-q', path.join(tmp, 'origin.git'), other)
  git(other, 'checkout', '-q', '-b', branch)
  commit(other, 'remote.txt')
  git(other, 'push', '-q', 'origin', branch)
}

function linearAnswers(body: unknown): void {
  fs.writeFileSync(path.join(stubDir, 'linear.json'), JSON.stringify(body))
}

function curlCalls(): string[] {
  return fs
    .readFileSync(path.join(stubDir, 'calls'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('curl '))
}

function run(
  command: string,
  arg: string,
  opts: { linearKey?: boolean; curlFails?: boolean } = {},
) {
  const script = path.join(main, 'scripts', 'worktree-claude.sh')
  const r = spawnSync('/bin/bash', ['-c', `source "$1"; ${command} "$2"`, 'bash', script, arg], {
    cwd: main,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...gitEnv(),
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_DIR: stubDir,
      STUB_CURL_FAILS: opts.curlFails ? '1' : '0',
      ...(opts.linearKey ? { LINEAR_API_KEY: 'lin_test' } : {}),
    },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const resolve = (name: string, opts?: { linearKey?: boolean; curlFails?: boolean }) =>
  run('resolve_prepare_branch', name, opts)

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-prepare-')))
  stubDir = path.join(tmp, 'bin')
  fs.mkdirSync(stubDir)
  fs.writeFileSync(path.join(stubDir, 'curl'), CURL_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'pnpm'), PNPM_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'calls'), '')
  linearAnswers({ data: { issue: { branchName: 'kaupo/hon-123-from-linear' } } })

  const origin = path.join(tmp, 'origin.git')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  main = path.join(tmp, 'main')
  git(tmp, 'init', '-q', '-b', 'main', main)
  commit(main, 'README.md')
  fs.mkdirSync(path.join(main, 'scripts'))
  fs.copyFileSync(worktreeClaude, path.join(main, 'scripts', 'worktree-claude.sh'))
  git(main, 'add', 'scripts/worktree-claude.sh')
  git(main, 'commit', '-q', '-m', 'add wt')
  git(main, 'remote', 'add', 'origin', origin)
  git(main, 'push', '-q', '-u', 'origin', 'main')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('resolve_prepare_branch (HON-1094)', () => {
  it('resolves an issue ID to the local branch that carries it, without asking Linear', () => {
    localBranch('kaupo/hon-123-foo')

    const r = resolve('hon-123', { linearKey: true })

    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('kaupo/hon-123-foo\n')
    expect(curlCalls()).toEqual([])
  })

  it('resolves to a branch that exists only on origin', () => {
    remoteOnlyBranch('kaupo/hon-123-foo')

    const r = resolve('hon-123', { linearKey: true })

    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('kaupo/hon-123-foo\n')
    expect(curlCalls()).toEqual([])
  })

  it("asks Linear for the issue's branchName when no branch carries the ID", () => {
    const r = resolve('hon-123', { linearKey: true })

    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('kaupo/hon-123-from-linear\n')
    expect(curlCalls()).toHaveLength(1)
    expect(curlCalls()[0]).toContain('HON-123')
  })

  it('accepts the ID in upper case', () => {
    localBranch('kaupo/hon-123-foo')

    expect(resolve('HON-123').stdout).toBe('kaupo/hon-123-foo\n')
  })

  it('keeps the ID and names the reason when LINEAR_API_KEY is not set', () => {
    const r = resolve('hon-123')

    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('hon-123\n')
    expect(r.stderr).toContain('LINEAR_API_KEY is not set')
    expect(curlCalls()).toEqual([])
  })

  it('keeps the ID and names the reason when Linear has no such issue', () => {
    linearAnswers({ data: { issue: null }, errors: [{ message: 'Entity not found: Issue' }] })

    const r = resolve('hon-123', { linearKey: true })

    expect(r.stdout).toBe('hon-123\n')
    expect(r.stderr).toContain('Entity not found: Issue')
  })

  it('keeps the ID and names the reason when the request fails', () => {
    const r = resolve('hon-123', { linearKey: true, curlFails: true })

    expect(r.stdout).toBe('hon-123\n')
    expect(r.stderr).toContain('the API request failed')
  })

  it('keeps the ID when Linear answers with a name git cannot use', () => {
    linearAnswers({ data: { issue: { branchName: 'kaupo/bad..name' } } })

    const r = resolve('hon-123', { linearKey: true })

    expect(r.stdout).toBe('hon-123\n')
    expect(r.stderr).toContain('not a valid branch name')
  })

  it('does not resolve hon-12 to a hon-123 branch', () => {
    localBranch('kaupo/hon-123-foo')
    remoteOnlyBranch('kaupo/hon-123-bar')

    const r = resolve('hon-12')

    expect(r.stdout).toBe('hon-12\n')
  })

  it('passes any other name through unchanged, without asking Linear', () => {
    const r = resolve('kaupo/some-slug', { linearKey: true })

    expect(r.stdout).toBe('kaupo/some-slug\n')
    expect(curlCalls()).toEqual([])
  })
})

describe('cmd_prepare with an issue ID (HON-1094)', () => {
  it("prints only the worktree path, and the worktree is on the issue's Linear branch", () => {
    const r = run('cmd_prepare', 'hon-123', { linearKey: true })

    const expected = path.join(tmp, '.worktrees', 'wobblepot', 'kaupo--hon-123-from-linear')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe(`${expected}\n`)
    expect(r.stderr).toContain('Resolved hon-123 to the branch kaupo/hon-123-from-linear')
    expect(git(expected, 'branch', '--show-current')).toBe('kaupo/hon-123-from-linear')
  })
})
