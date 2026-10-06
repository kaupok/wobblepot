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
 *
 * `wt done` acts on the checkout that holds the script (HON-1079), so each test
 * commits a copy of it into the temp repository and sources that copy. Sourcing
 * the real one would point `wt done` at this checkout.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')

// `state` defaults to MERGED and `baseRefName` to main. `old` drops a merged PR
// from the bulk list, as GitHub does once more than 200 PRs merged after it
// (HON-1072).
type Pr = {
  number: number
  headRefName: string
  headRefOid: string
  baseRefName?: string
  state?: 'MERGED' | 'OPEN' | 'CLOSED'
  old?: boolean
}

// Serves the three calls `wt done` makes from the fixture:
// - `gh pr list --state merged --limit 200 --json …`: the merged PRs not `old`
// - `gh pr list --head <b> --state all --json …`: every PR with that head
// - `gh pr view <N> --json …`: PR N, or exit 1 when there is none
// STUB_GH_FAILS fails every call; STUB_GH_LOOKUP_FAILS fails the last two only.
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_DIR/calls"
[ "$STUB_GH_FAILS" = 1 ] && { echo "gh: HTTP 502" >&2; exit 1; }
prs="$STUB_DIR/prs.json"
pick='{number, headRefOid, baseRefName, state: (.state // "MERGED")}'
if [ "$1 $2" = "pr view" ]; then
  [ "$STUB_GH_LOOKUP_FAILS" = 1 ] && { echo "gh: HTTP 502" >&2; exit 1; }
  out=$(jq -c --argjson n "$3" "map(select(.number == \\$n)) | first | select(.) | $pick" "$prs")
  [ -n "$out" ] || { echo "no pull requests found" >&2; exit 1; }
  echo "$out"
  exit 0
fi
head=""
while [ $# -gt 0 ]; do
  case "$1" in
    --head) head="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$head" ]; then
  [ "$STUB_GH_LOOKUP_FAILS" = 1 ] && { echo "gh: HTTP 502" >&2; exit 1; }
  jq -c --arg h "$head" "map(select(.headRefName == \\$h) | $pick)" "$prs"
else
  jq -c 'map(select((.state // "MERGED") == "MERGED" and (.old | not)))' "$prs"
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

function writePrs(prs: Pr[]): void {
  const withBase = prs.map((pr) => ({ baseRefName: 'main', ...pr }))
  fs.writeFileSync(path.join(stubDir, 'prs.json'), JSON.stringify(withBase))
}

/** A branch with one commit that never reaches main, as a stacked PR merged into its parent. Returns the tip. */
function unmergedBranch(branch: string, file: string): string {
  git(main, 'checkout', '-q', '-b', branch, 'main')
  const tip = commit(main, file)
  git(main, 'checkout', '-q', 'main')
  return tip
}

/** A clone of origin, to make commits that reach the main checkout only through its pull. */
function cloneOrigin(): string {
  const other = path.join(tmp, 'other')
  git(tmp, 'clone', '-q', path.join(tmp, 'origin.git'), other)
  return other
}

/** Local main and origin/main both change README.md, so `git pull --rebase` stops on a conflict. */
function conflictMainWithOrigin(): void {
  const other = cloneOrigin()
  commit(other, 'README.md', 'origin edit')
  git(other, 'push', '-q', 'origin', 'main')
  commit(main, 'README.md', 'local edit')
}

function rebaseInProgress(): boolean {
  return ['rebase-merge', 'rebase-apply'].some((dir) => fs.existsSync(path.join(main, '.git', dir)))
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

function neonDeletes(): string[] {
  return fs
    .readFileSync(path.join(stubDir, 'calls'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('pnpm ') && line.includes('branches delete'))
}

function ghCalls(): string[] {
  return fs
    .readFileSync(path.join(stubDir, 'calls'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('gh '))
}

function runDone(
  cwd: string,
  opts: { ghFails?: boolean; lookupFails?: boolean; neon?: boolean } = {},
) {
  const script = path.join(main, 'scripts', 'worktree-claude.sh')
  const r = spawnSync('/bin/bash', ['-c', 'source "$1"; cmd_done', 'bash', script], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...gitEnv(),
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_DIR: stubDir,
      STUB_GH_FAILS: opts.ghFails ? '1' : '0',
      STUB_GH_LOOKUP_FAILS: opts.lookupFails ? '1' : '0',
      // Dummy values switch neon_enabled on; the pnpm stub records the delete.
      ...(opts.neon ? { NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'test-project' } : {}),
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
    expect(r.out).toContain("WARN: Keeping 'kaupo/hon-2-b': commits after the merge of PR #2")
  })

  it('deletes a `gh pr checkout` branch pr<N> whose tip equals PR N head', () => {
    const tip = squashMerged('pr707', 'c.txt')
    writePrs([{ number: 707, headRefName: 'kaupo/hon-627-scan', headRefOid: tip }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('pr707 (squash #707)')
  })

  it('keeps pr<N>, with a WARN, when the PR head cannot be fetched to compare', () => {
    squashMerged('pr708', 'd.txt')
    writePrs([{ number: 708, headRefName: 'someone/else', headRefOid: 'f'.repeat(40) }])

    const r = runDone(main)

    expect(branches()).toEqual(['main', 'pr708'])
    expect(r.out).toContain(
      "WARN: Keeping 'pr708': PR lookup failed: could not fetch the head of PR #708",
    )
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

  it('keeps an unmerged branch with no PR, and names it in the summary', () => {
    git(main, 'checkout', '-q', '-b', 'feat/wip')
    commit(main, 'f.txt')
    git(main, 'checkout', '-q', 'main')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['feat/wip', 'main'])
    expect(r.out).toMatch(/Kept:\n {2}feat\/wip: no PR found/)
    expect(r.out).not.toContain('WARN')
    expect(r.out).not.toContain('Nothing to clean up')
  })

  it('deletes no squash-merged branch when gh fails, and says so', () => {
    const tip = squashMerged('kaupo/hon-3-c', 'g.txt')
    writePrs([{ number: 3, headRefName: 'kaupo/hon-3-c', headRefOid: tip }])

    const r = runDone(main, { ghFails: true })

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-3-c', 'main'])
    expect(r.out).toContain('WARN: Could not list merged PRs with gh')
    expect(r.out).toContain('kaupo/hon-3-c: merged PRs could not be listed')
  })

  it('does not touch a branch listed as an orchestrator worker', () => {
    const tip = squashMerged('auto/hon-4', 'h.txt')
    writePrs([{ number: 4, headRefName: 'auto/hon-4', headRefOid: tip }])
    writeOrchestratorStatus(['auto/hon-4'])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['auto/hon-4', 'main'])
    expect(r.out).toContain('auto/hon-4: orchestrator worker')
    expect(ghCalls().join('\n')).not.toContain('auto/hon-4')
  })

  it('names a branch checked out in a worktree outside the worktree base', () => {
    git(main, 'branch', 'feat/elsewhere')
    git(main, 'worktree', 'add', '-q', path.join(tmp, 'elsewhere'), 'feat/elsewhere')

    const r = runDone(main)

    expect(branches()).toEqual(['feat/elsewhere', 'main'])
    expect(r.out).toContain('feat/elsewhere: checked out in a worktree')
  })

  it('prints "Nothing to clean up" when only main remains', () => {
    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('Nothing to clean up.')
  })
})

describe('wt done per-branch PR lookup (HON-1072)', () => {
  it('deletes a branch whose merged PR is older than the bulk window, tip equal to its head', () => {
    const tip = squashMerged('kaupo/hon-627-scan', 'w1.txt')
    writePrs([{ number: 707, headRefName: 'kaupo/hon-627-scan', headRefOid: tip, old: true }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('kaupo/hon-627-scan (squash #707)')
    expect(ghCalls()).toContainEqual(expect.stringContaining('--head kaupo/hon-627-scan'))
  })

  it('deletes pr<N> whose tip is an ancestor of PR N head, fetching the head from origin', () => {
    const tip = squashMerged('pr688', 'w2.txt')
    // The PR got a commit after `gh pr checkout`; it exists only on origin.
    const other = cloneOrigin()
    git(other, 'fetch', '-q', main, 'pr688')
    git(other, 'checkout', '-q', '-b', 'pr-head', 'FETCH_HEAD')
    const head = commit(other, 'w2-late.txt')
    git(other, 'push', '-q', 'origin', 'HEAD:refs/pull/688/head')
    writePrs([{ number: 688, headRefName: 'kaupo/hon-688', headRefOid: head, old: true }])
    expect(tip).not.toBe(head)

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('pr688 (squash #688, PR had later commits)')
    expect(ghCalls()).toContainEqual(expect.stringContaining('gh pr view 688'))
  })

  it('deletes a recent pr<N> behind its PR head from the bulk list alone', () => {
    squashMerged('pr768', 'w3.txt')
    git(main, 'checkout', '-q', '-b', 'pr-head', 'pr768')
    const head = commit(main, 'w3-late.txt')
    git(main, 'checkout', '-q', 'main')
    git(main, 'branch', '-q', '-D', 'pr-head')
    writePrs([{ number: 768, headRefName: 'kaupo/hon-768', headRefOid: head }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('pr768 (squash #768, PR had later commits)')
    expect(ghCalls()).not.toContainEqual(expect.stringContaining('gh pr view'))
  })

  it('keeps a branch with a commit its old merged PR lacks, with "commits after the merge"', () => {
    const tip = squashMerged('kaupo/hon-20-t', 'w4.txt')
    writePrs([{ number: 20, headRefName: 'kaupo/hon-20-t', headRefOid: tip, old: true }])
    git(main, 'checkout', '-q', 'kaupo/hon-20-t')
    commit(main, 'w4-late.txt')
    git(main, 'checkout', '-q', 'main')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-20-t', 'main'])
    expect(r.out).toContain("WARN: Keeping 'kaupo/hon-20-t': commits after the merge of PR #20")
    expect(r.out).toMatch(/Kept:\n {2}kaupo\/hon-20-t: commits after the merge of PR #20/)
  })

  it('keeps branches whose PR is open or closed unmerged, and names the reason', () => {
    git(main, 'checkout', '-q', '-b', 'feat/open')
    const open = commit(main, 'w5.txt')
    git(main, 'checkout', '-q', '-b', 'feat/closed', 'main')
    const closed = commit(main, 'w6.txt')
    git(main, 'checkout', '-q', 'main')
    writePrs([
      { number: 30, headRefName: 'feat/open', headRefOid: open, state: 'OPEN' },
      { number: 31, headRefName: 'feat/closed', headRefOid: closed, state: 'CLOSED' },
    ])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['feat/closed', 'feat/open', 'main'])
    expect(r.out).toContain('feat/open: PR #30 open')
    expect(r.out).toContain('feat/closed: PR #31 closed unmerged')
  })

  it('keeps a branch with a WARN when its own lookup fails', () => {
    const tip = squashMerged('kaupo/hon-21-u', 'w7.txt')
    writePrs([{ number: 21, headRefName: 'kaupo/hon-21-u', headRefOid: tip, old: true }])

    const r = runDone(main, { lookupFails: true })

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-21-u', 'main'])
    expect(r.out).toContain("WARN: Keeping 'kaupo/hon-21-u': PR lookup failed")
  })
})

describe('wt done counts only PRs merged into main (HON-1079)', () => {
  it('keeps a branch whose PR merged into another base, from the bulk list', () => {
    const tip = unmergedBranch('kaupo/hon-40-child', 'x1.txt')
    writePrs([
      {
        number: 40,
        headRefName: 'kaupo/hon-40-child',
        headRefOid: tip,
        baseRefName: 'feat/parent',
      },
    ])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-40-child', 'main'])
    expect(r.out).toMatch(
      /Kept:\n {2}kaupo\/hon-40-child: PR #40 merged into feat\/parent, not main/,
    )
  })

  it('keeps a branch whose old PR merged into another base, from its own lookup', () => {
    const tip = unmergedBranch('kaupo/hon-41-child', 'x2.txt')
    writePrs([
      {
        number: 41,
        headRefName: 'kaupo/hon-41-child',
        headRefOid: tip,
        baseRefName: 'feat/parent',
        old: true,
      },
    ])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['kaupo/hon-41-child', 'main'])
    expect(r.out).toContain('kaupo/hon-41-child: PR #41 merged into feat/parent, not main')
    expect(ghCalls()).toContainEqual(expect.stringContaining('--head kaupo/hon-41-child'))
  })

  it('keeps pr<N> when PR N merged into another base', () => {
    const tip = unmergedBranch('pr742', 'x3.txt')
    writePrs([
      { number: 742, headRefName: 'kaupo/hon-742', headRefOid: tip, baseRefName: 'feat/parent' },
    ])

    const r = runDone(main)

    expect(branches()).toEqual(['main', 'pr742'])
    expect(r.out).toContain('pr742: PR #742 merged into feat/parent, not main')
  })

  it('keeps the worktree of a branch whose PR merged into another base', () => {
    const tip = unmergedBranch('kaupo/hon-42-child', 'x4.txt')
    writePrs([
      {
        number: 42,
        headRefName: 'kaupo/hon-42-child',
        headRefOid: tip,
        baseRefName: 'feat/parent',
      },
    ])
    const dir = addWorktree('kaupo/hon-42-child')

    const r = runDone(main, { neon: true })

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(true)
    expect(neonDeletes()).toHaveLength(0)
    expect(r.out).toContain('kaupo/hon-42-child: PR #42 merged into feat/parent, not main')
  })

  it('inside a worktree whose PR merged into another base removes nothing', () => {
    const tip = unmergedBranch('kaupo/hon-43-child', 'x5.txt')
    writePrs([
      {
        number: 43,
        headRefName: 'kaupo/hon-43-child',
        headRefOid: tip,
        baseRefName: 'feat/parent',
      },
    ])
    const dir = addWorktree('kaupo/hon-43-child')

    const r = runDone(dir)

    expect(r.status).toBe(1)
    expect(r.out).toContain(
      "Keeping 'kaupo/hon-43-child': PR #43 merged into feat/parent, not main — nothing removed",
    )
    expect(fs.existsSync(dir)).toBe(true)
  })
})

describe('wt done from another repository (HON-1079)', () => {
  it('acts on the checkout that holds the script, says so, and leaves the current repo alone', () => {
    const tip = squashMerged('kaupo/hon-44-a', 'y1.txt')
    writePrs([{ number: 44, headRefName: 'kaupo/hon-44-a', headRefOid: tip }])
    const elsewhere = path.join(tmp, 'elsewhere')
    git(tmp, 'init', '-q', '-b', 'main', elsewhere)
    commit(elsewhere, 'other.txt')
    git(elsewhere, 'branch', 'merged-here')
    git(elsewhere, 'checkout', '-q', '-b', 'feat/elsewhere')

    const r = runDone(elsewhere)

    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain(
      `Acting on the wobblepot checkout at ${main} — the current directory is not in it`,
    )
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('kaupo/hon-44-a (squash #44)')
    expect(git(elsewhere, 'branch', '--show-current')).toBe('feat/elsewhere')
    expect(
      git(elsewhere, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort(),
    ).toEqual(['feat/elsewhere', 'main', 'merged-here'])
  })

  it('from inside the repository says nothing about acting elsewhere', () => {
    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(r.out).not.toContain('Acting on the wobblepot checkout')
  })
})

describe('wt done failed pull (HON-1079)', () => {
  it('aborts the rebase and removes nothing when local main conflicts with origin', () => {
    const tip = squashMerged('kaupo/hon-45-a', 'z1.txt')
    writePrs([{ number: 45, headRefName: 'kaupo/hon-45-a', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-45-a')
    conflictMainWithOrigin()

    const r = runDone(main, { neon: true })

    expect(r.status).toBe(1)
    expect(r.out).toContain('the pull rebase was aborted — nothing removed')
    expect(rebaseInProgress()).toBe(false)
    expect(git(main, 'branch', '--show-current')).toBe('main')
    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-45-a', 'main'])
    expect(neonDeletes()).toHaveLength(0)
  })

  it('from inside a merged worktree keeps that worktree when the pull fails', () => {
    const tip = squashMerged('kaupo/hon-46-a', 'z2.txt')
    writePrs([{ number: 46, headRefName: 'kaupo/hon-46-a', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-46-a')
    conflictMainWithOrigin()

    const r = runDone(dir)

    expect(r.status).toBe(1)
    expect(r.out).toContain('the pull rebase was aborted — nothing removed')
    expect(rebaseInProgress()).toBe(false)
    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-46-a', 'main'])
  })

  it('stops without touching a rebase already in progress in the main checkout', () => {
    const tip = squashMerged('kaupo/hon-47-a', 'z3.txt')
    writePrs([{ number: 47, headRefName: 'kaupo/hon-47-a', headRefOid: tip }])
    commit(main, 'z3-local.txt')
    // Stops at an `edit` step, so the working tree is clean and only the
    // rebase state marks it.
    execFileSync('git', ['rebase', '-q', '-i', 'HEAD~1'], {
      cwd: main,
      env: { ...gitEnv(), GIT_SEQUENCE_EDITOR: 'sed -i.bak 1s/^pick/edit/' },
    })
    expect(rebaseInProgress()).toBe(true)

    const r = runDone(main)

    expect(r.status).toBe(1)
    expect(r.out).toContain('A rebase is in progress in the main checkout')
    expect(rebaseInProgress()).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-47-a', 'main'])
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

  it('removes the worktree of a branch merged with a merge commit, then deletes the branch', () => {
    git(main, 'checkout', '-q', '-b', 'kaupo/hon-11-j')
    const tip = commit(main, 'p.txt')
    git(main, 'checkout', '-q', 'main')
    const dir = addWorktree('kaupo/hon-11-j')
    // Merged on origin only, so the merge reaches the main checkout through
    // wt done's own pull, as a GitHub "Create a merge commit" does.
    const other = cloneOrigin()
    git(other, 'fetch', '-q', main, 'kaupo/hon-11-j:kaupo/hon-11-j')
    git(other, 'merge', '-q', '--no-ff', '-m', 'Merge PR #11', 'kaupo/hon-11-j')
    git(other, 'push', '-q', 'origin', 'main')
    writePrs([{ number: 11, headRefName: 'kaupo/hon-11-j', headRefOid: tip }])

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(branches()).toEqual(['main'])
    expect(r.out).toContain('kaupo/hon-11-j (merged)')
  })

  it('keeps the worktree of a fresh branch with no commits and no PR', () => {
    git(main, 'branch', 'feat/fresh')
    const dir = addWorktree('feat/fresh')

    const r = runDone(main)

    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['feat/fresh', 'main'])
    expect(r.out).toContain('feat/fresh: not merged')
  })

  it('keeps the worktree of a branch with a commit after its squash merge', () => {
    const tip = squashMerged('kaupo/hon-12-k', 'q.txt')
    writePrs([{ number: 12, headRefName: 'kaupo/hon-12-k', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-12-k')
    commit(dir, 'q-late.txt')

    const r = runDone(main)

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(true)
    expect(branches()).toEqual(['kaupo/hon-12-k', 'main'])
    expect(r.out).toContain('kaupo/hon-12-k: commits after the merge of PR #12')
  })

  it('deletes the Neon branch of a removed worktree only', () => {
    const merged = squashMerged('kaupo/hon-15-n', 't.txt')
    const stale = squashMerged('kaupo/hon-16-o', 'u.txt')
    writePrs([
      { number: 15, headRefName: 'kaupo/hon-15-n', headRefOid: merged },
      { number: 16, headRefName: 'kaupo/hon-16-o', headRefOid: stale },
    ])
    addWorktree('kaupo/hon-15-n')
    commit(addWorktree('kaupo/hon-16-o'), 'u-late.txt')

    const r = runDone(main, { neon: true })

    expect(r.status, r.out).toBe(0)
    expect(neonDeletes()).toHaveLength(1)
    expect(neonDeletes()[0]).toContain('branches delete kaupo--hon-15-n ')
  })

  it('keeps every worktree when gh fails', () => {
    const tip = squashMerged('kaupo/hon-13-l', 'r.txt')
    writePrs([{ number: 13, headRefName: 'kaupo/hon-13-l', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-13-l')

    const r = runDone(main, { ghFails: true })

    expect(r.status, r.out).toBe(0)
    expect(fs.existsSync(dir)).toBe(true)
    expect(r.out).toContain('kaupo/hon-13-l: merged PRs could not be listed')
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

  it('inside a worktree with a commit after its squash merge removes nothing', () => {
    const tip = squashMerged('kaupo/hon-14-m', 's.txt')
    writePrs([{ number: 14, headRefName: 'kaupo/hon-14-m', headRefOid: tip }])
    const dir = addWorktree('kaupo/hon-14-m')
    commit(dir, 's-late.txt')

    const r = runDone(dir)

    expect(r.status).toBe(1)
    expect(r.out).toContain(
      "Keeping 'kaupo/hon-14-m': commits after the merge of PR #14 — nothing removed",
    )
    expect(fs.existsSync(dir)).toBe(true)
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

  it('from a subdirectory of the main checkout runs as from its root', () => {
    const tip = squashMerged('kaupo/hon-17-p', 'v.txt')
    writePrs([{ number: 17, headRefName: 'kaupo/hon-17-p', headRefOid: tip }])
    const sub = path.join(main, 'sub')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(sub, 'keep.txt'), 'x')
    git(main, 'add', 'sub/keep.txt')
    git(main, 'commit', '-q', '-m', 'add sub')
    git(main, 'push', '-q', 'origin', 'main')

    const r = runDone(sub)

    expect(r.status, r.out).toBe(0)
    expect(branches()).toEqual(['main'])
    expect(r.out).not.toContain('cd ')
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
