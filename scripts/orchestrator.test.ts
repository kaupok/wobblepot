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
const e2eLocal = path.join(scriptsDir, 'e2e-local.sh')
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

type PrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE' | 'ERROR'
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

/**
 * Same fixtures, but through `handle_timeout` — the path monitor_workers takes
 * when it kills a worker at WORKER_TIMEOUT. `handle_failure` is stubbed to a
 * `HANDLE_FAILURE:<type>` marker, so the three routes out are distinguishable.
 */
function classifyTimeout(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return stripTimestamps(runHarness('timeout', String(commits), phase, pr, ci))
}

function runHarness(...args: string[]): string {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: harnessEnv(),
  })
}

/** Like runHarness, but threads environment overrides into the harness process. */
function runHarnessEnv(env: Record<string, string>, ...args: string[]): string {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: harnessEnv(env),
  })
}

/** Run the real `pr_for_branch` / `pr_ci_state` against fixture `gh` output. */
function prForBranch(ghJson: unknown): string {
  return runHarness('pr-for-branch', JSON.stringify(ghJson)).trim()
}

/**
 * One `gh pr checks` row. A bare bucket string models a GitHub Actions job —
 * those always carry a non-empty `workflow`. The object form is for a
 * third-party commit status, which reports `workflow: ""`; that field is what
 * the HON-600 pending-only exemption keys on, so it has to be in the fixture.
 */
type CheckFixture = string | { bucket: string; workflow: string }

/** A commit status posted by a third-party GitHub app, e.g. Vercel's deploy. */
const commitStatus = (bucket: string) => ({ bucket, workflow: '' })

function ciState(checks: CheckFixture[]): string {
  const rows = checks.map((check) =>
    typeof check === 'string' ? { bucket: check, workflow: 'CI' } : check,
  )
  return runHarness('ci-state', JSON.stringify(rows)).trim()
}

describe('orchestrator.sh', () => {
  // HON-572 widened this: worktree-claude.sh and neon-cleanup.sh are edited by
  // the same fixes, and a shell syntax error there is only caught at run time —
  // on the unattended path, hours after the change landed.
  it.each([
    ['orchestrator.sh', orchestrator],
    ['worktree-claude.sh', worktreeClaude],
    ['neon-cleanup.sh', neonCleanup],
    ['e2e-local.sh', e2eLocal],
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
  //
  // handle_failure now holds no reset at all. Moving the reset onto the
  // spawn_worker branch is not enough: that branch runs on every issue's FIRST
  // failure, so the counter oscillates 0 -> 1 -> 0 under exactly the fault the
  // breaker exists to stop. handle_success owns the only reset in the script.
  describe('handle_failure circuit breaker', () => {
    type Breaker = {
      out: string
      consecutiveFailures: number
      paused: boolean
      statusJson: { consecutive_failures: number }
    }

    function parse(out: string): Breaker {
      const clean = stripTimestamps(out)
      const read = (key: string) => clean.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1] ?? ''
      return {
        out: clean,
        consecutiveFailures: Number(read('CONSECUTIVE_FAILURES')),
        paused: read('PAUSED') === 'true',
        statusJson: JSON.parse(read('STATUS_JSON') || '{}') as { consecutive_failures: number },
      }
    }

    function drive(triage: string, retried: string, shuttingDown: string, repeat = 1): Breaker {
      return parse(runHarness('failure', triage, retried, shuttingDown, String(repeat)))
    }

    /** Replay a sequence of differing failures in one orchestrator process. */
    function driveSequence(...steps: string[]): Breaker {
      return parse(runHarness('failure-seq', steps.join(',')))
    }

    it('counts a retry as a failure rather than resetting the counter', () => {
      // A retry is a failure that gets another chance, not a success. Only
      // handle_success clears the breaker.
      const r = drive('RETRY', '0', 'false')

      expect(r.out).toContain('SPAWN_WORKER:HON-991:retry=1')
      expect(r.out).not.toContain('MOVE_TO_BACKLOG')
      expect(r.consecutiveFailures).toBe(1)
    })

    it('counts a RETRY verdict that was already retried as a failure', () => {
      const r = drive('RETRY', '1', 'false')

      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
      expect(r.out).not.toContain('SPAWN_WORKER')
      expect(r.consecutiveFailures).toBe(1)
    })

    it('counts a RETRY verdict during shutdown as a failure', () => {
      // The shutdown branch is terminal too — no worker is ever respawned.
      const r = drive('RETRY', '0', 'true')

      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
      expect(r.out).not.toContain('SPAWN_WORKER')
      expect(r.consecutiveFailures).toBe(1)
    })

    it.each([
      ['BACKLOG', 'Failed'],
      ['NEEDS_HUMAN', 'Needs attention'],
    ])('counts a %s verdict as a failure', (triage, label) => {
      const r = drive(triage, '0', 'false')

      expect(r.out).toContain(`MOVE_TO_BACKLOG:HON-991:${label}`)
      expect(r.consecutiveFailures).toBe(1)
    })

    it('engages the breaker after MAX_CONSECUTIVE_FAILURES terminal failures', () => {
      const r = drive('RETRY', '1', 'false', 3)

      expect(r.consecutiveFailures).toBeGreaterThanOrEqual(3)
      expect(r.paused).toBe(true)
      expect(r.out).toContain('Circuit breaker: 3 consecutive failures')
    })

    it('engages the breaker when a systemic fault sweeps the queue', () => {
      // The runaway this exists to stop, replayed as it actually occurs: each
      // issue fails once at retried=0 (respawned) and again at retried=1
      // (Backlog), across three different issues. Any reset inside
      // handle_failure — on the verdict OR on the spawn_worker branch — makes
      // the counter oscillate here and never reach the threshold. Both earlier
      // shapes of this code stop at CONSECUTIVE_FAILURES=1 with paused=false.
      const r = driveSequence(
        'RETRY:0:false',
        'RETRY:1:false',
        'RETRY:0:false',
        'RETRY:1:false',
        'RETRY:0:false',
        'RETRY:1:false',
      )

      expect(r.out).toContain('SPAWN_WORKER:HON-991:retry=1')
      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-992:Failed')
      expect(r.consecutiveFailures).toBeGreaterThanOrEqual(3)
      expect(r.paused).toBe(true)
      expect(r.out).toContain('Circuit breaker: 3 consecutive failures')
    })

    it('lets the success path clear a breaker that handle_failure never resets', () => {
      // The counter must still be clearable, or an isolated flake would ratchet
      // the orchestrator into a permanent pause. record_success owns that reset
      // — HON-583 moved it there so the exit-0 and timeout paths share it — and
      // it must stay the only one in the script.
      const orchestratorSource = fs.readFileSync(orchestrator, 'utf8')
      const failureBody = shellFunctionBody(orchestratorSource, 'handle_failure')
      const successBody = shellFunctionBody(orchestratorSource, 'record_success')

      expect(failureBody).not.toMatch(/CONSECUTIVE_FAILURES=0/)
      expect(successBody).toMatch(/CONSECUTIVE_FAILURES=0/)

      // No other outcome handler may reset it. (Two resets outside this set are
      // legitimate and deliberately not counted: the global initialiser, and the
      // poll loop clearing the counter when a pause expires.)
      for (const fn of ['handle_success', 'handle_timeout', 'strand_worker']) {
        expect(shellFunctionBody(orchestratorSource, fn), fn).not.toMatch(/CONSECUTIVE_FAILURES=0/)
      }
    })

    it('reports the same count in the status file wt status reads', () => {
      const r = drive('BACKLOG', '0', 'false', 2)

      expect(r.statusJson.consecutive_failures).toBe(r.consecutiveFailures)
      expect(r.statusJson.consecutive_failures).toBe(2)
    })
  })

  // ─── HON-577: raw worker log reaches the triage CLI ───────────────────────
  // handle_failure captured tail -200 (triage stdin) and tail -20 (timeout
  // prompt) of the worker log and sent them to the triage CLI with no
  // sanitize_log call — so any .env value, connection string or `set -x` trace
  // the log carried went out unredacted. The only sanitize call sat downstream
  // in move_to_backlog, guarding the Linear comment but not the CLI. The fix
  // sanitizes at the capture point, the one boundary the log enters.
  describe('triage input redaction', () => {
    const triageInput = (out: string) =>
      stripTimestamps(out).match(/^TRIAGE_INPUT:(.*)$/m)?.[1] ?? ''

    it('redacts worker-log secrets before they reach the triage CLI', () => {
      const input = triageInput(runHarness('failure', 'BACKLOG', '0', 'false'))

      expect(input).toContain('[REDACTED]')
      expect(input).not.toContain('supersecretpw')
      expect(input).not.toContain('lin_api_SECRET')
    })

    // The issue asks for sanitize_log to be the ONLY accessor, so pin the
    // invariant rather than the three call sites that happen to exist today:
    // a new raw read added later fails here instead of leaking silently.
    // monitor_workers' timeout-context read is one of these — it copies 20 raw
    // worker-log lines into orchestrator.log, the copy that outlives the
    // worker's own file.
    it('leaves no unsanitized read of a worker log', () => {
      const source = fs.readFileSync(orchestrator, 'utf8')
      const reads = source
        .split('\n')
        .filter((l) => /\$\((?:tail -\d+ "\$log_file"|extract_claude_output )/.test(l))

      expect(reads.length).toBeGreaterThan(0)
      for (const line of reads) {
        expect(line, `unsanitized worker-log read: ${line.trim()}`).toContain('sanitize_log')
      }
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

    it('honours the first SIGTERM without waiting out the poll interval', () => {
      // Bash defers a trap while it waits on a FOREGROUND command, so a SIGTERM
      // arriving during `sleep "$POLL_INTERVAL"` sat pending for up to 60s —
      // longer than the 15s cmd_stop allows before it escalates, so the
      // orchestrator had often not begun shutting down at all. `wait` on a
      // backgrounded sleep IS interruptible.
      const source = fs.readFileSync(orchestrator, 'utf8')

      expect(source).toMatch(/^interruptible_sleep\(\) \{$/m)
      expect(source).toContain('interruptible_sleep "$POLL_INTERVAL"')
      expect(source).not.toMatch(/^\s*sleep "\$POLL_INTERVAL"\s*$/m)
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

    const BRANCH = 'kaupo/hon-576-fixture'

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
        log?: string[]
      } = {},
    ): Fixture {
      const { commits = 0, dirty = false, pushed = false, staleRemoteRef = false, log = [] } = opts
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
        'kaupo/hon-576-untracked',
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

  // ─── HON-578: bounded triage call ─────────────────────────────────────────
  // The Claude triage call runs synchronously inside monitor_workers, which the
  // poll loop calls every cycle. With no bound, a wedged CLI stops issue
  // polling, worker reaping and timeout enforcement while every status file
  // still reads healthy. A hit bound is a stuck tool, not a diagnosis, so it
  // falls back to BACKLOG, not the NEEDS_HUMAN branch a real CLI error takes.
  describe('handle_failure triage timeout', () => {
    const driveTriage = (env: Record<string, string>) =>
      stripTimestamps(runHarnessEnv(env, 'failure', 'RETRY', '0', 'false', '1'))

    it('falls back to BACKLOG when the triage call outlives its bound', () => {
      // The stubbed verdict is RETRY; the hang must override it.
      const out = driveTriage({ HARNESS_CLAUDE_SLEEP: '3', ORCHESTRATOR_TRIAGE_TIMEOUT: '1' })

      expect(out).toContain('Claude triage timed out after 1s, falling back to BACKLOG')
      expect(out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
      expect(out).not.toContain('SPAWN_WORKER')
      // A stuck tool is still a failure to ship, so it counts toward the breaker.
      expect(out).toContain('CONSECUTIVE_FAILURES:1')
    })

    it('leaves the healthy path unchanged when the call answers within the bound', () => {
      // Same RETRY verdict, no hang: it is honoured and the issue is retried.
      const out = driveTriage({ ORCHESTRATOR_TRIAGE_TIMEOUT: '120' })

      expect(out).not.toContain('timed out')
      expect(out).toContain('SPAWN_WORKER:HON-991:retry=1')
    })

    it('routes the triage call through the timeout wrapper', () => {
      const source = fs.readFileSync(orchestrator, 'utf8')
      const failureBody = shellFunctionBody(source, 'handle_failure')
      const wrapper = shellFunctionBody(source, 'run_with_timeout')

      expect(failureBody).toContain('run_with_timeout "$TRIAGE_TIMEOUT"')
      // Prefers GNU timeout, then gtimeout (coreutils on macOS), then the
      // pure-bash watchdog — never an unbounded passthrough.
      expect(wrapper).toContain('timeout "$secs"')
      expect(wrapper).toContain('gtimeout "$secs"')
      expect(wrapper).toContain('bash_timeout "$secs"')
      // The passthrough that made the whole guard a no-op wherever coreutils
      // is absent. `"$@"` alone on a line is the shape to keep out.
      expect(wrapper).not.toMatch(/^\s*"\$@"\s*$/m)
    })
  })

  // ─── HON-578: the coreutils-free fallback ─────────────────────────────────
  // macOS ships neither `timeout` nor `gtimeout` — both come from coreutils,
  // which is not installed by default — and the orchestrator's host is a Mac.
  // So this is the branch that runs in production, while Linux CI always takes
  // the GNU branch and would never exercise it. Drive it directly.
  describe('bash_timeout watchdog', () => {
    const drive = (bound: string, commandSleep: string) =>
      runHarness('bash-timeout', bound, commandSleep)

    it('reports 124 when the command outlives the bound', () => {
      const out = drive('1', '4')

      expect(out).toContain('EXIT:124')
      // Killed before it could echo, so the bound really cut it short.
      expect(out).not.toContain('piped-stdin')
    })

    it('passes stdin through and returns the real status inside the bound', () => {
      const out = drive('5', '0')

      expect(out).toContain('EXIT:0')
      // Bash gives an async command /dev/null for stdin when job control is
      // off; without the explicit re-attach the triage CLI would be handed an
      // empty log and asked to diagnose it.
      expect(out).toContain('OUT:piped-stdin')
    })
  })

  // ─── HON-578: log rotation and pruning ────────────────────────────────────
  // orchestrator.log is append-only and each worker writes its own file, so
  // unbounded growth eventually trips check_disk_space's 1GB guard and reads as
  // an infrastructure fault. rotate_logs runs once at startup to bound both.
  describe('log rotation and pruning', () => {
    const dirs: string[] = []

    afterAll(() => {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    })

    function makeDir(): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hon578-logs-'))
      dirs.push(d)
      return d
    }

    const rotate = (dir: string, env: Record<string, string> = {}) =>
      runHarnessEnv(env, 'rotate-logs', dir)

    it('rotates the main log to .1 once it passes the size cap', () => {
      const dir = makeDir()
      fs.writeFileSync(path.join(dir, 'orchestrator.log'), 'x'.repeat(2000))
      const out = rotate(dir, { ORCHESTRATOR_LOG_MAX_BYTES: '1000' })

      expect(out).toContain('ROTATED_EXISTS:yes')
      expect(fs.existsSync(path.join(dir, 'orchestrator.log.1'))).toBe(true)
    })

    it('leaves a main log under the cap in place', () => {
      const dir = makeDir()
      fs.writeFileSync(path.join(dir, 'orchestrator.log'), 'x'.repeat(100))
      const out = rotate(dir, { ORCHESTRATOR_LOG_MAX_BYTES: '1000' })

      expect(out).toContain('ROTATED_EXISTS:no')
      expect(fs.existsSync(path.join(dir, 'orchestrator.log.1'))).toBe(false)
    })

    it('prunes worker logs past the retention window but keeps recent ones', () => {
      const dir = makeDir()
      const old = path.join(dir, 'worker-HON-1-old.log')
      const recent = path.join(dir, 'worker-HON-2-new.log')
      fs.writeFileSync(old, 'old\n')
      fs.writeFileSync(recent, 'new\n')
      const twentyDaysAgo = Date.now() / 1000 - 20 * 24 * 3600
      fs.utimesSync(old, twentyDaysAgo, twentyDaysAgo)

      const out = rotate(dir, { ORCHESTRATOR_WORKER_LOG_MAX_AGE_DAYS: '14' })

      expect(out).toContain('WORKER:worker-HON-2-new.log')
      expect(out).not.toContain('WORKER:worker-HON-1-old.log')
      expect(fs.existsSync(old)).toBe(false)
      expect(fs.existsSync(recent)).toBe(true)
    })

    it('runs rotate_logs at startup, before the poll loop', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')
      const rotateIndex = body.indexOf('rotate_logs')
      const loopIndex = body.indexOf('while true')

      expect(rotateIndex).toBeGreaterThan(-1)
      expect(loopIndex).toBeGreaterThan(rotateIndex)
    })
  })

  // ─── HON-578: workflow-state UUID validation ──────────────────────────────
  // The state IDs are hardcoded. A state recreated in the workspace gets a new
  // UUID, and a stale STATE_TODO makes fetch_todo_issues match nothing forever
  // — the queue just looks empty. validate_environment now resolves each ID
  // against Linear and fails fast, naming the stale constant.
  describe('workflow-state UUID validation', () => {
    // Kept in sync with orchestrator.sh by the last test in this block.
    const LIVE_STATES = {
      STATE_BACKLOG: '035a5cef-88de-4334-98a0-b908f61d26a7',
      STATE_TODO: 'bcd0f639-33dd-4da8-a081-4d409c0fe5b4',
      STATE_IN_PROGRESS: 'efa0cbda-898d-440d-a6a9-36e798d00881',
      STATE_DONE: '5b47cab2-e519-4532-8aa2-f4926e16bcd7',
      STATE_CANCELED: '20dedb1c-9cb4-4db4-8a3a-c2eb39fbd616',
      STATE_DUPLICATE: 'd173c772-7085-46c9-bece-6a8a74d0ae27',
    }

    function statesJson(ids: string[]): string {
      return JSON.stringify({
        data: { workflowStates: { nodes: ids.map((id) => ({ id, name: id })) } },
      })
    }

    const validate = (ids: string[]) =>
      stripTimestamps(runHarness('validate-states', statesJson(ids)))

    it('passes when every constant resolves to a live state', () => {
      const out = validate(Object.values(LIVE_STATES))

      expect(out).toContain('STALE_COUNT:0')
      expect(out).not.toContain('Stale workflow-state UUID')
    })

    it('names the stale constant when its UUID no longer exists', () => {
      // Todo recreated: its old UUID is gone, a fresh one takes its place.
      const others = Object.values(LIVE_STATES).filter((id) => id !== LIVE_STATES.STATE_TODO)
      const out = validate([...others, 'a-freshly-minted-todo-uuid'])

      expect(out).toContain('STALE_COUNT:1')
      expect(out).toContain('Stale workflow-state UUID: STATE_TODO')
      expect(out).toContain(LIVE_STATES.STATE_TODO)
    })

    it('flags every stale constant, not just the first', () => {
      const out = validate([LIVE_STATES.STATE_TODO])

      expect(out).toContain('STALE_COUNT:5')
    })

    it('fails closed when Linear returns nothing', () => {
      const out = stripTimestamps(runHarness('validate-states', ''))

      expect(out).toContain('STALE_COUNT:1')
      expect(out).toContain('Cannot resolve Linear workflow states')
    })

    it('keeps the fixture UUIDs in sync with the orchestrator constants', () => {
      const source = fs.readFileSync(orchestrator, 'utf8')

      for (const [name, id] of Object.entries(LIVE_STATES)) {
        expect(source, `${name} drifted from the fixture`).toContain(`${name}="${id}"`)
      }
    })

    it('folds the state check into validate_environment', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'validate_environment')

      expect(body).toContain('validate_state_ids')
      expect(body).toContain('errors=$((errors + state_errors))')
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
        expect(normalize('kaupokorv/hon-51-slug')).toBe('kaupokorv--hon-51-slug')
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
  // ─── HON-580: janitorial pass over the orchestrator scripts ───────────────
  // Five minor HON-572 follow-ups. Each was invisible rather than broken: a
  // queue that truncated without saying so, a dead function, two hints naming
  // an entry point that cannot work, and a .env load that executed the file.
  describe('HON-580 orchestrator script cleanup', () => {
    describe('Todo queue cap', () => {
      const fetchTodo = (count: number) => stripTimestamps(runHarness('todo-cap', String(count)))

      it('warns when the queue is deeper than the cap, naming what it saw', () => {
        const out = fetchTodo(51)

        expect(out).toContain('WARN')
        expect(out).toContain('Todo queue is deeper than the 50-issue query cap')
        // The count, not the cap: the extra row is a live candidate that
        // select_next_issue sorts across, so at exactly 51 nothing was missed.
        // A message asserting otherwise is a false alarm every poll interval.
        expect(out).toContain('considered 51 issue(s)')
      })

      it.each([0, 1, 50])('stays silent at %i issues', (count) => {
        expect(fetchTodo(count)).not.toContain('Todo queue is deeper')
      })

      it('leaves the JSON the caller parses uncontaminated', () => {
        // log() writes stderr and $MAIN_LOG. A WARN on stdout would break
        // select_next_issue's jq parse on exactly the poll that needed it most.
        expect(fetchTodo(51)).toContain('NODES:51')
      })

      it('asks for one row past the cap, from the named constant', () => {
        const source = fs.readFileSync(orchestrator, 'utf8')
        const body = shellFunctionBody(source, 'fetch_todo_issues')

        expect(source).toContain('LINEAR_TODO_PAGE_SIZE=50')
        expect(body).toContain('first: \'"$((LINEAR_TODO_PAGE_SIZE + 1))"\'')
        // The bare literal the query and the message used to drift apart on.
        expect(body).not.toContain('first: 50')
      })
    })

    it('has no dead worktree_exists()', () => {
      // Zero callers, and its `grep -q "$path"` lacked -F, so a path with regex
      // metacharacters would have matched wrongly. get_worktree_path does the
      // real work.
      expect(fs.readFileSync(worktreeClaude, 'utf8')).not.toContain('worktree_exists')
    })

    describe('entry point', () => {
      // ./scripts/orchestrator.sh does not load .env — the wt dispatcher does —
      // so a direct invocation dies on a missing LINEAR_API_KEY.
      it('points cmd_status at wt start', () => {
        const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_status')

        expect(body).not.toContain('./scripts/orchestrator.sh')
        expect(body).toContain('wt start')
      })

      it('points PARALLEL_WORKFLOW.md at wt start', () => {
        const doc = fs.readFileSync(
          path.join(scriptsDir, '..', 'docs', 'PARALLEL_WORKFLOW.md'),
          'utf8',
        )

        // An invocation is a line that RUNS it. Prose naming the path (the
        // sentence explaining why not to run it) is the point, not a relapse.
        const invocations = doc
          .split('\n')
          .filter((line) => line.trimStart().startsWith('./scripts/orchestrator.sh'))

        expect(invocations).toEqual([])
        expect(doc).toContain('wt start --dry-run')
      })
    })

    it('no longer ships or advertises worktree-status.sh', () => {
      // Superseded by `wt status` / `wt watch`.
      expect(fs.existsSync(path.join(scriptsDir, 'worktree-status.sh'))).toBe(false)
      expect(fs.readFileSync(worktreeClaude, 'utf8')).not.toContain('worktree-status.sh')
    })

    describe('.env is parsed, not sourced', () => {
      let dir: string

      /** Run the real load_env_file over a fixture and return KEY -> value. */
      function loadEnv(contents: string, env: Record<string, string> = {}): Map<string, string> {
        const file = path.join(dir, '.env')
        fs.writeFileSync(file, contents)
        const out = execFileSync('bash', [harness, 'load-env', file], {
          encoding: 'utf8',
          timeout: 30_000,
          env: harnessEnv(env),
        })
        // NUL-separated records, so a value containing a newline arrives whole.
        return new Map(
          out
            .split('\0')
            .filter(Boolean)
            .map((entry) => [
              entry.slice(0, entry.indexOf('=')),
              entry.slice(entry.indexOf('=') + 1),
            ]),
        )
      }

      beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon580-env-'))
      })

      afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

      it('does not execute a command substitution in a value', () => {
        // `source` ran the file as shell, so this line was a working command.
        const canary = path.join(dir, 'pwned')
        const parsed = loadEnv(`HON580_PWNED=$(touch ${canary})\n`)

        expect(fs.existsSync(canary)).toBe(false)
        expect(parsed.get('HON580_PWNED')).toBe(`$(touch ${canary})`)
      })

      it('handles quotes, embedded `=`, comments, blanks and export prefixes', () => {
        const parsed = loadEnv(
          [
            '# a comment',
            '   # an indented comment',
            '',
            'HON580_PLAIN=plainvalue',
            'HON580_QUOTED="quoted value"',
            "HON580_SINGLE='single value'",
            'HON580_EQUALS=postgresql://u:p@h/db?a=1&b=2',
            'HON580_EMPTY=',
            'export HON580_EXPORTED=yes',
            'export   HON580_SPACED=yes',
            '',
          ].join('\n'),
        )

        expect(parsed.get('HON580_PLAIN')).toBe('plainvalue')
        expect(parsed.get('HON580_QUOTED')).toBe('quoted value')
        expect(parsed.get('HON580_SINGLE')).toBe('single value')
        // Split on the FIRST `=`, so a connection string survives whole.
        expect(parsed.get('HON580_EQUALS')).toBe('postgresql://u:p@h/db?a=1&b=2')
        expect(parsed.get('HON580_EMPTY')).toBe('')
        expect(parsed.get('HON580_EXPORTED')).toBe('yes')
        expect(parsed.get('HON580_SPACED')).toBe('yes')
      })

      it('accepts a tab after `export`, as source did', () => {
        // Matching only a literal `export ` dropped the line with no
        // diagnostic. On LINEAR_API_KEY that reads as "not set (check .env)"
        // while the key is sitting in the file.
        const parsed = loadEnv('export\tHON580_TABBED=tabbed\n')

        expect(parsed.get('HON580_TABBED')).toBe('tabbed')
      })

      it('joins a quoted value left open across lines', () => {
        // Taking only the first line exported a plausible WRONG value —
        // silently truncated, with the opening quote still attached.
        const parsed = loadEnv('HON580_MULTI="line1\nline2"\nHON580_AFTER=reached\n')

        expect(parsed.get('HON580_MULTI')).toBe('line1\nline2')
        // The continuation is consumed, not re-parsed as its own assignment.
        expect(parsed.get('HON580_AFTER')).toBe('reached')
      })

      it('keeps a quote left unterminated at EOF visible in the value', () => {
        // Better a visibly malformed string than a plausible wrong one.
        const parsed = loadEnv('HON580_UNBALANCED="stillquoted\n')

        expect(parsed.get('HON580_UNBALANCED')).toBe('"stillquoted')
      })

      it('trims an unquoted value the way source did, and only an unquoted one', () => {
        // A trailing space on LINEAR_API_KEY still passes validate_environment's
        // `^lin_api_` check, so the failure surfaces as "Cannot connect to
        // Linear API" rather than anything naming the real cause.
        const parsed = loadEnv(
          [
            'HON580_TRAILWS=lin_api_abc123   ',
            'HON580_QUOTEDWS="keep me   "',
            'HON580_COMMENT=val # a comment',
            'HON580_QCOMMENT="val # kept"',
            'HON580_HASHINWORD=p@ss#word',
            '',
          ].join('\n'),
        )

        expect(parsed.get('HON580_TRAILWS')).toBe('lin_api_abc123')
        expect(parsed.get('HON580_QUOTEDWS')).toBe('keep me   ')
        expect(parsed.get('HON580_COMMENT')).toBe('val')
        expect(parsed.get('HON580_QCOMMENT')).toBe('val # kept')
        // The `#` must be whitespace-preceded to start a comment, so a `#`
        // inside a password survives.
        expect(parsed.get('HON580_HASHINWORD')).toBe('p@ss#word')
      })

      it('skips malformed lines without aborting the load', () => {
        // The dispatcher runs under `set -e`; a fatal parse would take out every
        // wt subcommand, not just the bad line.
        const parsed = loadEnv(
          [
            'this line has no equals sign',
            '123BAD=nope',
            'HON580_AFTER=reached',
            'HON580_NOEOL=lastline', // deliberately no trailing newline
          ].join('\n'),
        )

        expect(parsed.get('HON580_AFTER')).toBe('reached')
        expect(parsed.get('HON580_NOEOL')).toBe('lastline')
        expect(parsed.has('123BAD')).toBe(false)
      })

      it('lets .env win over a variable the caller already exported', () => {
        // Same precedence `set -a` + `source` had, and `wt auto` depends on it.
        // The fixture must NAME the variable — asserting on one the file never
        // mentions passes against any implementation, including the old one.
        const parsed = loadEnv('HON580_PRE=fromfile\n', { HON580_PRE: 'preexisting' })

        expect(parsed.get('HON580_PRE')).toBe('fromfile')
      })

      it('leaves a variable the file does not name alone', () => {
        const parsed = loadEnv('HON580_PLAIN=fromfile\n', { HON580_OTHER: 'untouched' })

        expect(parsed.get('HON580_OTHER')).toBe('untouched')
      })

      it('is a silent no-op when the file is missing', () => {
        expect(() =>
          execFileSync('bash', [harness, 'load-env', path.join(dir, 'nope.env')], {
            encoding: 'utf8',
            timeout: 30_000,
            env: harnessEnv(),
          }),
        ).not.toThrow()
      })

      // e2e-local.sh carries its own copy of the parser — it does not source
      // worktree-claude.sh — so a `set -a` + `source` relapse there is the same
      // defect one file over. Assert on both, or the fix half-holds.
      it.each([
        ['worktree-claude.sh', worktreeClaude],
        ['e2e-local.sh', e2eLocal],
      ])('%s parses .env rather than sourcing it', (_n, script) => {
        const source = fs.readFileSync(script, 'utf8')

        expect(source).toContain('load_env_file "$REPO_ROOT/.env"')
        expect(source).not.toContain('source "$REPO_ROOT/.env"')
        expect(source.split('\n').some((l) => l.trim() === 'set -a')).toBe(false)
      })

      it('keeps the two copies of the parser in step', () => {
        // The repo duplicates helpers between scripts for self-containment
        // (CLAUDE.md); a divergence here is worse than the duplication.
        const body = (script: string) =>
          shellFunctionBody(fs.readFileSync(script, 'utf8'), 'load_env_file')

        expect(body(e2eLocal)).toBe(body(worktreeClaude))
      })
    })
  })
  // ─── HON-580: sanitize_log and load_env_file must agree on a value ────────
  // load_env_file exports what `source` would have: a trailing ` # comment` and
  // trailing whitespace are stripped, so they are not part of the runtime
  // secret. sanitize_log kept them, so it searched the log for a string the log
  // could not contain and the secret shipped unredacted. The issue asked the
  // two to agree on "what counts as a value"; these pin that agreement.
  // ─── HON-581: Neon create-error classification ────────────────────────────
  // The cap heuristic used to be tested first, and both greps ran over the raw
  // neonctl output — which echoes the branch name back. Any branch whose slug
  // contained `cap`, `limit`, `quota`, `exceed` or `maximum` therefore turned a
  // plain "already exists" into a reported capacity problem, and the reuse path
  // the orchestrator RETRY depends on became unreachable. HON-580's own branch
  // did exactly that: its retry died in 1m1s while PR #667 sat green.
  describe('HON-581 Neon create-error classification', () => {
    // The real strings from the incident, not a paraphrase.
    const HON580_BRANCH =
      'kaupo/hon-580-orchestrator-script-cleanup-silent-queue-cap-dead-code-stale'
    const HON580_NEON = HON580_BRANCH.replace('/', '--')
    const EXISTS_ERROR = `ERROR: branch already exists; branch_name:"${HON580_NEON}"`
    // A cap error whose branch name is free of the exhaustion substrings, so
    // the cap path is reached on the error text and nothing else.
    const CAP_ERROR = 'ERROR: branch limit exceeded for project'
    const KEYWORDS = ['limit', 'quota', 'cap', 'exceed', 'maximum']

    // Built rather than written as a literal: the escape is a control
    // character, and a literal one in a regex trips no-control-regex.
    const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

    function classify(output: string, neonBranch: string): string {
      return runHarness('neon-classify-create', output, neonBranch).trim()
    }

    function create(
      output: string,
      gitBranch: string,
      reuse: 0 | 1,
      retry: 'retry-ok' | 'retry-fail' = 'retry-fail',
      freshDb: 0 | 1 = 0,
    ) {
      const text = runHarness(
        'neon-create',
        output,
        gitBranch,
        String(reuse),
        retry,
        String(freshDb),
      ).replace(ANSI, '')
      const lines = text.split('\n')

      return {
        text,
        // The ordered call log the harness appends to: GC has to land BETWEEN
        // the two creates, which a plain "did GC run" boolean cannot express.
        calls: lines.filter((l) => ['CREATE', 'GC_RAN', 'DELETE'].includes(l)),
        exit: Number(lines.find((l) => l.startsWith('EXIT:'))?.slice(5)),
      }
    }

    it('takes the reuse path for an already-exists error whose name contains cap', () => {
      const result = create(EXISTS_ERROR, HON580_BRANCH, 1)

      expect(result.text).toContain('already exists — reusing it')
      expect(result.text).not.toContain('Neon branch cap hit')
      // One create, no GC, and no delete — the branch holds the work being
      // resumed, so anything that touches it is a data-loss bug.
      expect(result.calls).toEqual(['CREATE'])
      expect(result.exit).toBe(0)
    })

    it('hard-fails on the same error when the branch is not being resumed', () => {
      const result = create(EXISTS_ERROR, HON580_BRANCH, 0)

      expect(result.text).toContain(`Neon branch '${HON580_NEON}' already exists.`)
      expect(result.text).toContain(`Run 'wt cleanup ${HON580_BRANCH}'`)
      // The branch name carries `cap` and both messages echo it, so the guard
      // has to name the cap path's own sentences rather than the substring.
      expect(result.text).not.toContain('Neon branch cap hit')
      expect(result.text).not.toContain('cap still exceeded')
      expect(result.calls).toEqual(['CREATE'])
      expect(result.exit).toBe(1)
    })

    it('still runs orphan GC and retries once for a genuine cap error', () => {
      const result = create(CAP_ERROR, 'kaupo/hon-581-neutral-slug', 0, 'retry-ok')

      expect(result.text).toContain('Neon branch cap hit — running orphan GC...')
      expect(result.calls).toEqual(['CREATE', 'GC_RAN', 'CREATE'])
      expect(result.exit).toBe(0)
    })

    it('retries the cap path exactly once before giving up', () => {
      const result = create(CAP_ERROR, 'kaupo/hon-581-neutral-slug', 0, 'retry-fail')

      expect(result.text).toContain('Neon branch cap still exceeded after orphan GC.')
      expect(result.calls).toEqual(['CREATE', 'GC_RAN', 'CREATE'])
      expect(result.exit).toBe(1)
    })

    it('falls through to the generic create failure for an unrecognised error', () => {
      const result = create('ERROR: connection reset by peer', 'kaupo/hon-581-neutral-slug', 1)

      expect(result.text).toContain('Neon branch create failed:')
      expect(result.text).toContain('ERROR: connection reset by peer')
      expect(result.calls).toEqual(['CREATE'])
      expect(result.exit).toBe(1)
    })

    it.each(KEYWORDS)('reads an already-exists error as exists when the name holds %s', (kw) => {
      const name = `kaupo--hon-1-queue-${kw}-slug`

      expect(classify(`ERROR: branch already exists; branch_name:"${name}"`, name)).toBe('exists')
    })

    it.each(KEYWORDS)('never invents a cap verdict from a name holding %s', (kw) => {
      const name = `kaupo--hon-1-queue-${kw}-slug`

      expect(classify(`ERROR: internal server error; branch_name:"${name}"`, name)).toBe('unknown')
    })

    it('strips the branch name even when neonctl does not use the branch_name field', () => {
      // The `branch_name:"…"` sed is the documented shape; the literal removal
      // is what covers every other way the name can come back.
      const name = 'kaupo--hon-1-queue-cap-slug'

      expect(classify(`ERROR: could not create ${name}: internal error`, name)).toBe('unknown')
    })

    it('removes the branch name as a fixed string, not as a glob', () => {
      // `${text//$b/}` would read the name as a GLOB, not a regex — so the
      // discriminating fixture needs a bracket expression, and `.` (which an
      // earlier version of this test used) proves nothing. `git
      // check-ref-format` rejects `[`, so no real branch reaches here; this
      // pins the helper's contract, not a live scenario. Unquoted, the glob
      // eats `a--hon-1-branch-limit` out of the text and the verdict collapses
      // to unknown.
      const name = 'a--hon-1-branch-[l]imit'

      expect(classify(`ERROR: a--hon-1-branch-limit could not be created`, name)).toBe('cap')
    })

    // The cap path is destructive: neon_gc_orphans deletes every Neon branch
    // with no live worktree, project-wide, and handle_failure's RETRY parks
    // exactly that shape (worktree removed, branch kept) for the respawn to
    // resume. So an error that merely CONTAINS an exhaustion substring must not
    // reach it — one worker's rate limit would drop another worker's retry DB.
    describe('the cap verdict requires branch and a keyword on one line', () => {
      it.each([
        ['a rate limit, which GC cannot help with', 'ERROR: Rate limit exceeded'],
        ['a compute quota, not a branch quota', 'ERROR: compute time quota exceeded'],
        ['es-CAP-e', 'ERROR: invalid escape sequence in request body'],
        ['de-LIMIT-er', 'ERROR: unexpected delimiter in response'],
        ['region capacity', 'ERROR: insufficient capacity in region eu-central-1'],
      ])('does not read %s as branch exhaustion', (_label, error) => {
        expect(classify(error, 'kaupo--hon-581-neutral-slug')).toBe('unknown')
      })

      it.each([
        ['keyword after branch', 'ERROR: branch limit exceeded for project'],
        [
          'keyword before branch',
          'You have reached the maximum number of branches for this project',
        ],
      ])('still reads a genuine cap error (%s) as cap', (_label, error) => {
        expect(classify(error, 'kaupo--hon-581-neutral-slug')).toBe('cap')
      })

      it('never sweeps on a rate-limit response', () => {
        const result = create('ERROR: Rate limit exceeded', 'kaupo/hon-581-neutral-slug', 0)

        expect(result.calls).toEqual(['CREATE'])
        expect(result.text).toContain('Neon branch create failed:')
      })
    })

    // --fresh-db pre-deletes with errors silenced, so a delete that never took
    // arrives here as "already exists". Reusing then would hand back the exact
    // stale database the caller asked to destroy — and both docs this branch
    // touches promise delete-and-recreate.
    it('refuses to reuse an existing branch when --fresh-db was requested', () => {
      const result = create(
        'ERROR: branch already exists',
        'kaupo/hon-581-neutral-slug',
        1,
        'retry-fail',
        1,
      )

      expect(result.text).toContain('still exists after the --fresh-db delete')
      expect(result.text).not.toContain('reusing it')
      expect(result.calls).toEqual(['DELETE', 'CREATE'])
      expect(result.exit).toBe(1)
    })

    describe('static guards', () => {
      const source = () => fs.readFileSync(worktreeClaude, 'utf8')

      it('tests the unambiguous exists signal before the cap heuristic', () => {
        // Anchored on the two grep calls, not the keyword literals: the
        // exhaustion list is declared in a local above both of them, so
        // matching the list itself would compare the wrong pair.
        const body = shellFunctionBody(source(), 'neon_classify_create_error')
        const exists = body.indexOf('grep -qiE "already exists|duplicate"')
        const cap = body.indexOf('grep -qiE "branch.*($exhaustion)')

        expect(exists, 'exists grep not found').toBeGreaterThan(-1)
        expect(cap, 'cap grep not found').toBeGreaterThan(-1)
        expect(exists).toBeLessThan(cap)
      })

      it('requires branch and a keyword on the same line for a cap verdict', () => {
        // Proximity is what keeps neon_gc_orphans — which deletes other
        // workers' preserved retry branches — off an unrelated rate limit.
        const body = shellFunctionBody(source(), 'neon_classify_create_error')

        expect(body).toContain('grep -qiE "branch.*($exhaustion)|($exhaustion).*branch"')
      })

      it('never matches the raw create output, only the classifier verdict', () => {
        // Reordering alone fixed the one branch name; routing every match
        // through the classifier is what keeps a name out of control flow.
        const body = shellFunctionBody(source(), 'neon_create_branch_for_worktree')

        expect(body).toContain('neon_classify_create_error "$create_out" "$neon_branch"')
        expect(body).not.toContain('"$create_out" | grep')
      })
    })
  })

  describe('env value parity between load_env_file and sanitize_log', () => {
    let envDir: string

    // Every value is >= 8 chars so it clears sanitize_log's floor, and each is
    // distinctive enough that a partial match cannot pass by accident.
    const COMMENTED = 'abc123xyz789'
    const TRAILING_WS = 'def456uvw012'
    const QUOTED = 'ghi789rst345'
    const HASH_INSIDE = 'p@ss#word12345'

    beforeAll(() => {
      envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon580-parity-'))
      fs.writeFileSync(
        path.join(envDir, '.env'),
        [
          `COMMENTED=${COMMENTED} # rotate before Sept`,
          `TRAILING_WS=${TRAILING_WS}   `,
          `QUOTED="${QUOTED}"`,
          // No whitespace before the '#', so it is part of the value, not a comment.
          `HASH_INSIDE=${HASH_INSIDE}`,
          '',
        ].join('\n'),
      )
    })

    afterAll(() => fs.rmSync(envDir, { recursive: true, force: true }))

    const sanitize = (text: string) => runHarness('sanitize', path.join(envDir, '.env'), text)

    it('redacts a value whose .env line carries a trailing comment', () => {
      // The leak: the app prints the exported value, with no comment attached.
      const out = sanitize(`leaked: ${COMMENTED} end`)

      expect(out).toBe('leaked: [REDACTED] end')
      expect(out).not.toContain(COMMENTED)
    })

    it('redacts a value whose .env line has trailing whitespace', () => {
      expect(sanitize(`leaked: ${TRAILING_WS} end`)).toBe('leaked: [REDACTED] end')
    })

    it('redacts a quoted value as it appears unquoted at runtime', () => {
      expect(sanitize(`leaked: ${QUOTED} end`)).toBe('leaked: [REDACTED] end')
    })

    it('keeps a # that is part of the value rather than a comment', () => {
      // No whitespace before it, so `source` would not have started a comment.
      expect(sanitize(`leaked: ${HASH_INSIDE} end`)).toBe('leaked: [REDACTED] end')
    })
  })

  // ─── HON-580: the duplicated .env parser must not drift ───────────────────
  // e2e-local.sh carries its own copy of load_env_file because it does not
  // source worktree-claude.sh. Two copies of a security-sensitive parser drift;
  // this fails the moment they do, which is the only thing keeping the comment
  // "keep the two in step" honest.
  describe('load_env_file copies', () => {
    it('are byte-identical across worktree-claude.sh and e2e-local.sh', () => {
      const a = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'load_env_file')
      const b = shellFunctionBody(fs.readFileSync(e2eLocal, 'utf8'), 'load_env_file')

      expect(a.length).toBeGreaterThan(0)
      expect(b).toBe(a)
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
      expect(out).not.toContain('RESTORE_TODO')
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
      expect(out).toContain('RESTORE_TODO:HON-999')
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

  // One probe, one stranding, one success — called from both paths. Behaviour
  // tests above cover each path in isolation; only a static guard can catch one
  // path quietly growing its own copy, which is how the timeout path came to
  // miss stranded detection in the first place.
  describe('the exit-0 and timeout paths share one implementation', () => {
    const source = () => fs.readFileSync(orchestrator, 'utf8')

    it.each(['handle_success', 'handle_timeout'])('%s probes through probe_worker_pr', (fn) => {
      expect(shellFunctionBody(source(), fn)).toContain('probe_worker_pr "$')
    })

    it.each(['handle_success', 'handle_timeout'])('%s strands through strand_worker', (fn) => {
      expect(shellFunctionBody(source(), fn)).toContain('strand_worker "$issue_id"')
    })

    it.each(['handle_success', 'handle_timeout'])('%s succeeds through record_success', (fn) => {
      expect(shellFunctionBody(source(), fn)).toContain('record_success "$issue_id"')
    })

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
      ).toContain('`ORCHESTRATOR_WORKER_TIMEOUT` | 10800')
    })
  })
})
