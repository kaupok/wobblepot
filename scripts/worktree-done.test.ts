import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Drives `wt done` (`cmd_done` in scripts/worktree-claude.sh, HON-1066) against
 * a real git repository in a temp dir, with a bare `origin` and `gh` / `pnpm`
 * replaced by stubs on PATH. Real git, because the branch selection reads real
 * `for-each-ref` and `branch --merged` output; a git stub would only test the
 * stub. HOME points at the temp dir, so WORKTREE_BASE and the orchestrator
 * status file are the test's own. The script is sourced, not executed, so its
 * dispatcher and `.env` load never run, and no NEON_* variable reaches it.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')

type MergedPr = { number: number; headRefName: string; headRefOid: string }

// `gh pr list --state merged --limit 200 --json …` returns the fixture.
// `gh pr list --head <b> --state merged --json state --jq '.[0].state'` (from
// is_branch_merged) prints MERGED when a fixture PR has that head.
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_DIR/calls"
[ "$STUB_GH_FAILS" = 1 ] && { echo "gh: HTTP 502" >&2; exit 1; }
head=""
while [ $# -gt 0 ]; do
  case "$1" in
    --head) head="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$head" ]; then
  jq -r --arg h "$head" 'if any(.[]; .headRefName == $h) then "MERGED" else empty end' "$STUB_DIR/prs.json"
else
  cat "$STUB_DIR/prs.json"
fi
`

// A Neon call must never leave the test, configured or not.
const PNPM_STUB = `#!/usr/bin/env bash
echo "pnpm $*" >> "$STUB_DIR/calls"
exit 0
`

let tmp: string
let home: string
let main: string
let stubDir: string
let worktreeBase: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim()
}

// Built from scratch rather than spread from process.env: no NEON_* key, and no
// GIT_DIR / GIT_INDEX_FILE from a calling git hook, can reach the script.
function gitEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
}

function commit(cwd: string, file: string, content = file): string {
  fs.writeFileSync(path.join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `add ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A branch with one commit, pushed, then squash-merged into main on origin. Returns the branch tip. */
function squashMerged(branch: string, file: string): string {
  git(main, 'checkout', '-q', '-b', branch, 'main')
  const tip = commit(main, file)
  git(main, 'checkout', '-q', 'main')
  git(main, 'merge', '-q', '--squash', branch)
  git(main, 'commit', '-q', '-m', `squash ${branch}`)
  git(main, 'push', '-q', 'origin', 'main')
  return tip
}

function branches(): string[] {
  return git(main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort()
}

function writePrs(prs: MergedPr[]): void {
  fs.writeFileSync(path.join(stubDir, 'prs.json'), JSON.stringify(prs))
}

function writeOrchestratorStatus(workerBranches: string[]): void {
  fs.mkdirSync(worktreeBase, { recursive: true })
  fs.writeFileSync(
    path.join(worktreeBase, 'orchestrator-status.json'),
    JSON.stringify({ workers: workerBranches.map((branch, i) => ({ issue: `HON-${i}`, branch })) }),
  )
}

function addWorktree(branch: string): string {
  const dir = path.join(worktreeBase, branch.replace(/\//g, '--'))
  git(main, 'worktree', 'add', '-q', dir, branch)
  return dir
}

function runDone(cwd: string, opts: { ghFails?: boolean } = {}) {
  const r = spawnSync('/bin/bash', ['-c', 'source "$1"; cmd_done', 'bash', worktreeClaude], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...gitEnv(),
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_DIR: stubDir,
      STUB_GH_FAILS: opts.ghFails ? '1' : '0',
    },
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-done-')))
  home = tmp
  stubDir = path.join(tmp, 'bin')
  worktreeBase = path.join(home, '.worktrees', 'wobblepot')
  fs.mkdirSync(stubDir)
  fs.writeFileSync(path.join(stubDir, 'gh'), GH_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'pnpm'), PNPM_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'calls'), '')
  writePrs([])

  const origin = path.join(tmp, 'origin.git')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  main = path.join(tmp, 'main')
  git(tmp, 'init', '-q', '-b', 'main', main)
  commit(main, 'README.md')
  git(main, 'remote', 'add', 'origin', origin)
  git(main, 'push', '-q', '-u', 'origin', 'main')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('wt done branch selection (HON-1066)', () => {
  it('deletes a squash-merged branch whose tip equals the PR head', () => {
    const tip = squashMerged('kaupo/hon-1-a', 'a.txt')
    writePrs([{ number: 1, headRefName: 'kaupo/hon-1-a', headRefOid: tip }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('kaupo/hon-1-a (squash #1)')
  })

  it('keeps a squash-merged branch with a commit after the merge, with a WARN', () => {
    const tip = squashMerged('kaupo/hon-2-b', 'b.txt')
    writePrs([{ number: 2, headRefName: 'kaupo/hon-2-b', headRefOid: tip }])
    git(main, 'checkout', '-q', 'kaupo/hon-2-b')
    commit(main, 'b-late.txt')
    git(main, 'checkout', '-q', 'main')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-2-b', 'main'])
    expect(r.out).toMatch(/WARN: Keeping 'kaupo\/hon-2-b': has commits after merged PR #2/)
  })

  it('deletes a `gh pr checkout` branch pr<N> whose tip equals PR N head', () => {
    const tip = squashMerged('pr707', 'c.txt')
    writePrs([{ number: 707, headRefName: 'kaupo/hon-627-scan', headRefOid: tip }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('pr707 (squash #707)')
  })

  it('keeps pr<N> when its tip is not the PR head', () => {
    squashMerged('pr708', 'd.txt')
    writePrs([{ number: 708, headRefName: 'someone/else', headRefOid: 'f'.repeat(40) }])

    const r = runDone(main)

    expect(branches()).toEqual(['main', 'pr708'])
    expect(r.out).toContain("WARN: Keeping 'pr708'")
  })

  it('deletes a regular-merged branch', () => {
    git(main, 'checkout', '-q', '-b', 'feat/regular')
    commit(main, 'e.txt')
    git(main, 'checkout', '-q', 'main')
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/regular')
    git(main, 'push', '-q', 'origin', 'main')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('feat/regular (merged)')
  })

  it('leaves an unmerged branch with no PR alone, and silent', () => {
    git(main, 'checkout', '-q', '-b', 'feat/wip')
    commit(main, 'f.txt')
    git(main, 'checkout', '-q', 'main')

    const r = runDone(main)

    expect(branches()).toEqual(['feat/wip', 'main'])
    expect(r.out).not.toContain('feat/wip')
  })

  it('deletes no squash-merged branch when gh fails, and says so', () => {
    const tip = squashMerged('kaupo/hon-3-c', 'g.txt')
    writePrs([{ number: 3, headRefName: 'kaupo/hon-3-c', headRefOid: tip }])

    const r = runDone(main, { ghFails: true })

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-3-c', 'main'])
    expect(r.out).toContain('WARN: Could not list merged PRs with gh')
  })

  it('does not touch a branch listed as an orchestrator worker', () => {
    const tip = squashMerged('auto/hon-4', 'h.txt')
    writePrs([{ number: 4, headRefName: 'auto/hon-4', headRefOid: tip }])
    writeOrchestratorStatus(['auto/hon-4'])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['auto/hon-4', 'main'])
  })
})

describe('wt done worktrees (HON-1066)', () => {
  it('removes a merged, clean worktree and then deletes its branch', () => {
    const tip = squashMerged('kaupo/hon-5-e', 'i.txt')
    writePrs([{ number: 5, headRefName: 'kaupo/hon-5-e', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-5-e')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(r.out).toMatch(/Worktrees removed:\n {2}kaupo\/hon-5-e/)
  })

  it('keeps a merged worktree that has uncommitted changes, and its branch', () => {
    const tip = squashMerged('kaupo/hon-6-f', 'j.txt')
    writePrs([{ number: 6, headRefName: 'kaupo/hon-6-f', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-6-f')
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x')

    const r = runDone(main)

    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-6-f', 'main'])
    expect(r.out).toContain('kaupo/hon-6-f: uncommitted changes')
  })

  it('keeps an orchestrator worker worktree even when it is merged', () => {
    const tip = squashMerged('auto/hon-7', 'k.txt')
    writePrs([{ number: 7, headRefName: 'auto/hon-7', headRefOid: tip }])
    writeOrchestratorStatus(['auto/hon-7'])
    const dir = addWorktree('auto/hon-7')

    const r = runDone(main)

    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['auto/hon-7', 'main'])
    expect(r.out).toContain('auto/hon-7: orchestrator worker')
  })

  it('inside an unmerged worktree removes nothing and says the branch is not merged', () => {
    git(main, 'branch', 'feat/unmerged')
    const dir = addWorktree('feat/unmerged')
    commit(dir, 'l.txt')
    const merged = squashMerged('kaupo/hon-8-g', 'm.txt')
    writePrs([{ number: 8, headRefName: 'kaupo/hon-8-g', headRefOid: merged }])

    const r = runDone(dir)

    expect(r.status).toBe(1)
    expect(r.out).toContain("Branch 'feat/unmerged' is not merged into main — nothing removed")
    expect(fs.existsSync(dir)).toBe(true)
    // It stopped before the prune, so even the merged branch elsewhere stays.
    expect(branches()).toEqual(['feat/unmerged', 'kaupo/hon-8-g', 'main'])
  })

  it('inside a merged worktree removes it from the main checkout and prints the cd', () => {
    const tip = squashMerged('kaupo/hon-9-h', 'n.txt')
    writePrs([{ number: 9, headRefName: 'kaupo/hon-9-h', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-9-h')

    const r = runDone(dir)

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain(`cd ${main}`)
  })

  it('stops before removing anything when the main checkout is dirty', () => {
    const tip = squashMerged('kaupo/hon-10-i', 'o.txt')
    writePrs([{ number: 10, headRefName: 'kaupo/hon-10-i', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-10-i')
    fs.writeFileSync(path.join(main, 'README.md'), 'edited')

    const r = runDone(dir)

    expect(r.status).toBe(1)
    expect(r.out).toContain('The main checkout')
    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-10-i', 'main'])
  })
})

describe('wt help', () => {
  it('lists wt done', () => {
    const r = spawnSync('/bin/bash', ['-c', 'source "$1"; print_usage', 'bash', worktreeClaude], {
      encoding: 'utf8',
      timeout: 30_000,
    })

    expect(r.stdout).toMatch(/^ {2}done {2,}/m)
  })
})
