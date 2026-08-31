import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const orchestrator = path.join(scriptsDir, 'orchestrator.sh')
const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')
const neonCleanup = path.join(scriptsDir, 'neon-cleanup.sh')
const harness = path.join(scriptsDir, 'orchestrator-outcome-harness.sh')

/**
 * The harness inherits the developer's shell, and a machine that has sourced
 * `.env` exports NEON_USER_PREFIX — which would silently widen the Neon GC
 * selection under test. Pin it per call instead.
 */
function harnessEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, NEON_USER_PREFIX: '', ...overrides }
}

const stripTimestamps = (out: string) => out.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm, '')

/**
 * Slice a shell function's body out of a script's source, so a test can assert
 * on what one function does without matching text elsewhere in the file.
 * Relies on the repo's convention of closing every function with `}` at column 0.
 */
function shellFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`\n${name}() {`)
  expect(start, `${name}() not found`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}\n', start)
  expect(end, `${name}() has no closing brace at column 0`).toBeGreaterThan(start)
  return source.slice(start, end)
}

type PrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE'
type CiState = 'green' | 'pending' | 'failing' | 'unknown'

/**
 * Drive `handle_success` through the harness, which sources orchestrator.sh
 * with every network/Linear/GitHub collaborator stubbed. Returns the log lines
 * with their timestamps stripped, so assertions read against stable text.
 */
function classify(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return runHarness('outcome', String(commits), phase, pr, ci).replace(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm,
    '',
  )
}

function runHarness(...args: string[]): string {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: harnessEnv(),
  })
}

/** Run the real `pr_for_branch` / `pr_ci_state` against fixture `gh` output. */
function prForBranch(ghJson: unknown): string {
  return runHarness('pr-for-branch', JSON.stringify(ghJson)).trim()
}

function ciState(buckets: string[]): string {
  return runHarness('ci-state', JSON.stringify(buckets.map((bucket) => ({ bucket })))).trim()
}

describe('orchestrator.sh', () => {
  // HON-572 widened this: worktree-claude.sh and neon-cleanup.sh are edited by
  // the same fixes, and a shell syntax error there is only caught at run time —
  // on the unattended path, hours after the change landed.
  it.each([
    ['orchestrator.sh', orchestrator],
    ['worktree-claude.sh', worktreeClaude],
    ['neon-cleanup.sh', neonCleanup],
  ])('%s is syntactically valid', (_name, script) => {
    expect(() => execFileSync('bash', ['-n', script], { timeout: 30_000 })).not.toThrow()
  })

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
      expect(out).toContain('RESTORE_TODO:HON-999')
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
      // count_commits reads `main..HEAD` in the worktree; once that is removed
      // it returns 0. Resolving the PR before the 0-commit gate is what keeps
      // this from being labelled GATED and pushed back to Todo after it shipped.
      const out = classify(0, 'planning', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('GATED')
      expect(out).not.toContain('LABEL:Gated')
      expect(out).not.toContain('RESTORE_TODO')
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

    it('returns a stranded run with no PR to Todo', () => {
      // With no PR, Linear never moved the issue out of In Progress and
      // /auto-implement left it assigned — select_next_issue would skip it
      // forever. The Stranded label keeps the picker off it in the meantime.
      const out = classify(3, 'pr-review', 'NONE', 'unknown')

      expect(out).toContain('RESTORE_TODO:HON-999')
      expect(out).toContain('LABEL:Stranded')
    })

    it('leaves the issue in In Review when a PR exists', () => {
      // Linear automation already moved it there, and that is the accurate
      // state — overwriting it with Todo would misreport an open PR.
      expect(classify(3, 'pr-review', 'OPEN', 'green')).not.toContain('RESTORE_TODO')
    })
  })

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
  })

  // ─── HON-572 finding 1: sanitize_log ──────────────────────────────────────
  // sanitize_log's output is posted verbatim into a Linear comment by
  // move_to_backlog. The per-.env-value pass used awk gsub(), which treats its
  // first argument as an ERE — so any secret containing a regex metacharacter
  // failed to match itself and shipped unredacted.
  describe('sanitize_log', () => {
    let envDir: string

    // Every metacharacter the ERE-based gsub() choked on, in one value.
    const META_SECRET = String.raw`sk-a+b?c.d*e[f]g(h)i\j^k$l|m`
    const SUBSTRING_SECRET = 'abcdefghij'

    beforeAll(() => {
      envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon572-env-'))
      fs.writeFileSync(
        path.join(envDir, '.env'),
        [
          '# a comment line, skipped',
          '',
          'SHORT=abc', // under the 8-char floor
          `META_SECRET=${META_SECRET}`,
          `SUB=${SUBSTRING_SECRET}`,
          '',
        ].join('\n'),
      )
    })

    afterAll(() => fs.rmSync(envDir, { recursive: true, force: true }))

    const sanitize = (text: string) => runHarness('sanitize', path.join(envDir, '.env'), text)

    it('redacts a value containing every regex metacharacter', () => {
      const out = sanitize(`leaked: ${META_SECRET} end`)

      expect(out).toBe('leaked: [REDACTED] end')
      expect(out).not.toContain(META_SECRET)
    })

    it('replaces every occurrence on a line, not just the first', () => {
      // The gsub() being replaced was global; the literal loop must be too.
      const out = sanitize(`${META_SECRET} mid ${META_SECRET} tail ${META_SECRET}`)

      expect(out).toBe('[REDACTED] mid [REDACTED] tail [REDACTED]')
    })

    it('redacts a value embedded inside a longer token', () => {
      expect(sanitize(`token=XX${SUBSTRING_SECRET}YY`)).toBe('token=XX[REDACTED]YY')
    })

    it('leaves values under the 8-char floor alone', () => {
      // The floor is the false-positive guard: redacting "abc" would gut the log.
      expect(sanitize('the abc value stays')).toBe('the abc value stays')
    })

    it('still applies the sed backstop to secrets absent from .env', () => {
      const out = sanitize(
        [
          'lin_api_ABC123def',
          'postgresql://user:pw@host/db',
          'Bearer abc.def-123',
          'sk-01234567890123456789012',
          'ghp_012345678901234567890123456789012345',
        ].join(' '),
      )

      expect(out).toBe('[REDACTED] [REDACTED] Bearer [REDACTED] [REDACTED] [REDACTED]')
    })
  })

  // ─── HON-572 finding 2: circuit breaker ───────────────────────────────────
  // The counter used to be updated from the triage VERDICT, before the case
  // that acts on it. A second RETRY falls through to move_to_backlog — a
  // terminal failure — but the counter had already been zeroed, so a systemic
  // fault that reads as transient swept the whole Todo queue into Backlog
  // without ever reaching MAX_CONSECUTIVE_FAILURES.
  describe('handle_failure circuit breaker', () => {
    function drive(triage: string, retried: string, shuttingDown: string, repeat = 1) {
      const out = stripTimestamps(
        runHarness('failure', triage, retried, shuttingDown, String(repeat)),
      )
      const read = (key: string) => out.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1] ?? ''
      return {
        out,
        consecutiveFailures: Number(read('CONSECUTIVE_FAILURES')),
        paused: read('PAUSED') === 'true',
        statusJson: JSON.parse(read('STATUS_JSON') || '{}') as { consecutive_failures: number },
      }
    }

    it('resets the counter only on a real retry', () => {
      const r = drive('RETRY', '0', 'false')

      expect(r.out).toContain('SPAWN_WORKER:HON-999:retry=1')
      expect(r.out).not.toContain('MOVE_TO_BACKLOG')
      expect(r.consecutiveFailures).toBe(0)
    })

    it('counts a RETRY verdict that was already retried as a failure', () => {
      const r = drive('RETRY', '1', 'false')

      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-999:Failed')
      expect(r.out).not.toContain('SPAWN_WORKER')
      expect(r.consecutiveFailures).toBe(1)
    })

    it('counts a RETRY verdict during shutdown as a failure', () => {
      // The shutdown branch is terminal too — no worker is ever respawned.
      const r = drive('RETRY', '0', 'true')

      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-999:Failed')
      expect(r.out).not.toContain('SPAWN_WORKER')
      expect(r.consecutiveFailures).toBe(1)
    })

    it.each([
      ['BACKLOG', 'Failed'],
      ['NEEDS_HUMAN', 'Needs attention'],
    ])('counts a %s verdict as a failure', (triage, label) => {
      const r = drive(triage, '0', 'false')

      expect(r.out).toContain(`MOVE_TO_BACKLOG:HON-999:${label}`)
      expect(r.consecutiveFailures).toBe(1)
    })

    it('engages the breaker after MAX_CONSECUTIVE_FAILURES terminal failures', () => {
      // This is the runaway the breaker exists to stop: before the fix, a RETRY
      // verdict zeroed the counter every cycle and it never reached 3.
      const r = drive('RETRY', '1', 'false', 3)

      expect(r.consecutiveFailures).toBeGreaterThanOrEqual(3)
      expect(r.paused).toBe(true)
      expect(r.out).toContain('Circuit breaker: 3 consecutive failures')
    })

    it('reports the same count in the status file wt status reads', () => {
      const r = drive('BACKLOG', '0', 'false', 2)

      expect(r.statusJson.consecutive_failures).toBe(r.consecutiveFailures)
      expect(r.statusJson.consecutive_failures).toBe(2)
    })
  })

  // ─── HON-572 finding 3: duplicated log lines ──────────────────────────────
  // log() writes a colored line to stderr AND a clean line to $MAIN_LOG.
  // cmd_start pointed the orchestrator's stderr at the same file, so every line
  // was stored twice — one copy carrying raw ANSI escapes — and
  // `grep '[OUTCOME]' orchestrator.log` returned every outcome twice.
  describe('orchestrator.log is written once', () => {
    it('log() adds exactly one clean line to MAIN_LOG and one to stderr', () => {
      const run = spawnSync('bash', [harness, 'log-once'], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      expect(run.status).toBe(0)
      expect(run.stdout).toContain('FILE_LINES:1')
      expect(run.stdout).toContain('FILE_MARKERS:1')
      expect(run.stdout).toContain('FILE_ESCAPES:0')
      // The console copy is a separate stream, and it is the colored one.
      expect(run.stderr).toContain('harness-marker')
      expect(run.stderr).toContain('\u001b[')
    })

    it('cmd_start does not fold the orchestrator stderr back into orchestrator.log', () => {
      const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_start')
      const nohup = body.match(/^\s*nohup .*$/m)?.[0] ?? ''

      expect(nohup).toContain('orchestrator.sh')
      expect(nohup).not.toMatch(/>>?\s*"\$log_file"/)
    })

    it('report_worker_status does not print its rows to stderr as well as logging them', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'report_worker_status')

      expect(body).not.toMatch(/printf .*>&2/)
      expect(body).toContain('log DEBUG')
    })
  })

  // ─── HON-572 finding 4: Neon GC coverage ──────────────────────────────────
  // spawn_worker prefers Linear's branchName, so the orchestrator's real branch
  // is `kaupokorv/hon-51-slug` -> Neon `kaupokorv--hon-51-slug`. Every reaper
  // looked for `auto-*` instead, so a crashed orchestrator leaked Neon branches
  // with no backstop until the project hit its branch cap.
  describe('Neon orphan GC selection', () => {
    const FIXTURE = [
      'kaupokorv--hon-51-slug',
      'auto--hon-51',
      'kaupo-interactive',
      'feat--some-branch',
      'main',
      'production',
      'staging',
      'preview',
    ]

    function select(live = '', userPrefix = ''): string[] {
      const json = JSON.stringify(FIXTURE.map((name) => ({ name })))
      const out = execFileSync('bash', [harness, 'neon-gc-select', json, live], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv({ NEON_USER_PREFIX: userPrefix }),
      })
      return out.split('\n').filter(Boolean)
    }

    it('selects an orchestrator branch named from a Linear branchName', () => {
      expect(select()).toContain('kaupokorv--hon-51-slug')
    })

    it('still selects the auto-- fallback shape', () => {
      expect(select()).toContain('auto--hon-51')
    })

    it('selects NEON_USER_PREFIX branches only when the prefix is set', () => {
      expect(select('', 'kaupo')).toContain('kaupo-interactive')
      expect(select()).not.toContain('kaupo-interactive')
    })

    it.each(['main', 'production', 'staging', 'preview'])(
      'never selects the protected branch %s',
      (name) => {
        expect(select()).not.toContain(name)
      },
    )

    it('leaves unrelated branches alone', () => {
      expect(select()).not.toContain('feat--some-branch')
    })

    it('skips a matching branch that still has a live worktree', () => {
      const selected = select('kaupokorv--hon-51-slug')

      expect(selected).not.toContain('kaupokorv--hon-51-slug')
      expect(selected).toContain('auto--hon-51')
    })
  })

  // The two neon-cleanup.sh reapers have to agree with the `wt` GC above, so
  // they are asserted against the regex and the derivation actually sourced
  // from the script rather than a copy of them.
  describe('neon-cleanup.sh branch patterns', () => {
    function matchesSafeRegex(name: string): boolean {
      const out = execFileSync(
        'bash',
        [
          '-c',
          'source "$1"; if [[ "$2" =~ $SAFE_BRANCH_REGEX ]]; then echo "YES:${BASH_REMATCH[1]}"; else echo NO; fi',
          'bash',
          neonCleanup,
          name,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      ).trim()
      return out.startsWith('YES')
    }

    function onMergeTarget(gitBranch: string, prBody = ''): string {
      return execFileSync(
        'bash',
        [
          '-c',
          'export PR_BODY="$3"; source "$1"; neon_branch_target_for_git_branch "$2"',
          'bash',
          neonCleanup,
          gitBranch,
          prBody,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      ).trim()
    }

    it.each(['kaupokorv--hon-51-slug', 'auto--hon-51', 'kaupo--hon-572-a-long-slug-here'])(
      'SAFE_BRANCH_REGEX matches %s',
      (name) => {
        expect(matchesSafeRegex(name)).toBe(true)
      },
    )

    it.each(['main', 'production', 'staging', 'feat--some-branch', 'auto--hon-'])(
      'SAFE_BRANCH_REGEX rejects %s',
      (name) => {
        expect(matchesSafeRegex(name)).toBe(false)
      },
    )

    it('maps a merged orchestrator branch to the Neon branch that exists', () => {
      // The old pattern matched `^auto--hon-<N>$` against the raw git head ref,
      // a shape it never has, and then guessed a name no run ever creates.
      expect(onMergeTarget('kaupokorv/hon-51-slug')).toBe('kaupokorv--hon-51-slug')
      expect(onMergeTarget('auto/hon-51')).toBe('auto--hon-51')
    })

    it('falls back to the PR body when the branch carries no HON id', () => {
      expect(onMergeTarget('posthog/add-pantry-sync', 'Closes HON-99')).toBe('auto--hon-99')
    })

    it.each(['posthog/add-pantry-sync', 'main', 'production', 'renovate/npm-foo-1.x'])(
      'reaps nothing for %s with no PR body reference',
      (branch) => {
        expect(onMergeTarget(branch)).toBe('')
      },
    )
  })

  // ─── HON-572 finding 5: wt stop drain window ──────────────────────────────
  // cmd_stop sent a second SIGTERM, slept 3s, then SIGKILLed. The force path
  // runs drain_workers_to_todo, which needs ~15s per worker; killing it partway
  // orphans `claude` processes and leaves their issues In Progress + assigned,
  // the state select_next_issue skips forever.
  describe('stop_wait_bound', () => {
    const bound = (workers: string) => Number(runHarness('stop-wait-bound', workers).trim())

    it.each([
      ['0 workers', '0'],
      ['a missing status file', ''],
      ['an unparseable status file', 'null'],
    ])('waits at least 60s with %s', (_label, workers) => {
      expect(bound(workers)).toBeGreaterThanOrEqual(60)
    })

    it.each([1, 3, 5])('waits at least 15s per worker for %i worker(s)', (n) => {
      expect(bound(String(n))).toBeGreaterThanOrEqual(15 * n)
    })

    it('never shrinks as the worker count grows', () => {
      const bounds = [0, 1, 2, 3, 4, 5, 10].map((n) => bound(String(n)))

      expect(bounds).toEqual([...bounds].sort((a, b) => a - b))
    })

    it('cmd_stop polls for the drain instead of sleeping a flat 3s before SIGKILL', () => {
      const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_stop')

      expect(body).not.toMatch(/^\s*sleep 3\s*$/m)
      expect(body).toContain('stop_wait_bound')

      // The SIGKILL must come after the poll, not before it.
      const pollIndex = body.indexOf('stop_wait_bound')
      const killIndex = body.indexOf('kill -9')
      expect(pollIndex).toBeGreaterThan(-1)
      expect(killIndex).toBeGreaterThan(pollIndex)
    })
  })
})
