import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * `wt` and the orchestrator put the `.nvmrc` Node first on PATH at start-up
 * (HON-1307). An orchestrator started before nvm replaced 22.x.y kept a PATH
 * whose `node` fell through to Homebrew's Node 26, so every worker failed
 * `pnpm install` engine-strict.
 *
 * Each test commits copies of the scripts and `.claude/hooks/repo-node-bin.sh`
 * into a temp repository, because both resolve the repository from their own
 * path. `.nvmrc` says 41 and the stray `node` says 40: no real install has
 * either, so `/opt/homebrew/opt/node@<major>` cannot satisfy the hook and
 * "no match anywhere" holds on every machine. Unlike worktree-prepare.test.ts,
 * `wt` is executed, not sourced, because the PATH change sits in its
 * dispatcher.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.dirname(scriptsDir)

// Records the Node and PATH the install runs on.
const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $* on $(node -v)" >> "$STUB_DIR/calls"
echo "$PATH" > "$STUB_DIR/pnpm-path"
exit 0
`

// Stands in for orchestrator.sh: records what a worker it spawns would see,
// then stays up past cmd_start's one-second liveness check.
const ORCHESTRATOR_STUB = `#!/usr/bin/env bash
bash -c 'node -v' > "$STUB_DIR/worker-node"
sleep 2
`

const fakeNode = (version: string) => `#!/bin/sh\necho ${version}\n`

let tmp: string
let main: string
let stubDir: string
let nvmDir: string

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

function copyIn(rel: string, from = path.join(repoDir, rel)): void {
  fs.mkdirSync(path.dirname(path.join(main, rel)), { recursive: true })
  fs.copyFileSync(from, path.join(main, rel))
}

/** A Node of `version` under the fake $NVM_DIR. */
function nvmNode(version: string): string {
  const bin = path.join(nvmDir, 'versions', 'node', version, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'node'), fakeNode(version), { mode: 0o755 })
  return bin
}

/** The PATH a test passes: the stubs, then a `node` of `version`, then the rest. */
function pathWithNode(version: string): string {
  const bin = path.join(tmp, `path-node-${version}`)
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'node'), fakeNode(version), { mode: 0o755 })
  return `${stubDir}:${bin}:${process.env.PATH}`
}

function wt(PATH: string, ...args: string[]) {
  const r = spawnSync('/bin/bash', [path.join(main, 'scripts', 'worktree-claude.sh'), ...args], {
    cwd: main,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...gitEnv(), PATH, NVM_DIR: nvmDir, STUB_DIR: stubDir, LINEAR_API_KEY: 'lin_test' },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function stubFile(name: string): string | null {
  const file = path.join(stubDir, name)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-node-')))
  stubDir = path.join(tmp, 'bin')
  nvmDir = path.join(tmp, 'nvm')
  fs.mkdirSync(stubDir)
  fs.mkdirSync(nvmDir)
  fs.writeFileSync(path.join(stubDir, 'pnpm'), PNPM_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'calls'), '')

  const origin = path.join(tmp, 'origin.git')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  main = path.join(tmp, 'main')
  git(tmp, 'init', '-q', '-b', 'main', main)
  fs.writeFileSync(path.join(main, '.nvmrc'), '41\n')
  copyIn('scripts/worktree-claude.sh')
  copyIn('scripts/models.sh')
  copyIn('.claude/hooks/repo-node-bin.sh')
  fs.writeFileSync(path.join(main, 'scripts', 'orchestrator.sh'), ORCHESTRATOR_STUB, {
    mode: 0o755,
  })
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'add wt')
  git(main, 'remote', 'add', 'origin', origin)
  git(main, 'push', '-q', '-u', 'origin', 'main')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('wt runs on the .nvmrc Node (HON-1307)', () => {
  it('runs pnpm install in a new worktree on the .nvmrc major when PATH has another', () => {
    nvmNode('v41.2.0')

    const r = wt(pathWithNode('v40.1.0'), 'prepare', 'feat-x')

    expect(r.status, r.stderr).toBe(0)
    expect(stubFile('calls')).toContain('pnpm install --frozen-lockfile on v41.2.0')
  })

  it('starts an orchestrator whose workers see the .nvmrc major', () => {
    nvmNode('v41.2.0')

    const r = wt(pathWithNode('v40.1.0'), 'start')

    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(stubFile('worker-node')).toBe('v41.2.0\n')
  })

  it('refuses to start the orchestrator when no Node matches .nvmrc', () => {
    const r = wt(pathWithNode('v40.1.0'), 'start')

    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('repo-node-bin: no Node 41 found (have 40)')
    expect(stubFile('worker-node')).toBeNull()
  })

  it('warns and goes on for other commands when no Node matches .nvmrc', () => {
    const r = wt(pathWithNode('v40.1.0'), 'prepare', 'feat-x')

    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).toContain('repo-node-bin: no Node 41 found (have 40)')
    expect(stubFile('calls')).toContain('pnpm install --frozen-lockfile on v40.1.0')
  })

  it('leaves PATH alone when its Node already matches .nvmrc', () => {
    nvmNode('v41.2.0')
    const PATH = pathWithNode('v41.0.0')

    const r = wt(PATH, 'prepare', 'feat-x')

    expect(r.status, r.stderr).toBe(0)
    expect(stubFile('pnpm-path')).toBe(`${PATH}\n`)
  })
})

describe('orchestrator use_repo_node (HON-1307)', () => {
  it('puts the .nvmrc Node first on PATH for the workers it spawns', () => {
    nvmNode('v41.2.0')
    copyIn('scripts/orchestrator.sh')

    const r = spawnSync(
      '/bin/bash',
      ['-c', 'source scripts/orchestrator.sh; log() { :; }; use_repo_node; node -v'],
      {
        cwd: main,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...gitEnv(), PATH: pathWithNode('v40.1.0'), NVM_DIR: nvmDir },
      },
    )

    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('v41.2.0\n')
  })
})
