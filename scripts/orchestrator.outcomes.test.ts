import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  scriptsDir,
  orchestrator,
  worktreeClaude,
  harness,
  harnessEnv,
  stripTimestamps,
  shellFunctionBody,
  classify,
  classifyTimeout,
  classifyError,
  runHarness,
  runHarnessEnv,
  type PrState,
  type CiState,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  // HON-573: a worker that exits cleanly has not necessarily shipped anything.
  // Only a run that reached phase=done — or one whose PR is demonstrably merged
  // — may be logged SUCCESS, because SUCCESS is what triggers cleanup of the
  // worktree, local branch and Neon branch.
  describe('handle_success outcome classification', () => {
    it('gates a clean exit that produced no commits', () => {
      const out = classify(0, 'planning', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 GATED')
      expect(out).toContain('0-commits phase=planning')
      expect(out).not.toContain('SUCCESS')
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('LABEL:Gated')
    })

    it('reports SUCCESS for a run that reached done', () => {
      const out = classify(4, 'done', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).toContain('4-commits phase=done')
      expect(out).not.toContain('STRANDED')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it('reports STRANDED — not SUCCESS — for commits with an open, unmerged PR', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('3-commits phase=pr-review pr=#650 ci=green')
      expect(out).not.toContain('SUCCESS')
    })

    it('preserves the worktree, branch and Neon branch when stranded', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      // cleanup_worker_worktree is what deletes all three. It must not be
      // called: those artifacts are exactly what finishing the run requires.
      expect(out).not.toContain('CLEANUP:')
      expect(out).toContain('resume with: wt resume test-branch')
      expect(out).toContain('LABEL:Stranded')
    })

    it('still reports SUCCESS when the phase lags behind a merged PR', () => {
      // detect_phase can miss a "[merge:complete]" marker. Confirming against
      // the PR keeps that from manufacturing a false stranding.
      const out = classify(3, 'pr-review', 'MERGED', 'green')

      expect(out).toContain('but PR #650 is merged — treating as success')
      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('STRANDED')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it('strands rather than guesses when the PR cannot be resolved', () => {
      // No PR found, or gh missing/unauthenticated — indistinguishable here.
      // A false SUCCESS deletes the branch, so the unknown case must strand.
      const out = classify(3, 'pr-review', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('pr=none ci=unknown')
      expect(out).not.toContain('CLEANUP:')
    })

    it('records the CI state so an operator can tell a merge-ready run apart', () => {
      expect(classify(2, 'pr-review', 'OPEN', 'failing')).toContain('pr=#650 ci=failing')
      expect(classify(2, 'pr-review', 'OPEN', 'pending')).toContain('pr=#650 ci=pending')
    })

    it('never logs SUCCESS for a closed-but-unmerged PR', () => {
      const out = classify(3, 'pr-review', 'CLOSED', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('SUCCESS')
    })

    it('reports SUCCESS for a merged PR even when the worktree is already gone', () => {
      // count_commits reads `refs/remotes/origin/main..HEAD` in the worktree;
      // once that is removed it returns 0. Resolving the PR before the 0-commit
      // gate is what keeps this from being labelled GATED and pushed back to
      // Queued after it shipped.
      const out = classify(0, 'planning', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('GATED')
      expect(out).not.toContain('LABEL:Gated')
      expect(out).not.toContain('RESTORE_QUEUED')
    })
  })

  // The Linear comment is the only place most operators see a stranding, so its
  // wording has to survive being pasted into a shell and must not describe a
  // closed PR as mergeable.
  describe('record_stranded operator instructions', () => {
    it('emits a bare PR number the shell will not read as a comment', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('gh pr merge --squash 650')
      // `#650` starts a comment: the argument is dropped and `gh pr merge`
      // resolves against whatever branch the operator's cwd is on.
      expect(out).not.toContain('gh pr merge --squash #650')
    })

    it('distinguishes a closed PR from an open one', () => {
      const out = classify(3, 'pr-review', 'CLOSED', 'green')

      expect(out).toContain('CLOSED, never merged')
      expect(out).not.toContain('**Open PR:**')
      // `gh pr merge` on a closed PR fails; reopening is the real next step.
      expect(out).not.toContain('gh pr merge')
      expect(out).toContain('gh pr reopen 650')
    })

    it('names the release command alongside the resume command', () => {
      // Nothing reclaims a preserved worktree, and `wt auto` hard-exits when one
      // already exists — so the operator has to be told how to release it.
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('resume with: wt resume test-branch')
      expect(out).toContain('release with: wt cleanup test-branch')
      expect(out).toContain('wt cleanup test-branch')
    })

    it('returns a stranded run with no PR to Queued', () => {
      // With no PR, Linear never moved the issue out of In Progress and
      // /auto-implement left it assigned — select_next_issue would skip it
      // forever. The Stranded label keeps the picker off it in the meantime.
      const out = classify(3, 'pr-review', 'NONE', 'unknown')

      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('LABEL:Stranded')
    })

    it('leaves the issue in In Review when a PR exists', () => {
      // Linear automation already moved it there, and that is the accurate
      // state — overwriting it with Queued would misreport an open PR.
      expect(classify(3, 'pr-review', 'OPEN', 'green')).not.toContain('RESTORE_QUEUED')
    })
  })

  // ─── HON-579: worker races on a single machine ────────────────────────────
  // Two independent failure modes surface only when the orchestrator runs more
  // than one worker: a shared settings.local.json.tmp that concurrent permission
  // syncs corrupt, and a branch->directory mapping that collapses `feat/foo-bar`
  // and `feat-foo/bar` onto the same worktree.
  describe('HON-579 worker races', () => {
    describe('sync_permissions temp file', () => {
      it.each([
        ['orchestrator.sh', orchestrator],
        ['worktree-claude.sh', worktreeClaude],
      ])('%s writes via mktemp, not a fixed .tmp path', (_n, script) => {
        const body = shellFunctionBody(fs.readFileSync(script, 'utf8'), 'sync_permissions')

        expect(body).toContain('mktemp')
        // The shared path two workers used to collide on.
        expect(body).not.toContain('settings.local.json.tmp')
        expect(body).not.toContain('$main_settings.tmp')
      })

      it('keeps the shared settings file valid JSON under concurrent syncs', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon579-perms-'))
        try {
          const main = path.join(dir, 'main')
          fs.mkdirSync(path.join(main, '.claude'), { recursive: true })
          const mainSettings = path.join(main, '.claude', 'settings.local.json')
          fs.writeFileSync(
            mainSettings,
            JSON.stringify({ permissions: { allow: ['Bash(base:*)'] } }),
          )

          // Each worktree carries the base permission plus its own new one.
          const workers = Array.from({ length: 12 }, (_v, i) => {
            const wt = path.join(dir, `wt-${i}`)
            fs.mkdirSync(path.join(wt, '.claude'), { recursive: true })
            fs.writeFileSync(
              path.join(wt, '.claude', 'settings.local.json'),
              JSON.stringify({ permissions: { allow: ['Bash(base:*)', `Bash(worker-${i}:*)`] } }),
            )
            return wt
          })

          // Real concurrency: N harness processes race on the one main file.
          const cmd = `${workers
            .map((wt) => `bash ${harness} sync-permissions ${main} ${wt} &`)
            .join('\n')}\nwait\n`
          execFileSync('bash', ['-c', cmd], { timeout: 60_000, env: harnessEnv() })

          // The bug installed truncated/interleaved JSON. The fix guarantees the
          // file always parses and never loses the pre-existing permission — the
          // read-modify-write can still drop a concurrent worker's addition, but
          // it can no longer corrupt the file.
          const parsed = JSON.parse(fs.readFileSync(mainSettings, 'utf8'))
          expect(parsed.permissions.allow).toContain('Bash(base:*)')
        } finally {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      })
    })

    describe('branch -> worktree directory mapping', () => {
      const normalize = (branch: string) => runHarness('normalize-branch', branch).trim()
      const worktreePath = (branch: string, base = '') =>
        runHarness('worktree-path', branch, base).trim()

      it('maps `/` to `--`, matching neon_branch_name', () => {
        expect(normalize('feat/foo-bar')).toBe('feat--foo-bar')
        expect(normalize('henritamm/hon-51-slug')).toBe('henritamm--hon-51-slug')
      })

      it('gives `feat/foo-bar` and `feat-foo/bar` distinct directories', () => {
        // The collision: `tr / -` mapped both to `feat-foo-bar`.
        expect(normalize('feat/foo-bar')).not.toBe(normalize('feat-foo/bar'))
      })

      it('derives the `--` path for a branch with no existing worktree', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hon579-wt-'))
        try {
          expect(worktreePath('feat/foo-bar', base)).toBe(path.join(base, 'feat--foo-bar'))
        } finally {
          fs.rmSync(base, { recursive: true, force: true })
        }
      })

      // The lookup above this fallback already resolves anything git has
      // registered, so a single-dash fallback could only fire on an
      // UNREGISTERED leftover — and handing that back is the very collision
      // this change removes.
      it('never hands back a stale single-dash directory', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hon579-wt-'))
        try {
          // The leftover `feat-foo/bar` would have created under the old mapping.
          fs.mkdirSync(path.join(base, 'feat-foo-bar'), { recursive: true })
          expect(worktreePath('feat/foo-bar', base)).toBe(path.join(base, 'feat--foo-bar'))
        } finally {
          fs.rmSync(base, { recursive: true, force: true })
        }
      })
    })

    it('orchestrator get_worktree_path uses the same `--` mapping', () => {
      // The copy replicated in orchestrator.sh must not drift back to `tr / -`.
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'get_worktree_path')

      expect(body).toContain('//--')
      expect(body).not.toContain("tr '/' '-'")
    })
  })

  // ─── HON-583: a timeout is not evidence the work is incomplete ────────────
  // monitor_workers used to call handle_failure directly on the WORKER_TIMEOUT
  // kill, and handle_failure never looks for a PR. HON-573 had made workers
  // wait for CI in-turn, so the usual thing a worker is doing when the clock
  // runs out is watching a finished, green PR — which was then triaged,
  // retried, and moved to Backlog with a `Needs attention` label while the PR
  // sat open and mergeable (HON-580 → #667, HON-581 → #669, both merged by
  // hand). handle_timeout probes first and routes on the answer.
  describe('handle_timeout outcome classification', () => {
    it('reports STRANDED — not TIMEOUT — for a kill with an open, unmerged PR', () => {
      const out = classifyTimeout(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('3-commits phase=pr-review pr=#650 ci=green')
      // The two things the old path did: label the run a failure, and triage it.
      // Matched on the outcome label, not the bare word — the comment body names
      // WORKER_TIMEOUT on purpose.
      expect(out).not.toContain('[OUTCOME] HON-999 TIMEOUT')
      expect(out).not.toContain('triage=')
      expect(out).not.toContain('HANDLE_FAILURE')
    })

    it('preserves the worktree, branch and Neon branch, and gates the issue', () => {
      const out = classifyTimeout(3, 'pr-review', 'OPEN', 'green')

      // Byte-identical bookkeeping to the exit-0 stranded path: no cleanup (which
      // is what deletes all three artifacts), the Stranded label, and In Review
      // left alone because Linear already moved it there.
      expect(out).not.toContain('CLEANUP:')
      expect(out).toContain('LABEL:Stranded')
      expect(out).not.toContain('RESTORE_QUEUED')
      expect(out).toContain('resume with: wt resume test-branch')
      expect(out).toContain('release with: wt cleanup test-branch')
    })

    it('reports SUCCESS when the PR is already merged', () => {
      // The kill landed after the merge — a merged PR is a finished cycle no
      // matter which signal ended the worker.
      const out = classifyTimeout(3, 'pr-review', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('STRANDED')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it('falls through to handle_failure when there is no PR at all', () => {
      // Nothing shipped, so this is a genuine stall and the old triage is the
      // right answer. Deliberately unlike handle_success, which strands an
      // unresolvable PR: there a false SUCCESS deletes the branch, here the
      // fallback preserves it on a RETRY, so guessing wrong costs a triage.
      const out = classifyTimeout(0, 'implementing', 'NONE', 'unknown')

      expect(out).toContain('HANDLE_FAILURE:timeout')
      expect(out).not.toContain('STRANDED')
      expect(out).not.toContain('SUCCESS')
      expect(out).not.toContain('LABEL:')
    })

    it('strands a closed-but-unmerged PR rather than triaging it', () => {
      const out = classifyTimeout(3, 'pr-review', 'CLOSED', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('CLOSED, never merged')
      expect(out).not.toContain('HANDLE_FAILURE')
    })

    it('names the timeout in the outcome line and the Linear comment', () => {
      // "The worker exited cleanly" is a lie about a worker the orchestrator
      // killed, and it points the reader at the skill's terminal-turn rule
      // instead of at the knob that actually caused this.
      const out = classifyTimeout(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('exit=timeout')
      expect(out).toContain('killed at `WORKER_TIMEOUT`')
      expect(out).toContain('ORCHESTRATOR_WORKER_TIMEOUT')
      expect(out).not.toContain('exited cleanly')
    })

    it('leaves the exit-0 stranding described as a clean exit', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('exit=clean')
      expect(out).toContain('The worker exited cleanly but never merged')
      expect(out).not.toContain('killed at `WORKER_TIMEOUT`')
    })

    // The harness keeps orchestrator.sh's `set -e` on, so a statement that
    // returns non-zero aborts mid-function and the trailing line never appears.
    it.each(['OPEN', 'CLOSED'] as PrState[])(
      'runs handle_timeout to completion with a %s PR',
      (pr) => {
        expect(classifyTimeout(3, 'pr-review', pr, 'unknown')).toContain(
          'Preserved worktree and branch for HON-999',
        )
      },
    )

    it('runs handle_timeout to completion on the merged path', () => {
      expect(classifyTimeout(3, 'pr-review', 'MERGED', 'green')).toContain(
        'Worker HON-999 complete — worktree cleaned up',
      )
    })

    // handle_timeout routes on "is there a PR"; handle_success routes on "are
    // there commits". Where those disagree, handle_failure's BACKLOG /
    // NEEDS_HUMAN / already-retried RETRY arms run cleanup WITHOUT keep_branch —
    // `git branch -D` plus the paired Neon branch — so an unpushed commit dies.
    // Raising the budget to 3h makes the mid-implementation kill the typical
    // remaining timeout, so this is the common case, not a corner.
    it('strands commits that have no PR yet rather than force-deleting them', () => {
      const out = classifyTimeout(6, 'implementing', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('6-commits phase=implementing pr=none')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).not.toContain('CLEANUP:')
      // No PR means Linear never moved the issue, so hand it back — same as the
      // exit-0 no-PR stranding.
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('LABEL:Stranded')
    })

    it('matches the exit-0 verdict for commits with no PR', () => {
      // The two paths must agree on this state; disagreeing is what made one of
      // them destructive.
      expect(classifyTimeout(6, 'implementing', 'NONE', 'unknown')).toContain('STRANDED')
      expect(classify(6, 'implementing', 'NONE', 'unknown')).toContain('STRANDED')
    })

    it('strands rather than triages when gh could not answer at all', () => {
      // pr_for_branch is equally silent for "no PR" and for missing /
      // unauthenticated / offline / rate-limited gh. On this path that silence
      // decides whether the branch survives, so one rate-limited `gh pr list`
      // would otherwise reproduce the exact symptom this issue is about.
      const out = classifyTimeout(3, 'pr-review', 'ERROR', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).not.toContain('CLEANUP:')
    })

    it('triages only when the probe ran, found nothing, and nothing was committed', () => {
      // The one genuine stall — and the only route out of handle_timeout that
      // destroys anything.
      expect(classifyTimeout(0, 'implementing', 'NONE', 'unknown')).toContain(
        'HANDLE_FAILURE:timeout',
      )
      expect(classifyTimeout(0, 'implementing', 'ERROR', 'unknown')).not.toContain('HANDLE_FAILURE')
      expect(classifyTimeout(1, 'implementing', 'NONE', 'unknown')).not.toContain('HANDLE_FAILURE')
    })
  })

  // HON-1064: a non-zero exit went straight to handle_failure, exactly as the
  // timeout kill did before HON-583. Its BACKLOG / NEEDS_HUMAN / already-retried
  // arms run `git branch -D` and delete the Neon branch, so a worker that crashed
  // after committing lost its work, and one with an open PR landed in Backlog
  // (HON-611, HON-362 on 2026-09-07). handle_error_exit routes like
  // handle_timeout.
  describe('handle_error_exit outcome classification', () => {
    it('strands an open PR, names the exit code, and keeps every artifact', () => {
      const out = classifyError(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('3-commits phase=pr-review pr=#650 ci=green exit=error')
      expect(out).toContain('exited with error code 1')
      expect(out).not.toContain('exited cleanly')
      expect(out).not.toContain('killed at `WORKER_TIMEOUT`')
      // No cleanup is what keeps the worktree, local branch and Neon branch.
      expect(out).not.toContain('CLEANUP:')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).toContain('LABEL:Stranded')
      // A PR moved the issue to In Review, which is accurate, so it stays.
      expect(out).not.toContain('RESTORE_QUEUED')
    })

    it('strands commits with no PR and hands the issue back to Queued', () => {
      const out = classifyError(2, 'implementing', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('2-commits phase=implementing pr=none')
      expect(out).toContain('exit=error')
      expect(out).not.toContain('CLEANUP:')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('LABEL:Stranded')
    })

    it('reports SUCCESS when the PR merged before the crash', () => {
      const out = classifyError(3, 'pr-review', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('STRANDED')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it.each([0, 3])(
      'strands rather than fails when gh could not answer (%i commits)',
      (commits) => {
        const out = classifyError(commits, 'pr-review', 'ERROR', 'unknown')

        expect(out).toContain('[OUTCOME] HON-999 STRANDED')
        expect(out).not.toContain('HANDLE_FAILURE')
        expect(out).not.toContain('CLEANUP:')
      },
    )

    // A cap death dies in worktree setup, before Claude runs, so it cannot have
    // a PR. Its CAP verdict comes from the log alone and must not depend on gh:
    // stranding it would add the sticky Stranded label and leak the worktree,
    // which the CAP arm exists to prevent (HON-616).
    it.each(['NONE', 'ERROR'] as PrState[])(
      'sends a Neon cap death to triage even when the probe reads %s',
      (pr) => {
        const out = stripTimestamps(runHarness('error', '0', 'planning', pr, 'unknown', 'cap'))

        expect(out).toContain('HANDLE_FAILURE:exit:1')
        expect(out).not.toContain('STRANDED')
        expect(out).not.toContain('LABEL:')
      },
    )

    it('strands a cap-marked log that has commits rather than force-deleting them', () => {
      // The cap check only waives the probe condition, never the commit one.
      const out = stripTimestamps(
        runHarness('error', '2', 'implementing', 'ERROR', 'unknown', 'cap'),
      )

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('HANDLE_FAILURE')
    })

    it('strands a closed-but-unmerged PR rather than triaging it', () => {
      const out = classifyError(3, 'pr-review', 'CLOSED', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('CLOSED, never merged')
      expect(out).not.toContain('HANDLE_FAILURE')
    })

    it('triages as before when the probe ran, found no PR, and nothing was committed', () => {
      // The only route that reaches triage and deletes artifacts. A Neon cap
      // death lands here too; see the cap cases above.
      const out = classifyError(0, 'planning', 'NONE', 'unknown')

      expect(out).toContain('HANDLE_FAILURE:exit:1')
      expect(out).not.toContain('STRANDED')
      expect(out).not.toContain('SUCCESS')
      expect(out).not.toContain('LABEL:')
    })

    // The harness keeps orchestrator.sh's `set -e` on, so a statement that
    // returns non-zero aborts mid-function and the trailing line never appears.
    it.each(['OPEN', 'CLOSED', 'NONE', 'ERROR'] as PrState[])(
      'runs handle_error_exit to completion with a %s PR',
      (pr) => {
        expect(classifyError(3, 'pr-review', pr, 'unknown')).toContain(
          'Preserved worktree and branch for HON-999',
        )
      },
    )

    it('runs handle_error_exit to completion on the merged path', () => {
      expect(classifyError(3, 'pr-review', 'MERGED', 'green')).toContain(
        'Worker HON-999 complete — worktree cleaned up',
      )
    })
  })

  // One probe, one stranding, one success — called from every path. Behaviour
  // tests above cover each path in isolation; only a static guard can catch one
  // path quietly growing its own copy, which is how the timeout path came to
  // miss stranded detection in the first place.
  describe('the exit-0, timeout and error-exit paths share one implementation', () => {
    const source = () => fs.readFileSync(orchestrator, 'utf8')

    it.each(['handle_success', 'handle_timeout', 'handle_error_exit'])(
      '%s probes through probe_worker_pr',
      (fn) => {
        expect(shellFunctionBody(source(), fn)).toContain('probe_worker_pr "$')
      },
    )

    it.each(['handle_success', 'handle_timeout', 'handle_error_exit'])(
      '%s strands through strand_worker',
      (fn) => {
        expect(shellFunctionBody(source(), fn)).toContain('strand_worker "$issue_id"')
      },
    )

    it.each(['handle_success', 'handle_timeout', 'handle_error_exit'])(
      '%s succeeds through record_success',
      (fn) => {
        expect(shellFunctionBody(source(), fn)).toContain('record_success "$issue_id"')
      },
    )

    it('resolves the PR in exactly one place', () => {
      // pr_for_branch outside probe_worker_pr means a second, divergent probe.
      const calls = source().match(/pr_for_branch "\$/g) ?? []

      expect(calls).toHaveLength(1)
      expect(shellFunctionBody(source(), 'probe_worker_pr')).toContain('pr_for_branch "$branch"')
    })

    it('routes the timeout kill through handle_timeout, not handle_failure', () => {
      // The one-line regression: swapping this back reintroduces the whole bug
      // and every behaviour test above still passes, because they call
      // handle_timeout directly.
      const body = shellFunctionBody(source(), 'monitor_workers')

      expect(body).toContain('handle_timeout "$issue_id"')
      expect(body).not.toMatch(/handle_failure .*"timeout"/)
    })

    it('routes the non-zero exit through handle_error_exit, not handle_failure (HON-1064)', () => {
      // Same one-line regression as the timeout route: the behaviour tests call
      // handle_error_exit directly, so only this guard sees the wiring.
      const body = shellFunctionBody(source(), 'monitor_workers')

      expect(body).toContain('handle_error_exit "$issue_id"')
      expect(body).not.toMatch(/handle_failure .*"exit:/)
    })

    it('keeps handle_failure reachable from handle_error_exit', () => {
      expect(shellFunctionBody(source(), 'handle_error_exit')).toMatch(
        /handle_failure .*"exit:\$exit_code"/,
      )
    })

    it('keeps handle_failure reachable from handle_timeout', () => {
      // The no-PR fallback. Without it a timeout on a worker that shipped
      // nothing would go unreported instead of being triaged.
      expect(shellFunctionBody(source(), 'handle_timeout')).toMatch(/handle_failure .*"timeout"/)
    })

    it('waits for the killed worker to die before anything can remove its worktree', () => {
      // SIGTERM returns immediately, and handle_timeout now reaches
      // cleanup_worker_worktree within seconds on the merged-PR route. A
      // claude/pnpm tree still alive at that point re-creates the directory
      // after `git worktree remove` succeeded, orphaning it — and `wt auto`
      // then hard-exits on every future run for that branch. The old `sleep 2`
      // only held because handle_failure's triage call sat in between.
      const body = shellFunctionBody(source(), 'monitor_workers')

      expect(body).toContain('wait_for_exit "$pid" 20 || kill_process_tree "$pid" KILL')
      expect(body).not.toMatch(/kill_process_tree "\$pid"\n\s*sleep 2/)
    })

    it('lets pr_for_branch report a query it could not make', () => {
      // `|| true` here is what collapses "no PR" and "gh is broken" into the
      // same answer. probe_worker_pr publishes the difference instead.
      const body = shellFunctionBody(source(), 'pr_for_branch')

      // Anchored on the subshell's own line — the comment above it names the
      // `|| true` it removed, so a bare substring match would hit that instead.
      expect(body).not.toContain(') 2>/dev/null || true')
      // shellFunctionBody stops before the closing brace, so the subshell is the
      // last thing in it — and its status is therefore the function's.
      expect(body.trimEnd().endsWith(') 2>/dev/null')).toBe(true)
      expect(body).toContain('command -v gh &> /dev/null || return 1')
      expect(shellFunctionBody(source(), 'probe_worker_pr')).toContain(
        'pr_for_branch "$branch") || WORKER_PR_PROBE_OK=false',
      )
    })
  })

  // HON-1065: most strands are one merge from done, so strand_worker respawns a
  // first strand once, on the same branch with retry context, before it asks a
  // human. The harness models a second strand by default (HARNESS_RETRIED=1),
  // which is why the stranding tests above still see the label and comment.
  describe('a stranded run gets one automatic finish attempt', () => {
    type Mode = 'outcome' | 'timeout' | 'error'
    const MODES: Mode[] = ['outcome', 'timeout', 'error']

    function strand(
      mode: Mode,
      pr: PrState,
      env: Record<string, string> = {},
      commits = 3,
      ci: CiState = 'green',
    ): string {
      return stripTimestamps(
        runHarnessEnv({ HARNESS_RETRIED: '0', ...env }, mode, String(commits), 'pr-review', pr, ci),
      )
    }

    /** Everything that says a human was asked: today's strand, unchanged. */
    function expectRecordedForHuman(out: string) {
      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('triage=FINISH')
      expect(out).toContain('LABEL:Stranded')
      expect(out).toContain('COMMENT:')
      expect(out).not.toContain('CLEANUP:')
      expect(out).not.toContain('Spawning worker')
      expect(out).not.toContain('WT_CALL:')
    }

    it.each(MODES)('respawns a first strand with an open PR on the %s path', (mode) => {
      const out = strand(mode, 'OPEN')

      expect(out).toMatch(/\[OUTCOME\] HON-999 STRANDED .* pr=#650 ci=green exit=\w+ triage=FINISH/)
      expect(out).not.toContain('LABEL:Stranded')
      expect(out).not.toContain('COMMENT:')
      expect(out).not.toContain('RESTORE_QUEUED')
      // keep_branch=true: the git branch and the Neon branch survive.
      expect(out).toContain('CLEANUP:test-branch:true')
      expect(out).toContain('WT_CALL:1:auto')
      expect(out).not.toContain('WT_CALL:2:')
      expect(out).toContain('WORKER_RETRIED:1')
      // What a force drain reads to record the strand it interrupts (HON-1077).
      expect(out).toContain('WORKER_FINISHING:1')
    })

    it('logs the outcome, then removes the worktree, then spawns', () => {
      const out = strand('outcome', 'OPEN')
      const outcome = out.indexOf('triage=FINISH')
      const cleanup = out.indexOf('CLEANUP:test-branch:true')
      const spawn = out.indexOf('Spawning worker for HON-999: Fixture title')

      expect(outcome).toBeGreaterThanOrEqual(0)
      expect(cleanup).toBeGreaterThan(outcome)
      expect(spawn).toBeGreaterThan(cleanup)
    })

    it('names the PR number and CI state in the retry context', () => {
      const context = strand('outcome', 'OPEN', {}, 3, 'failing').match(/^WT_CONTEXT:1:(.*)$/m)?.[1]

      expect(context).toMatch(/^Retry context: /)
      expect(context).toContain('PR #650 and CI failing')
      expect(context).toContain('the cycle must finish: fix CI if it fails, then merge')
    })

    it('redacts the log tail and defangs attempt-1 markers in the context', () => {
      const context = strand('outcome', 'OPEN').match(/^WT_CONTEXT:1:(.*)$/m)?.[1] ?? ''

      expect(context).not.toContain('hrn-fake+Tok3n')
      expect(context).toContain('[REDACTED]')
      expect(context).not.toContain('[review-pr:complete]')
      expect(context).toContain('(review-pr:complete)')
    })

    it.each(MODES)('respawns a first strand with commits and no PR on the %s path', (mode) => {
      const out = strand(mode, 'NONE', {}, 2, 'unknown')

      expect(out).toContain('pr=none ci=unknown')
      expect(out).toContain('triage=FINISH')
      expect(out).toContain('CLEANUP:test-branch:true')
      // The issue stays In Progress and assigned while the finish worker owns
      // it; back in Queued with no Stranded label the picker would claim it again.
      expect(out).not.toContain('RESTORE_QUEUED')
      expect(out).not.toContain('LABEL:Stranded')
      expect(out).toMatch(/WT_CONTEXT:1:.*stranded with no PR.*open the PR, fix CI if it fails/)
    })

    it('counts the finish attempt toward the circuit breaker', () => {
      expect(strand('outcome', 'OPEN')).toContain('CONSECUTIVE_FAILURES:1')
    })

    it.each(MODES)('records a second strand for a human on the %s path', (mode) => {
      expectRecordedForHuman(strand(mode, 'OPEN', { HARNESS_RETRIED: '1' }))
    })

    it('does not respawn when the caller passed no retried value', () => {
      // handle_success defaults a missing argument to empty, which must read as
      // "no", never as a first attempt.
      expectRecordedForHuman(strand('outcome', 'OPEN', { HARNESS_RETRIED: '' }))
    })

    it.each(MODES)('does not respawn a closed PR on the %s path', (mode) => {
      expectRecordedForHuman(strand(mode, 'CLOSED', {}, 3, 'unknown'))
    })

    it.each(MODES)('does not respawn when the PR probe failed on the %s path', (mode) => {
      expectRecordedForHuman(strand(mode, 'ERROR', {}, 3, 'unknown'))
    })

    it.each(MODES)('does not respawn during shutdown on the %s path', (mode) => {
      expectRecordedForHuman(strand(mode, 'OPEN', { HARNESS_SHUTTING_DOWN: 'true' }))
    })

    // /auto-implement 6.7 stops at the review-round cap on purpose, leaving the
    // PR for a human because a correctness finding is unresolved. A finish
    // worker told to merge would bypass that.
    const HANDOFF = [
      '[auto-implement] ⚠ Review-round cap reached (3/3) — handing off',
      '[auto-implement] PR left open with a hand-off comment; not merged',
      '[auto-implement] ✗ Autonomous implementation cycle stopped at Phase 6 (review-round cap)',
    ].join('\n')

    it.each(MODES)('does not respawn a 6.7 review-cap hand-off on the %s path', (mode) => {
      expectRecordedForHuman(strand(mode, 'OPEN', { HARNESS_LOG_TAIL: HANDOFF }))
    })

    // Workers paraphrase the marker. These are the two real hand-offs in the
    // worker logs on 2026-10-06; neither printed review-cap.md's exact first line.
    it.each([
      [
        'HON-794',
        '[auto-implement] ⚠ Stopped before Phase 7: this PR needs your live pass before merge\n[auto-implement] PR left open, not merged',
      ],
      [
        'HON-963',
        '[auto-implement] ⚠ Unresolved finding at round 1: judged eval under its gate — handing off\n[auto-implement] PR left open with a hand-off comment; not merged',
      ],
    ])('does not respawn the paraphrased hand-off %s printed', (_issue, tail) => {
      expectRecordedForHuman(strand('outcome', 'OPEN', { HARNESS_LOG_TAIL: tail }))
    })

    it.each([
      '[auto-implement] PR left open, not merged',
      '[auto-implement] ⚠ Unresolved finding at round 2 — handing off',
      '[auto-implement] ⚠ Review-round cap reached (3/3) — handing off',
    ])('reads any one hand-off line on its own: %s', (line) => {
      expectRecordedForHuman(strand('outcome', 'OPEN', { HARNESS_LOG_TAIL: line }))
    })

    it('still respawns when the log only carries a defanged hand-off line', () => {
      // A retry note rewrites `[auto-implement]` to `(auto-implement)`, so
      // attempt 1's hand-off quoted in a prompt is not attempt 2's hand-off.
      const defanged = [
        '(auto-implement) ⚠ Review-round cap reached (3/3) — handing off',
        '(auto-implement) PR left open with a hand-off comment; not merged',
      ].join('\n')

      expect(strand('outcome', 'OPEN', { HARNESS_LOG_TAIL: defanged })).toContain('triage=FINISH')
    })

    describe('uncommitted changes in the worktree', () => {
      let repo: string
      beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-finish-wt-'))
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
        git('init', '-q')
        git('config', 'user.email', 'test@example.com')
        git('config', 'user.name', 'Test')
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n')
        git('add', 'tracked.txt')
        git('commit', '-q', '-m', 'init')
      })
      afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))
      beforeEach(() => {
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n')
        fs.rmSync(path.join(repo, 'untracked.txt'), { force: true })
      })

      const dirty = (wt: string) => runHarness('worktree-dirty', wt).trim()

      it('reads a clean worktree as clean', () => {
        expect(dirty(repo)).toBe('CLEAN')
      })

      it('reads a modified tracked file as dirty', () => {
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'two\n')
        expect(dirty(repo)).toBe('DIRTY')
      })

      it('reads an untracked file as dirty', () => {
        fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n')
        expect(dirty(repo)).toBe('DIRTY')
      })

      it('reads a missing worktree as clean, since there is nothing to lose', () => {
        expect(dirty(path.join(repo, 'no-such-dir'))).toBe('CLEAN')
      })

      it('reads a directory git cannot read as dirty', () => {
        // An unreadable status is not evidence of a clean tree, and the answer
        // "dirty" is the one that keeps the artifacts.
        const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-finish-norepo-'))
        try {
          expect(
            runHarnessEnv(
              { GIT_CEILING_DIRECTORIES: os.tmpdir() },
              'worktree-dirty',
              notRepo,
            ).trim(),
          ).toBe('DIRTY')
        } finally {
          fs.rmSync(notRepo, { recursive: true, force: true })
        }
      })

      it.each(MODES)('does not respawn a strand with a dirty worktree on the %s path', (mode) => {
        fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n')
        expectRecordedForHuman(strand(mode, 'OPEN', { HARNESS_WT_PATH: repo }))
      })

      it('respawns when the worktree exists and is clean', () => {
        expect(strand('outcome', 'OPEN', { HARNESS_WT_PATH: repo })).toContain('triage=FINISH')
      })
    })

    it('passes retried and title from monitor_workers to handle_success', () => {
      // The behaviour tests call handle_success directly, so only this guard
      // sees the wiring. Without it every exit-0 strand reads as "no retried
      // value" and the finish attempt silently never runs on that path.
      expect(shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'monitor_workers')).toContain(
        'handle_success "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "$title"',
      )
    })
  })

  // HON-1077: two holes the finish attempt (HON-1065) left behind.
  describe('a respawned branch and a drained finish attempt', () => {
    // A respawn that dies before `git worktree add` succeeds: the worktree is
    // gone, the branch is kept, and count_commits must still see its commits.
    describe('a retried worker that exits before its worktree exists', () => {
      let repo: string
      beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-respawn-'))
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', repo, ...args], {
            encoding: 'utf8',
            env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
          })
        git('init', '-q', '-b', 'main')
        git('config', 'user.email', 'test@example.com')
        git('config', 'user.name', 'Test')
        fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n')
        git('add', 'seed.txt')
        git('commit', '-qm', 'seed')
        git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        git('checkout', '-q', '-b', 'test-branch')
        for (const n of [1, 2]) {
          fs.writeFileSync(path.join(repo, `work-${n}.txt`), `${n}\n`)
          git('add', `work-${n}.txt`)
          git('commit', '-qm', `work ${n}`)
        }
        git('checkout', '-q', 'main')
      })
      afterAll(() => {
        fs.rmSync(repo, { recursive: true, force: true })
        fs.rmSync(`${repo}-wt`, { recursive: true, force: true })
      })

      // Where get_worktree_path points. Absent at the start of every run: the
      // respawn died before `git worktree add`.
      const wt = () => `${repo}-wt`
      const respawnDies = () => {
        fs.rmSync(wt(), { recursive: true, force: true })
        execFileSync('git', ['-C', repo, 'worktree', 'prune'])
        return stripTimestamps(
          runHarnessEnv(
            { HARNESS_RETRIED: '1', HARNESS_COUNT_REPO: repo, HARNESS_WT_PATH: wt() },
            'error',
            '0',
            'initializing',
            'NONE',
            'unknown',
          ),
        )
      }

      it('strands with the branch’s commits instead of reaching handle_failure', () => {
        const out = respawnDies()

        expect(out).toContain('[OUTCOME] HON-999 STRANDED')
        expect(out).toContain('2-commits')
        expect(out).toContain('exit=error')
        expect(out).not.toContain('HANDLE_FAILURE:')
      })

      it('keeps the git branch and the Neon branch', () => {
        const out = respawnDies()

        // Every deletion goes through cleanup_worker_worktree.
        expect(out).not.toContain('CLEANUP:')
        expect(out).toContain('LABEL:Stranded')
        expect(out).toContain('Preserved worktree and branch for HON-999')
      })

      // The strand comment says `wt resume` then `wt cleanup`, and `wt watch`
      // reads a missing directory as resolved. All three need the worktree.
      it('re-creates the worktree from the kept branch so the strand can be resumed and released', () => {
        const out = respawnDies()

        expect(out).toContain('Re-created a bare worktree for test-branch')
        // It is only a checkout, so the comment must not promise a ready one.
        expect(out).toMatch(/COMMENT:.*re-created a \*\*bare\*\* one from the branch/)
        expect(
          execFileSync('git', ['-C', wt(), 'branch', '--show-current'], {
            encoding: 'utf8',
          }).trim(),
        ).toBe('test-branch')
        expect(fs.existsSync(path.join(wt(), 'work-2.txt'))).toBe(true)
      })
    })

    // A force stop during the finish attempt. The first strand logged
    // triage=FINISH and added no label, so the drain is the last chance to
    // leave the operator something to act on.
    describe('force drain', () => {
      const drain = (pr: PrState, finishing: boolean) =>
        stripTimestamps(
          runHarnessEnv(
            { HARNESS_FINISHING: finishing ? '1' : '0' },
            'drain',
            '3',
            'pr-review',
            pr,
            'green',
          ),
        )

      it('records a finish attempt with an open PR as a strand for a human', () => {
        const out = drain('OPEN', true)

        expect(out).toMatch(/\[OUTCOME\] HON-999 STRANDED .* pr=#650 ci=green exit=stopped$/m)
        expect(out).not.toContain('triage=FINISH')
        expect(out).toContain('LABEL:Stranded')
        expect(out).toMatch(/COMMENT:.*force-stopped during the automatic finish attempt/)
        // In Review is the accurate state with a PR, and the worktree is
        // preserved like any strand's: `wt watch` reads it to keep the strand open.
        expect(out).not.toContain('RESTORE_QUEUED')
        expect(out).not.toContain('CLEANUP:')
        // Never a second finish attempt.
        expect(out).not.toContain('WT_CALL:')
      })

      it('returns a finish attempt with no PR to Queued, behind the Stranded label', () => {
        const out = drain('NONE', true)

        expect(out).toContain('exit=stopped')
        expect(out).toContain('LABEL:Stranded')
        expect(out).toContain('RESTORE_QUEUED:HON-999')
        expect(out).not.toContain('CLEANUP:')
      })

      it('drains a finish attempt whose PR merged before the kill as before', () => {
        const out = drain('MERGED', true)

        expect(out).not.toContain('[OUTCOME]')
        expect(out).not.toContain('LABEL:')
        expect(out).toContain('CLEANUP:test-branch:true')
        expect(out).toContain('RESTORE_QUEUED:HON-999')
      })

      it('leaves a first-attempt worker’s drain unchanged', () => {
        const out = drain('OPEN', false)

        expect(out).not.toContain('[OUTCOME]')
        expect(out).not.toContain('LABEL:')
        expect(out).not.toContain('COMMENT:')
        expect(out).toContain('CLEANUP:test-branch:true')
        expect(out).toContain('RESTORE_QUEUED:HON-999')
      })
    })

    it('does not mark a RETRY respawn as a finish attempt', () => {
      // A triage retry gets the normal drain: its issue goes back to Queued.
      const out = stripTimestamps(runHarness('failure-spawn', 'RETRY'))

      expect(out.match(/^WT_CALL:/gm)).toHaveLength(2)
      expect(out).toContain('WORKER_FINISHING:0 0')
    })
  })

  // HON-1064, HON-1065 and HON-1077 keep a branch that holds work, but none of
  // their paths had run on a live worker when they landed. If one still loses
  // a branch, the orchestrator has to say so: the 2026-09-07 losses were found
  // by reading the log weeks later.
  describe('a run whose commits are gone (HON-1095)', () => {
    type Where = 'yes' | 'no' | 'error'
    const check = (outcome: string, commits: number, local: Where, remote: Where, pr: PrState) =>
      stripTimestamps(runHarness('lost-branch', outcome, String(commits), local, remote, pr))
    const LOST =
      'WARN  [LOST-BRANCH] HON-999 test-branch: 2 commit(s) and no merged PR, but the branch is gone locally and on origin'

    it.each(['FAILED', 'STRANDED', 'TIMEOUT'])(
      'warns once for a %s run with commits, no branch anywhere and no PR',
      (outcome) => {
        const out = check(outcome, 2, 'no', 'no', 'NONE')

        expect(out.split('\n').filter((l) => l.includes('[LOST-BRANCH]'))).toEqual([LOST])
        expect(out).toContain('DONE')
      },
    )

    it('warns when the PR was closed without a merge', () => {
      expect(check('STRANDED', 2, 'no', 'no', 'CLOSED')).toContain(LOST)
    })

    it('says nothing while the local branch holds the commits', () => {
      const out = check('STRANDED', 2, 'yes', 'no', 'NONE')

      expect(out).not.toContain('[LOST-BRANCH]')
      expect(out).not.toContain('PROBE:')
    })

    it('says nothing while only origin holds the commits', () => {
      const out = check('FAILED', 2, 'no', 'yes', 'NONE')

      expect(out).not.toContain('[LOST-BRANCH]')
      expect(out).not.toContain('PROBE:')
    })

    it('says nothing when the PR merged', () => {
      const out = check('STRANDED', 2, 'no', 'no', 'MERGED')

      expect(out).toContain('PROBE:test-branch')
      expect(out).not.toContain('[LOST-BRANCH]')
    })

    // SUCCESS cleaned the branch up on purpose, and GATED had nothing to lose.
    it.each(['SUCCESS', 'GATED', ''])('never runs the check for outcome "%s"', (outcome) => {
      const out = check(outcome, 2, 'no', 'no', 'NONE')

      expect(out).not.toContain('[LOST-BRANCH]')
      expect(out).not.toContain('PROBE:')
      expect(out).not.toContain('Lost-branch check')
    })

    // -1 is count_commits' "could not count", not work that was lost.
    it.each([0, -1])('never runs the check with %i commits', (commits) => {
      const out = check('STRANDED', commits, 'no', 'no', 'NONE')

      expect(out).not.toContain('[LOST-BRANCH]')
      expect(out).not.toContain('PROBE:')
      expect(out).not.toContain('Lost-branch check')
    })

    // A failed call is not evidence that the branch is gone. A false alarm
    // teaches the operator to ignore the real one.
    it('skips with a DEBUG line when the PR lookup fails', () => {
      const out = check('STRANDED', 2, 'no', 'no', 'ERROR')

      expect(out).toContain('DEBUG Lost-branch check skipped for HON-999: the PR lookup failed')
      expect(out).not.toContain('[LOST-BRANCH]')
    })

    it('skips with a DEBUG line when origin cannot be asked', () => {
      const out = check('STRANDED', 2, 'no', 'error', 'NONE')

      expect(out).toMatch(/DEBUG Lost-branch check skipped for HON-999: git ls-remote exited \d+/)
      expect(out).not.toContain('[LOST-BRANCH]')
      expect(out).not.toContain('PROBE:')
    })

    it('skips with a DEBUG line when the main checkout cannot be read', () => {
      const out = check('STRANDED', 2, 'error', 'no', 'NONE')

      expect(out).toMatch(/DEBUG Lost-branch check skipped for HON-999: git show-ref exited \d+/)
      expect(out).not.toContain('[LOST-BRANCH]')
    })

    describe('monitor_workers runs it once per finished worker', () => {
      const monitor = (how: string, env: Record<string, string> = {}) =>
        stripTimestamps(runHarnessEnv(env, 'monitor-lost', how))
      const FAILED_2 = { HARNESS_OUTCOME: 'FAILED', HARNESS_COMMITS: '2' }

      it.each([
        ['exit0', 'HANDLER:success'],
        ['exit1', 'HANDLER:error:1'],
        ['timeout', 'HANDLER:timeout'],
      ])('after the handler, on the %s path', (how, handler) => {
        const lines = monitor(how, FAILED_2).split('\n')
        const check = 'LOST_CHECK:HON-999|test-branch|FAILED|2'

        expect(lines.filter((l) => l.startsWith('LOST_CHECK:'))).toEqual([check])
        expect(lines.indexOf(handler)).toBeGreaterThan(-1)
        expect(lines.indexOf(check)).toBeGreaterThan(lines.indexOf(handler))
      })

      it('not for a worker that is still running', () => {
        const out = monitor('running', FAILED_2)

        expect(out).not.toContain('LOST_CHECK:')
        expect(out).toContain('DONE')
      })

      it('with this worker’s outcome, never the previous worker’s', () => {
        // The harness leaves STRANDED / 7 in the globals first. A handler that
        // logged no outcome must not inherit it.
        expect(monitor('exit0')).toContain('LOST_CHECK:HON-999|test-branch||')
      })
    })

    // The check reads the verdict from note_outcome, so an [OUTCOME] line
    // without one would never be checked.
    it('pairs every [OUTCOME] line with a note_outcome call', () => {
      const lines = fs.readFileSync(orchestrator, 'utf8').split('\n')
      const outcomeSites = lines
        .map((l, i) => [l, i] as const)
        .filter(([l]) => /^\s*log (INFO|WARN) "\[OUTCOME\]/.test(l))

      expect(outcomeSites.length).toBeGreaterThanOrEqual(5)
      for (const [line, i] of outcomeSites) {
        expect(lines[i + 1], `no note_outcome after: ${line.trim()}`).toMatch(/^\s*note_outcome /)
      }
    })
  })

  // HON-573 made workers wait for CI in-turn; CI here runs 8-12 min and the
  // budget was never raised to absorb it, so every run needing more than an
  // hour died at the cap in pr-review. 10800 is the value the one successful
  // >1h run was configured with.
  describe('WORKER_TIMEOUT budget', () => {
    it('defaults to 10800 seconds', () => {
      expect(runHarness('worker-timeout').trim()).toBe('10800')
    })

    it('is still overridden by ORCHESTRATOR_WORKER_TIMEOUT', () => {
      expect(runHarnessEnv({ ORCHESTRATOR_WORKER_TIMEOUT: '900' }, 'worker-timeout').trim()).toBe(
        '900',
      )
    })

    it('is documented with the value it actually has', () => {
      // The --help text and the docs table are where an operator reads the
      // budget; a stale number there sends them tuning a knob that is already set.
      expect(fs.readFileSync(orchestrator, 'utf8')).toContain(
        'Seconds before killing a worker (default: 10800)',
      )
      expect(
        fs.readFileSync(path.join(scriptsDir, '..', 'docs', 'PARALLEL_WORKFLOW.md'), 'utf8'),
      ).toMatch(/`ORCHESTRATOR_WORKER_TIMEOUT` +\| +10800 /)
    })
  })
})
