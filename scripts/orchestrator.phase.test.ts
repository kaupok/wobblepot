import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  orchestrator,
  worktreeClaude,
  shellFunctionBody,
  classify,
  runHarness,
  prForBranch,
  commitStatus,
  ciState,
  type PrState,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  // The harness keeps orchestrator.sh's `set -e` on (only `-u` is relaxed), so a
  // statement that returns non-zero on one of these paths aborts mid-function
  // and the trailing log line never appears. That is the ee9ad31 defect class.
  describe('errexit safety under production shell semantics', () => {
    it.each(['OPEN', 'CLOSED', 'NONE'] as PrState[])(
      'runs handle_success to completion with a %s PR',
      (pr) => {
        expect(classify(3, 'pr-review', pr, 'unknown')).toContain(
          'Preserved worktree and branch for HON-999',
        )
      },
    )

    it('runs the gated path to completion', () => {
      expect(classify(0, 'planning', 'NONE', 'unknown')).toContain('CLEANUP:test-branch:false')
    })
  })

  // These drive the real helpers against fixture `gh` output. The
  // classification tests above stub them out, so without this block the jq
  // expression and the bucket rules would be untested — and `.[0]` on an empty
  // result really did once yield a PR numbered "null".
  describe('pr_for_branch', () => {
    it('emits nothing when no PR matches the branch', () => {
      expect(prForBranch([])).toBe('')
    })

    it('emits state, number and url as TSV', () => {
      const out = prForBranch([{ state: 'OPEN', number: 650, url: 'https://x/650' }])

      expect(out).toBe('OPEN\t650\thttps://x/650')
    })
  })

  describe('pr_ci_state', () => {
    it('is green when every check passed or was skipped', () => {
      expect(ciState(['pass', 'skipping', 'pass'])).toBe('green')
    })

    it('is pending while any check is still running', () => {
      expect(ciState(['pass', 'pending'])).toBe('pending')
    })

    it('is failing for a failed or cancelled check', () => {
      expect(ciState(['pass', 'fail'])).toBe('failing')
      expect(ciState(['cancel'])).toBe('failing')
    })

    it('is unknown when no checks were reported', () => {
      expect(ciState([])).toBe('unknown')
    })

    // HON-600: Vercel's commit status stuck at "deploying" for 9 h on PR #678
    // after the deployment was already Ready. Reading that as `pending` made
    // three finished, green PRs look unfinished. A third-party status (empty
    // `workflow`) is therefore exempt from the gate while pending — and only
    // then, because ci.yml runs no `next build`, so a Vercel *failure* is the
    // one build gate this repo has.
    it('is green when a stuck third-party status is the only thing pending', () => {
      expect(ciState(['pass', 'skipping', commitStatus('pending')])).toBe('green')
    })

    it('is failing when a third-party status reports a failed build', () => {
      expect(ciState(['pass', commitStatus('fail')])).toBe('failing')
      expect(ciState(['pass', commitStatus('cancel')])).toBe('failing')
    })

    it('is pending while an Actions job runs, whatever the third-party status says', () => {
      expect(ciState(['pass', 'pending', commitStatus('pending')])).toBe('pending')
      expect(ciState(['pass', 'pending', commitStatus('pass')])).toBe('pending')
    })

    // Exempting the only row that reported leaves nothing to judge. "unknown"
    // is the honest answer — no Actions job has spoken yet — and it keeps the
    // stranded-PR comment from claiming CI is green on no evidence.
    it('is unknown when only a pending third-party status has reported', () => {
      expect(ciState([commitStatus('pending')])).toBe('unknown')
    })
  })

  // ─── HON-576: phase detection vs. the branch's upstream ───────────────────
  // e8960e6 started creating autonomous worktrees from an explicit `origin/main`
  // start ref. git's branch.autoSetupMerge turns a remote-tracking start ref
  // into the new branch's upstream, so every phase heuristic — all of which
  // read "has an upstream" as "has been pushed" — reported pr-review from
  // worktree creation onward, before a single commit existed.
  //
  // The fixtures below create the branch the OLD way (no --no-track) on
  // purpose: that is what reproduces the bogus upstream, so these assertions
  // pin the predicate rather than the branch-creation flag. The flag is
  // asserted separately, statically.
  describe('phase detection on an unpushed branch', () => {
    const fixtureRoots: string[] = []

    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      // Full isolation: a developer's global config (autoSetupMerge, hooks,
      // gpg signing, init.defaultBranch) must not decide what these fixtures
      // reproduce.
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'harness',
      GIT_AUTHOR_EMAIL: 'harness@example.test',
      GIT_COMMITTER_NAME: 'harness',
      GIT_COMMITTER_EMAIL: 'harness@example.test',
    }

    function git(cwd: string, ...args: string[]): string {
      // stderr piped, not inherited: one assertion below expects git to fail,
      // and its `fatal:` line would otherwise land in the suite output as if
      // something had gone wrong.
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: gitEnv,
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }

    const BRANCH = 'henri/hon-576-fixture'

    type Fixture = { repo: string; wt: string; branch: string; log: string }

    /**
     * A miniature of the real layout: a bare origin, a repo whose `main` tracks
     * it, and a worktree branched from `origin/main` — the shape
     * worktree-claude.sh produces.
     */
    function makeFixture(
      opts: {
        commits?: number
        dirty?: boolean
        pushed?: boolean
        staleRemoteRef?: boolean
        originAhead?: number
        log?: string[]
      } = {},
    ): Fixture {
      const {
        commits = 0,
        dirty = false,
        pushed = false,
        staleRemoteRef = false,
        originAhead = 0,
        log = [],
      } = opts
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hon576-phase-'))
      fixtureRoots.push(root)

      const origin = path.join(root, 'origin.git')
      const repo = path.join(root, 'repo')
      const wt = path.join(root, 'wt')

      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: gitEnv })
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: gitEnv })
      fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n')
      git(repo, 'add', 'seed.txt')
      git(repo, 'commit', '-qm', 'seed')
      git(repo, 'remote', 'add', 'origin', origin)
      git(repo, 'push', '-q', 'origin', 'main')

      // A previous run of this issue that pushed and was then cleaned up.
      // `cleanup_worker_worktree` deletes the local branch; nothing prunes
      // refs/remotes, so the ref outlives the run under the SAME deterministic
      // branch name the next attempt will use.
      if (staleRemoteRef) {
        git(repo, 'branch', 'previous-run', 'main')
        const scratch = path.join(root, 'scratch')
        git(repo, 'worktree', 'add', '-q', scratch, 'previous-run')
        fs.writeFileSync(path.join(scratch, 'previous-work.txt'), 'from run 1\n')
        git(scratch, 'add', 'previous-work.txt')
        git(scratch, 'commit', '-qm', 'work from the previous run')
        git(scratch, 'push', '-q', 'origin', `previous-run:${BRANCH}`)
        git(repo, 'fetch', '-q', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`)
        git(repo, 'worktree', 'remove', '--force', scratch)
        git(repo, 'branch', '-D', 'previous-run')
      }

      // Merges the operator has not pulled (HON-601). Every successful run
      // advances origin/main; nothing in the unattended pipeline advances
      // refs/heads/main, so the primary checkout's `main` sits at whatever the
      // operator last pulled — here, the seed.
      if (originAhead > 0) {
        git(repo, 'branch', 'origin-ahead', 'main')
        const scratch = path.join(root, 'origin-ahead-wt')
        git(repo, 'worktree', 'add', '-q', scratch, 'origin-ahead')
        for (let n = 1; n <= originAhead; n++) {
          fs.writeFileSync(path.join(scratch, `upstream-${n}.txt`), `${n}\n`)
          git(scratch, 'add', `upstream-${n}.txt`)
          git(scratch, 'commit', '-qm', `another issue's merge ${n}`)
        }
        git(scratch, 'push', '-q', 'origin', 'origin-ahead:main')
        git(repo, 'worktree', 'remove', '--force', scratch)
        git(repo, 'branch', '-D', 'origin-ahead')
        // Explicit refspec rather than a bare `git fetch origin main`: the
        // remote-tracking ref must move and refs/heads/main must not, and that
        // has to hold whatever a fetch refspec or config would otherwise do.
        git(repo, 'fetch', '-q', 'origin', 'main:refs/remotes/origin/main')
      }

      // Deliberately WITHOUT --no-track — see the describe() comment.
      git(repo, 'worktree', 'add', '-q', '-b', BRANCH, wt, 'origin/main')

      for (let n = 1; n <= commits; n++) {
        fs.writeFileSync(path.join(wt, `work-${n}.txt`), `${n}\n`)
        git(wt, 'add', `work-${n}.txt`)
        git(wt, 'commit', '-qm', `work ${n}`)
      }
      if (pushed) git(wt, 'push', '-q', 'origin', BRANCH)
      if (dirty) fs.writeFileSync(path.join(wt, 'uncommitted.txt'), 'in progress\n')

      const logFile = path.join(root, 'worker.log')
      fs.writeFileSync(logFile, log.length ? `${log.join('\n')}\n` : '')

      return { repo, wt, branch: BRANCH, log: logFile }
    }

    afterAll(() => {
      for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true })
    })

    /** orchestrator.sh's detect_phase — the value that reaches the outcome log. */
    const phase = (f: Fixture) => runHarness('detect-phase', f.wt, f.branch, f.log).trim()

    /** worktree-claude.sh's wt_detect_phase — the `wt status` / `wt watch` column. */
    const wtPhase = (f: Fixture, ahead: number, dirty: boolean) =>
      runHarness('wt-detect-phase', f.log, f.wt, f.branch, String(ahead), dirty ? '+' : '').trim()

    const STARTED = ['Starting autonomous Claude Code']

    it('reproduces the upstream git sets from an origin/main start ref', () => {
      // Guards the fixture itself: if a future git stops configuring the
      // upstream here, every assertion below would pass vacuously.
      const f = makeFixture({})

      expect(git(f.wt, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/main')
    })

    it('--no-track suppresses that upstream', () => {
      // The mechanism worktree-claude.sh's fix relies on, asserted against the
      // git actually installed rather than taken on faith.
      const f = makeFixture({})
      const wt2 = path.join(f.repo, '..', 'wt-no-track')
      // Same argument order as worktree-claude.sh's own call.
      git(
        f.repo,
        'worktree',
        'add',
        '-q',
        '-b',
        'henri/hon-576-untracked',
        '--no-track',
        wt2,
        'origin/main',
      )

      expect(() => git(wt2, 'rev-parse', '--abbrev-ref', '@{upstream}')).toThrow()
    })

    // The reported regression: 0 commits, dirty tree, bogus upstream.
    it('reports implementing for a fresh worktree with uncommitted work', () => {
      const f = makeFixture({ dirty: true, log: STARTED })

      expect(phase(f)).toBe('implementing')
      expect(wtPhase(f, 0, true)).toBe('Implementing')
    })

    it('falls back to the log — never pr-review — for a fresh, clean worktree', () => {
      const started = makeFixture({ log: STARTED })
      const silent = makeFixture({})

      expect(phase(started)).toBe('planning')
      expect(phase(silent)).toBe('initializing')
      expect(wtPhase(started, 0, false)).toBe('Planning')
      expect(wtPhase(silent, 0, false)).toBe('Initializing')
    })

    it('reports implementing for commits plus a dirty tree', () => {
      const f = makeFixture({ commits: 2, dirty: true, log: STARTED })

      expect(phase(f)).toBe('implementing')
      expect(wtPhase(f, 2, true)).toBe('Implementing')
    })

    it('reports reviewing for commits that are clean but unpushed', () => {
      const f = makeFixture({ commits: 2, log: STARTED })

      expect(phase(f)).toBe('reviewing')
      expect(wtPhase(f, 2, false)).toBe('Reviewing')
    })

    // The other half of the fix: a genuinely pushed branch must still read
    // pr-review, or the correction has simply moved the blind spot.
    it('still reports pr-review once the branch has actually been pushed', () => {
      const f = makeFixture({ commits: 2, pushed: true, log: STARTED })

      expect(git(f.wt, 'show-ref', `refs/remotes/origin/${f.branch}`)).toContain(f.branch)
      expect(phase(f)).toBe('pr-review')
      expect(wtPhase(f, 2, false)).toBe('PR review')
    })

    // A remote ref alone only proves "a remote branch by this name exists
    // locally". Branch names are deterministic per issue and nothing in the
    // flow prunes refs/remotes, so a re-picked issue whose earlier run pushed
    // inherits a stale ref — and reproduces the very symptom this PR fixes.
    describe('a remote ref left behind by a previous run', () => {
      it('does not make a fresh worktree read as pr-review', () => {
        const f = makeFixture({ staleRemoteRef: true, dirty: true, log: STARTED })

        expect(git(f.wt, 'show-ref', `refs/remotes/origin/${f.branch}`)).toContain(f.branch)
        expect(phase(f)).toBe('implementing')
        expect(wtPhase(f, 0, true)).toBe('Implementing')
      })

      it('does not make the re-run’s own unpushed commits read as pr-review', () => {
        const f = makeFixture({ staleRemoteRef: true, commits: 2, log: STARTED })

        expect(phase(f)).toBe('reviewing')
        expect(wtPhase(f, 2, false)).toBe('Reviewing')
      })

      it('yields to a real push that supersedes it', () => {
        // Force-pushing over the stale ref is what the re-run actually does.
        const f = makeFixture({ staleRemoteRef: true, commits: 2, log: STARTED })
        git(f.wt, 'push', '-q', '--force', 'origin', f.branch)

        expect(phase(f)).toBe('pr-review')
        expect(wtPhase(f, 2, false)).toBe('PR review')
      })
    })

    it('still reports pr-review after a commit lands on top of what was pushed', () => {
      // The worker pushes, opens a PR, then commits a review fix. The remote
      // tip is still an ancestor of HEAD, so the run is still at PR stage.
      const f = makeFixture({ commits: 1, pushed: true, log: STARTED })
      fs.writeFileSync(path.join(f.wt, 'review-fix.txt'), 'fix\n')
      git(f.wt, 'add', 'review-fix.txt')
      git(f.wt, 'commit', '-qm', 'fix: Address review feedback')

      expect(phase(f)).toBe('pr-review')
      expect(wtPhase(f, 2, false)).toBe('PR review')
    })

    // Strategy 1 sits above the git heuristics in both implementations; the
    // HON-576 edit is below it and must not have reordered them.
    it.each([
      ['[commit:complete]', 'pr-review', 'PR review'],
      ['[merge:complete]', 'done', 'Done'],
    ])('lets the %s marker win over the git state', (marker, expected, wtExpected) => {
      const f = makeFixture({ dirty: true, log: [...STARTED, marker] })

      expect(phase(f)).toBe(expected)
      expect(wtPhase(f, 0, true)).toBe(wtExpected)
    })

    // The workflow emits markers beyond the seven either function names —
    // [next-issue:complete], [triage-pr-comments:complete] and friends. Neither
    // should blank the column; both fall through to the git heuristics.
    it('falls through to the git state for an unrecognised marker', () => {
      const f = makeFixture({ dirty: true, log: [...STARTED, '[triage-pr-comments:complete]'] })

      expect(phase(f)).toBe('implementing')
      expect(wtPhase(f, 0, true)).toBe('Implementing')
    })

    // HON-601: the counterpart defect. HON-576 fixed "has this branch been
    // pushed"; this is "how many commits has it produced". Both heuristics fed
    // the same phase column, and both reported a brand-new worktree as further
    // along than it was — here because the count was taken against the
    // operator's local `main`, which nothing in the unattended pipeline
    // advances, while every merge advances origin/main.
    describe('a local main the operator has not pulled', () => {
      /** orchestrator.sh's count_commits — the number handle_success gates on. */
      const countCommits = (f: Fixture) =>
        runHarness('count-commits', f.wt, f.branch, f.repo).trim()

      /** worktree-claude.sh's commits_ahead — what both display loops feed in. */
      const commitsAhead = (f: Fixture) => runHarness('wt-commits-ahead', f.wt).trim()

      it('reproduces the lag the fixture exists to model', () => {
        // Guards the fixture itself: without this, every assertion below would
        // pass on a fixture where local main and origin/main happen to agree.
        const f = makeFixture({ originAhead: 2 })

        expect(git(f.wt, 'rev-list', '--count', 'main..HEAD').trim()).toBe('2')
        expect(git(f.wt, 'rev-list', '--count', 'refs/remotes/origin/main..HEAD').trim()).toBe('0')
      })

      // The reported regression: `wt watch` showed Reviewing for a worker that
      // had not run a line of Claude, because two unpulled merges read as two
      // commits on a clean tree.
      it('does not make a fresh worktree read as reviewing', () => {
        const started = makeFixture({ originAhead: 2, log: STARTED })
        const silent = makeFixture({ originAhead: 2 })

        expect(phase(started)).toBe('planning')
        expect(phase(silent)).toBe('initializing')
        expect(wtPhase(started, Number(commitsAhead(started)), false)).toBe('Planning')
        expect(wtPhase(silent, Number(commitsAhead(silent)), false)).toBe('Initializing')
      })

      it('reports implementing for a fresh worktree with uncommitted work', () => {
        const f = makeFixture({ originAhead: 2, dirty: true, log: STARTED })

        expect(phase(f)).toBe('implementing')
        expect(wtPhase(f, Number(commitsAhead(f)), true)).toBe('Implementing')
      })

      // The other half: the fix must not over-correct. A worker that really did
      // commit still has to reach reviewing, and then pr-review once pushed.
      it('still reports reviewing for a commit that is clean and unpushed', () => {
        const f = makeFixture({ originAhead: 2, commits: 1, log: STARTED })

        expect(phase(f)).toBe('reviewing')
        expect(wtPhase(f, Number(commitsAhead(f)), false)).toBe('Reviewing')
      })

      it('still reports pr-review once that commit is pushed', () => {
        const f = makeFixture({ originAhead: 2, commits: 1, pushed: true, log: STARTED })

        expect(phase(f)).toBe('pr-review')
        expect(wtPhase(f, Number(commitsAhead(f)), false)).toBe('PR review')
      })

      // count_commits is not just a display value: handle_success routes a
      // 0-commit clean exit to GATED (issue back to Queued, artifacts cleaned)
      // and anything else to STRANDED (Stranded label, worktree and Neon branch
      // preserved, a comment about a PR that never existed).
      it('counts only the worker’s own commits', () => {
        expect(countCommits(makeFixture({ originAhead: 2 }))).toBe('0')
        expect(countCommits(makeFixture({ originAhead: 2, commits: 3 }))).toBe('3')
        expect(commitsAhead(makeFixture({ originAhead: 2 }))).toBe('0')
        expect(commitsAhead(makeFixture({ originAhead: 2, commits: 3 }))).toBe('3')
      })

      // HON-1077: RETRY and the finish attempt remove the worktree and keep
      // the branch. A respawn that dies before `git worktree add` leaves that
      // state, and a 0 here sent it to handle_failure's `git branch -D`.
      it('counts a kept branch from the main checkout when its worktree is gone', () => {
        const f = makeFixture({ originAhead: 2, commits: 2 })
        git(f.repo, 'worktree', 'remove', '--force', f.wt)

        expect(fs.existsSync(f.wt)).toBe(false)
        expect(countCommits(f)).toBe('2')
      })

      it('answers 0 when the worktree and the branch are both gone', () => {
        // A resolved question, not an unanswerable one: the run was cleaned
        // up. handle_success's merged-PR probe runs before the gate.
        const f = makeFixture({ originAhead: 2, commits: 2 })
        git(f.repo, 'worktree', 'remove', '--force', f.wt)
        git(f.repo, 'branch', '-D', f.branch)

        expect(countCommits(f)).toBe('0')
        expect(runHarness('wt-commits-ahead', f.wt).trim()).toBe('')
      })

      it('reports a kept branch with no base ref as -1', () => {
        const f = makeFixture({ originAhead: 2, commits: 2 })
        git(f.repo, 'worktree', 'remove', '--force', f.wt)
        git(f.repo, 'update-ref', '-d', 'refs/remotes/origin/main')

        expect(countCommits(f)).toBe('-1')
      })

      // The old base ref, refs/heads/main, is always present in the checkout the
      // orchestrator runs from, so rev-list could not fail and `|| echo 0` was
      // dead code. refs/remotes/origin/main can genuinely be absent — and 0 is
      // the value handle_success gates GATED on, which ends at `git branch -D`
      // plus the paired Neon branch. "Cannot tell" must not decide that.
      it('reports a missing base ref as -1, not as 0 commits', () => {
        const f = makeFixture({ originAhead: 2, commits: 2, log: STARTED })
        git(f.repo, 'update-ref', '-d', 'refs/remotes/origin/main')

        expect(countCommits(f)).toBe('-1')
      })

      it('strands rather than gates when the count is unavailable', () => {
        // -1 keeps every `-eq 0` gate false, so the run keeps its worktree,
        // branch and Neon branch instead of having them deleted.
        const out = classify(-1, 'implementing', 'NONE', 'unknown')

        expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s -1-commits')
        expect(out).not.toContain('GATED')
        // strand_worker preserves by never calling cleanup_worker_worktree.
        expect(out).not.toContain('CLEANUP:')
        expect(out).toContain('Preserved worktree and branch for HON-999')
      })

      // origin/main is not frozen for the length of a run: a sibling worker's
      // PR merges and the next `wt auto` fetch moves the ref. The count must
      // stay equal to this worker's own commits — a base ref that drifts would
      // just be the same bug with a different clock.
      it('keeps counting only its own commits when origin/main advances mid-run', () => {
        const f = makeFixture({ originAhead: 2, commits: 2, log: STARTED })
        const scratch = path.join(f.repo, '..', 'later-merge-wt')
        git(f.repo, 'worktree', 'add', '-q', '-b', 'later-merge', scratch, 'origin/main')
        fs.writeFileSync(path.join(scratch, 'later-merge.txt'), 'later\n')
        git(scratch, 'add', 'later-merge.txt')
        git(scratch, 'commit', '-qm', "a sibling worker's merge")
        git(scratch, 'push', '-q', 'origin', 'later-merge:main')
        git(f.repo, 'fetch', '-q', 'origin', 'main:refs/remotes/origin/main')
        git(f.repo, 'worktree', 'remove', '--force', scratch)

        expect(countCommits(f)).toBe('2')
        expect(commitsAhead(f)).toBe('2')
        expect(phase(f)).toBe('reviewing')
      })
    })

    describe('static guards', () => {
      // Every site that answers "has this branch been pushed", per file. Counted
      // rather than merely present: two of the four live inside interactive
      // render loops no test can reach, so reverting one individually has to
      // fail here or it fails nowhere.
      it.each([
        ['orchestrator.sh', orchestrator, 1],
        ['worktree-claude.sh', worktreeClaude, 2],
      ])(
        '%s tests the branch against its own remote ref at all %i site(s)',
        (_n, script, sites) => {
          const source = fs.readFileSync(script, 'utf8')

          expect(source).not.toContain("rev-parse --abbrev-ref '@{upstream}'")
          expect(
            source.match(/merge-base --is-ancestor "refs\/remotes\/origin\//g) ?? [],
          ).toHaveLength(sites)
        },
      )

      it('guards the PR-URL lookup with the same containment test', () => {
        // `wt status -v`, the one site that yields a URL rather than a word.
        const source = fs.readFileSync(worktreeClaude, 'utf8')

        expect(source).toContain(
          'pr_url=$(git -C "$wt_path" merge-base --is-ancestor "refs/remotes/origin/$w_branch" HEAD',
        )
      })

      it('routes both display call sites through the one helper', () => {
        // Fixing one site and leaving the other is the failure mode this issue
        // called out: `wt status` and `wt watch` each carried their own copy.
        const calls =
          fs.readFileSync(worktreeClaude, 'utf8').match(/phase=\$\(wt_detect_phase /g) ?? []

        expect(calls).toHaveLength(2)
      })

      // HON-601. Deliberately NOT `grep -c 'main\.\.HEAD' === 0`, which the fix
      // cannot satisfy: `refs/remotes/origin/main..HEAD` contains that substring.
      // The negative lookbehind states the real predicate — nothing measures
      // against LOCAL main — and it stays anchored on `main..HEAD`, so the two
      // `wt cleanup` helpers (`"main..$branch"`, deliberately left alone because
      // a human runs them from the primary checkout and they fail safe) are not
      // swept in.
      it.each([
        ['orchestrator.sh', orchestrator],
        ['worktree-claude.sh', worktreeClaude],
      ])('%s never measures a worktree against local main', (_n, script) => {
        const source = fs.readFileSync(script, 'utf8')

        expect(source.match(/(?<!origin\/)main\.\.HEAD/g) ?? []).toHaveLength(0)
      })

      // Five textually identical inline copies are what let the base ref drift
      // in the first place, so assert the routing, not just the absence.
      it('routes every orchestrator.sh count through the one helper', () => {
        const source = fs.readFileSync(orchestrator, 'utf8')

        for (const fn of ['report_worker_status', 'detect_phase', 'count_commits']) {
          const body = shellFunctionBody(source, fn)
          expect(body, `${fn}() should not count commits itself`).not.toContain('rev-list --count')
          expect(body, `${fn}() should call commits_ahead`).toContain('commits_ahead "')
        }
        expect(shellFunctionBody(source, 'commits_ahead')).toContain(
          'rev-list --count refs/remotes/origin/main..HEAD',
        )
        // HON-1077: a branch whose worktree is gone is counted from the main
        // checkout, against the same base ref.
        expect(shellFunctionBody(source, 'count_commits')).toContain('branch_commits_ahead "')
        expect(shellFunctionBody(source, 'branch_commits_ahead')).toContain(
          'rev-list --count "refs/remotes/origin/main..refs/heads/$2"',
        )
      })

      it('routes both worktree-claude.sh display loops through the one helper', () => {
        // `wt status` and `wt watch` each carried their own copy, and neither
        // render loop is reachable from a test — counted so reverting one
        // individually fails here or it fails nowhere.
        const source = fs.readFileSync(worktreeClaude, 'utf8')

        expect(source.match(/ahead=\$\(commits_ahead "\$wt_path"\)/g) ?? []).toHaveLength(2)
        expect(shellFunctionBody(source, 'commits_ahead')).toContain(
          'rev-list --count refs/remotes/origin/main..HEAD',
        )
      })

      it('creates autonomous worktrees with --no-track', () => {
        const line = fs
          .readFileSync(worktreeClaude, 'utf8')
          .split('\n')
          .find((l) => l.includes('worktree add -b') && l.includes('origin/main'))

        expect(line, 'the origin/main worktree add line is gone').toBeDefined()
        expect(line).toContain('--no-track')
      })
    })
  })
})
