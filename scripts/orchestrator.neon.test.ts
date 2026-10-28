import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  scriptsDir,
  orchestrator,
  worktreeClaude,
  neonCleanup,
  harness,
  harnessEnv,
  stripTimestamps,
  shellFunctionBody,
  runHarness,
  runHarnessEnv,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  // ─── HON-572 finding 4: Neon GC coverage ──────────────────────────────────
  // spawn_worker prefers Linear's branchName, so the orchestrator's real branch
  // is `henritamm/hon-51-slug` -> Neon `henritamm--hon-51-slug`. Every reaper
  // looked for `auto-*` instead, so a crashed orchestrator leaked Neon branches
  // with no backstop until the project hit its branch cap.
  describe('Neon orphan GC selection', () => {
    const FIXTURE = [
      'henritamm--hon-51-slug',
      'auto--hon-51',
      'henri-interactive',
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
      expect(select()).toContain('henritamm--hon-51-slug')
    })

    it('still selects the auto-- fallback shape', () => {
      expect(select()).toContain('auto--hon-51')
    })

    it('selects NEON_USER_PREFIX branches only when the prefix is set', () => {
      expect(select('', 'henri')).toContain('henri-interactive')
      expect(select()).not.toContain('henri-interactive')
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
      const selected = select('henritamm--hon-51-slug')

      expect(selected).not.toContain('henritamm--hon-51-slug')
      expect(selected).toContain('auto--hon-51')
    })

    // HON-1415: a dead review:local branch held a cap slot no sweep freed. The
    // stub `ps` reports pid 7 as a live e2e-local.sh run on this host.
    it('selects dead e2e-local-* branches and keeps live or young ones', () => {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-e2e-'))
      fs.writeFileSync(path.join(bin, 'hostname'), '#!/bin/sh\necho box\n', { mode: 0o755 })
      const ps =
        '#!/bin/sh\ncase $2 in 7) echo "bash e2e-local.sh" ;; 8) ;; *) exec /bin/ps "$@" ;; esac\n'
      fs.mkdirSync(path.join(bin, '.config', 'wobblepot'), { recursive: true })
      fs.writeFileSync(path.join(bin, '.config', 'wobblepot', 'e2e-host-id'), '000001\n')
      fs.writeFileSync(path.join(bin, 'ps'), ps, { mode: 0o755 })
      const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
      const json = JSON.stringify([
        { name: 'e2e-local-box000001-20261028-114144-8', created_at: ago(0.1) },
        { name: 'e2e-local-box000001-20261028-114144-7', created_at: ago(9) },
        { name: 'e2e-local-other-20261028-114144-8', created_at: ago(1) },
        { name: 'e2e-local-20261028-114144-8', created_at: ago(3), updated_at: ago(0) },
      ])
      const out = execFileSync('bash', [harness, 'neon-gc-select', json, ''], {
        encoding: 'utf8',
        env: harnessEnv({
          PATH: `${bin}:${process.env.PATH}`,
          HOME: bin,
          E2E_GC_MIN_AGE_HOURS: '',
        }),
      })
      fs.rmSync(bin, { recursive: true, force: true })

      expect(out.split('\n').filter(Boolean)).toEqual([
        'e2e-local-box000001-20261028-114144-8',
        'e2e-local-20261028-114144-8',
      ])
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

    it.each(['henritamm--hon-51-slug', 'auto--hon-51', 'henri--hon-572-a-long-slug-here'])(
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
      expect(onMergeTarget('henritamm/hon-51-slug')).toBe('henritamm--hon-51-slug')
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
      'henri/hon-580-orchestrator-script-cleanup-silent-queue-cap-dead-code-stale'
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
      const result = create(CAP_ERROR, 'henri/hon-581-neutral-slug', 0, 'retry-ok')

      // The observed count is part of the message now (HON-616); the stubbed
      // `branches list` returns an empty array, hence 0.
      expect(result.text).toContain('Neon branch cap hit at 0 branches — running orphan GC...')
      expect(result.calls).toEqual(['CREATE', 'GC_RAN', 'CREATE'])
      expect(result.exit).toBe(0)
    })

    it('retries the cap path exactly once before giving up', () => {
      const result = create(CAP_ERROR, 'henri/hon-581-neutral-slug', 0, 'retry-fail')

      expect(result.text).toContain('Neon branch cap still exceeded after orphan GC.')
      expect(result.calls).toEqual(['CREATE', 'GC_RAN', 'CREATE'])
      expect(result.exit).toBe(1)
    })

    it('falls through to the generic create failure for an unrecognised error', () => {
      const result = create('ERROR: connection reset by peer', 'henri/hon-581-neutral-slug', 1)

      expect(result.text).toContain('Neon branch create failed:')
      expect(result.text).toContain('ERROR: connection reset by peer')
      expect(result.calls).toEqual(['CREATE'])
      expect(result.exit).toBe(1)
    })

    it.each(KEYWORDS)('reads an already-exists error as exists when the name holds %s', (kw) => {
      const name = `henri--hon-1-queue-${kw}-slug`

      expect(classify(`ERROR: branch already exists; branch_name:"${name}"`, name)).toBe('exists')
    })

    it.each(KEYWORDS)('never invents a cap verdict from a name holding %s', (kw) => {
      const name = `henri--hon-1-queue-${kw}-slug`

      expect(classify(`ERROR: internal server error; branch_name:"${name}"`, name)).toBe('unknown')
    })

    it('strips the branch name even when neonctl does not use the branch_name field', () => {
      // The `branch_name:"…"` sed is the documented shape; the literal removal
      // is what covers every other way the name can come back.
      const name = 'henri--hon-1-queue-cap-slug'

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
        expect(classify(error, 'henri--hon-581-neutral-slug')).toBe('unknown')
      })

      it.each([
        ['keyword after branch', 'ERROR: branch limit exceeded for project'],
        [
          'keyword before branch',
          'You have reached the maximum number of branches for this project',
        ],
      ])('still reads a genuine cap error (%s) as cap', (_label, error) => {
        expect(classify(error, 'henri--hon-581-neutral-slug')).toBe('cap')
      })

      it('never sweeps on a rate-limit response', () => {
        const result = create('ERROR: Rate limit exceeded', 'henri/hon-581-neutral-slug', 0)

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
        'henri/hon-581-neutral-slug',
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

  describe('HON-616 Neon branch budget enforcement', () => {
    type Budget = { out: string; exit: number }

    /**
     * Drive the REAL `check_branch_budget`. An empty argument leaves the value
     * orchestrator.sh resolved at source time, so the shipped defaults are
     * reachable as values rather than as source text.
     */
    function budget(maxWorkers = '', cap = ''): Budget {
      const out = stripTimestamps(runHarness('branch-budget', maxWorkers, cap))
      return { out, exit: Number(out.match(/^EXIT:(\d+)$/m)?.[1]) }
    }

    it('is silent about problems at the shipped default', () => {
      // N=5 on the Free tier's 10: 8 at peak, two spare. A gate that warns at
      // the configuration everyone runs is a gate everyone learns to ignore.
      const r = budget()

      expect(r.exit).toBe(0)
      expect(r.out).not.toContain('WARN')
      expect(r.out).not.toContain('ERROR')
      // One branch per worker since PR branches stopped getting a Vercel
      // deployment, and with it the integration's preview/* (HON-1348).
      expect(r.out).toContain('Neon branch budget: 8 of 10 at peak (5 + 3), 2 spare')
    })

    it('defaults NEON_BRANCH_CAP to the Free tier limit of 10', () => {
      // Read off the refusal, so the constant is under test as the value the
      // check actually enforces.
      expect(budget('8').out).toContain('NEON_BRANCH_CAP is 10')
    })

    it.each([
      ['8', 11],
      ['9', 12],
      ['12', 15],
    ])('refuses --max-workers %s, which needs %i branches', (workers, peak) => {
      const r = budget(workers)

      expect(r.exit).toBe(1)
      expect(r.out).toContain(`max_workers=${workers} needs ${peak} Neon branches (N + 3)`)
      // The permanent branches are why the ceiling is below the cap.
      expect(r.out).toContain('main, staging and dev/kaupo hold the other 3')
      // A refusal that does not say what to run instead just moves the guessing.
      // 6, not 7: at 7 the cap is full and the next startup warns.
      expect(r.out).toContain('Run with --max-workers 6')
      expect(budget('6').out).not.toContain('WARN')
      // `peak + 1`, not `peak`: raising the plan to exactly `peak` lands on the
      // zero-spare WARN, which tells the operator to drop back to the ceiling
      // they just paid to escape. Asserted by starting at the recommended value.
      expect(r.out).toContain(`set NEON_BRANCH_CAP to ${peak + 1} or more`)
      expect(budget(workers, String(peak + 1)).out).not.toContain('WARN')
    })

    it('names a raised cap rather than a workaround when no worker fits', () => {
      // `cap - 3 - 1` is below 1 here, so "run with --max-workers 0" would be
      // the arithmetically correct and operationally useless answer.
      const r = budget('1', '3')

      expect(r.exit).toBe(1)
      expect(r.out).toContain('No worker fits this cap')
      expect(r.out).toContain('Raise NEON_BRANCH_CAP to at least 5')
      expect(r.out).not.toContain('--max-workers 0')
    })

    it('warns but still starts when the ceiling fits with no spare', () => {
      // The spare branch is what absorbs a stranded run, which holds its branch
      // until `wt cleanup`. Fitting exactly is workable, not broken — so this
      // warns rather than refusing.
      const r = budget('3', '6')

      expect(r.exit).toBe(0)
      expect(r.out).toContain('6 of 6 used at peak — no spare branch left')
      expect(r.out).toContain('Consider --max-workers 2')
    })

    it('admits a higher ceiling once the cap is raised', () => {
      // The one knob that changes if the Neon plan is ever raised.
      const r = budget('12', '16')

      expect(r.exit).toBe(0)
      expect(r.out).toContain('15 of 16 at peak')
    })

    it('reads the cap from the environment', () => {
      const out = stripTimestamps(
        runHarnessEnv({ NEON_BRANCH_CAP: '25' }, 'branch-budget', '8', ''),
      )

      expect(out).toContain('11 of 25 at peak')
      expect(out).toContain('EXIT:0')
    })

    it.each(['abc', '0', '-1', '3.5', ''])(
      'refuses the non-count ceiling %j instead of computing with it',
      (value) => {
        // Bash evaluates a non-numeric operand as a variable name yielding 0, so
        // an unvalidated `--max-workers abc` computes a peak of 3, passes this
        // check, and then makes `[ "$active" -lt "$MAX_WORKERS" ]` fail on every
        // poll — an orchestrator that starts, logs healthily and spawns nothing.
        // '' reaches the check as the flag's own empty argument, not as "unset":
        // the harness only skips the assignment when the value is empty, so this
        // row is really the shipped default and must PASS. Kept in the same table
        // to make that asymmetry explicit rather than a gap.
        const r = budget(value)

        if (value === '') {
          expect(r.exit).toBe(0)
        } else {
          expect(r.exit).toBe(1)
          expect(r.out).toContain(`max_workers must be a positive integer, got '${value}'`)
        }
      },
    )

    it.each(['abc', '0', '-1'])('refuses the non-count cap %j', (value) => {
      const r = budget('3', value)

      expect(r.exit).toBe(1)
      expect(r.out).toContain(`NEON_BRANCH_CAP must be a positive integer, got '${value}'`)
    })

    it('never recommends a ceiling it would itself refuse', () => {
      // At MAX_WORKERS=1 the "consider one fewer" advice is `--max-workers 0`,
      // which the validation 25 lines above rejects outright. The ERROR branch
      // was guarded against exactly this; the WARN branch was not.
      const r = budget('1', '4')

      expect(r.exit).toBe(0)
      expect(r.out).toContain('no spare branch left')
      expect(r.out).not.toContain('--max-workers 0')
      expect(r.out).toContain('Raise NEON_BRANCH_CAP to 5')
    })

    it('does not enforce a branch budget on a checkout with no Neon', () => {
      // Neon branching is opt-in: with NEON_API_KEY / NEON_PROJECT_ID unset,
      // neon_create_branch_for_worktree returns 0 with "using shared DB" and no
      // branch is ever created. Refusing `--max-workers 6` there would block a
      // working configuration over a resource it does not consume.
      const out = stripTimestamps(
        runHarnessEnv({ HARNESS_NEON_DISABLED: '1' }, 'branch-budget', '6', ''),
      )

      expect(out).toContain('Neon branching disabled')
      expect(out).toContain('branch budget not enforced')
      expect(out).toContain('EXIT:0')
    })

    it('still refuses a nonsense ceiling with Neon disabled', () => {
      // The ceiling validation is not about Neon — a non-numeric MAX_WORKERS
      // breaks the poll loop's own comparison either way, so the short-circuit
      // must sit after it.
      const out = stripTimestamps(
        runHarnessEnv({ HARNESS_NEON_DISABLED: '1' }, 'branch-budget', 'abc', ''),
      )

      expect(out).toContain("max_workers must be a positive integer, got 'abc'")
      expect(out).toContain('EXIT:1')
    })

    it.each(['30m', 'abc', '-1', '1.5'])('refuses the cooldown %j at startup', (value) => {
      // Its use site is the middle of requeue_to_queue: `$(( now + COOLDOWN ))`
      // on "30m" is a fatal arithmetic error under `set -euo pipefail`, and it
      // unwinds main() AFTER the Linear comment has been posted and the issue
      // moved to Queued — leaving a stale status file and no log() trace of why.
      const out = stripTimestamps(
        runHarnessEnv({ ORCHESTRATOR_CAP_REQUEUE_COOLDOWN: value }, 'branch-budget', '', ''),
      )

      expect(out).toContain(
        `ORCHESTRATOR_CAP_REQUEUE_COOLDOWN must be a whole number of seconds, got '${value}'`,
      )
      expect(out).toContain('EXIT:1')
    })

    it('accepts the default cooldown and a numeric override', () => {
      expect(budget().exit).toBe(0)
      expect(
        stripTimestamps(
          runHarnessEnv({ ORCHESTRATOR_CAP_REQUEUE_COOLDOWN: '60' }, 'branch-budget', '', ''),
        ),
      ).toContain('EXIT:0')
    })

    it('runs before the Linear round trips, not after them', () => {
      // `cmd_start` declares success after `sleep 1` and only tails the logs
      // when the process is already dead at that mark. validate_environment and
      // fetch_team_uuid make three sequential Linear calls, each a fresh curl
      // with its own TLS handshake — so a refusal placed after them commonly
      // lands past the 1 s window and is reported to the operator as a green
      // "Orchestrator started". Being a race, it would refuse loudly on a slow
      // API day and silently on a fast one.
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')
      const gate = body.indexOf('check_branch_budget || exit 1')
      const validate = body.indexOf('\n  validate_environment')
      const fetchTeam = body.indexOf('\n  fetch_team_uuid')
      // write_status_file would otherwise run `jq --argjson max_workers "abc"`
      // on the invalid-ceiling path.
      const status = body.indexOf('\n  write_status_file')

      expect(gate).toBeGreaterThan(-1)
      expect(validate).toBeGreaterThan(gate)
      expect(fetchTeam).toBeGreaterThan(gate)
      expect(status).toBeGreaterThan(gate)
    })

    it('is wired into main() as a fatal check', () => {
      // The function is only worth anything if startup actually stops on it.
      // Asserted against the source because main()'s poll loop is not something
      // the harness can drive.
      const source = fs.readFileSync(orchestrator, 'utf8')

      expect(shellFunctionBody(source, 'main')).toContain('check_branch_budget || exit 1')
      expect(shellFunctionBody(source, 'main')).toContain('neon_branch_cap=$NEON_BRANCH_CAP')
    })

    it('is documented where an operator reads the knobs', () => {
      expect(fs.readFileSync(orchestrator, 'utf8')).toContain(
        'NEON_BRANCH_CAP             Neon branches the plan allows (default: 10)',
      )
      // Regex, not toContain: Prettier pads the table columns to align them, so
      // the literal separator is a run of spaces whose width depends on the
      // widest row and would change under an unrelated edit.
      expect(
        fs.readFileSync(path.join(scriptsDir, '..', 'docs', 'PARALLEL_WORKFLOW.md'), 'utf8'),
      ).toMatch(/`NEON_BRANCH_CAP` +\| +10 /)
      // The comment justifying the NEON_* naming says it "lives in the same
      // .env namespace" as NEON_API_KEY and friends — so it has to be there.
      expect(fs.readFileSync(path.join(scriptsDir, '..', '.env.example'), 'utf8')).toContain(
        'NEON_BRANCH_CAP=10',
      )
      expect(
        fs.readFileSync(path.join(scriptsDir, '..', 'docs', 'PARALLEL_WORKFLOW.md'), 'utf8'),
      ).toMatch(/`ORCHESTRATOR_CAP_REQUEUE_COOLDOWN` +\| +1800 /)
    })
  })

  describe('HON-616 a Neon branch-cap failure is capacity, not a bad issue', () => {
    type CapRun = {
      out: string
      triageInput: string
      consecutiveFailures: number
      capRequeued: string
    }

    /**
     * `handle_failure` on a worker log of the given flavour. The forced verdict
     * is always BACKLOG — the wrong answer for a cap failure, and the one the
     * pre-triage check has to reach before Claude is ever consulted.
     */
    function drive(
      flavour: string,
      retried = '0',
      shuttingDown = 'false',
      env: Record<string, string> = {},
    ): CapRun {
      const out = stripTimestamps(
        runHarnessEnv(env, 'failure', 'BACKLOG', retried, shuttingDown, '1', flavour),
      )
      const read = (key: string) => out.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1] ?? ''
      return {
        out,
        triageInput: read('TRIAGE_INPUT'),
        consecutiveFailures: Number(read('CONSECUTIVE_FAILURES')),
        capRequeued: read('CAP_REQUEUED'),
      }
    }

    it('classifies a worktree-setup cap death without asking Claude', () => {
      const r = drive('cap')

      expect(r.out).toContain('Triage for HON-991: CAP')
      // The log says in plain text why the worker died. Spending a `claude -p`
      // round trip on it is not just wasteful — the verdict has to hold when
      // Claude is unavailable or DRY_RUN is set, where the fallback is BACKLOG.
      expect(r.triageInput).toBe('')
    })

    it('retries once, keeping the branch, before giving up', () => {
      const r = drive('cap', '0')

      expect(r.out).toContain('SPAWN_WORKER:HON-991:retry=1')
      expect(r.out).toContain('CLEANUP:test-branch-1:true')
      expect(r.out).not.toContain('MOVE_TO_BACKLOG')
    })

    it('returns the issue to Queued, unlabelled, when the retry also hits the cap', () => {
      const r = drive('cap', '1')

      expect(r.out).toContain('RESTORE_QUEUED:HON-991')
      // Backlog plus a red label reads as "this issue is broken" and both are
      // sticky — a human has to clear them before the orchestrator will look at
      // it again. The issue was never examined; only the branch count was wrong.
      expect(r.out).not.toContain('MOVE_TO_BACKLOG')
      expect(r.out).not.toContain('LABEL:')
      expect(r.out).toContain('COMMENT:## Returned to Queued — Neon branch cap')
      // Full cleanup on the terminal path: nothing was committed, and releasing
      // the worktree is what lets the orphan GC reclaim anything it left behind.
      expect(r.out).toContain('CLEANUP:test-branch-1:false')
    })

    it('requeues rather than respawning during shutdown', () => {
      const r = drive('cap', '0', 'true')

      expect(r.out).toContain('RESTORE_QUEUED:HON-991')
      expect(r.out).not.toContain('SPAWN_WORKER')
    })

    it('points the reader at the stranded worktrees that cause a repeat', () => {
      // The comment is the only thing an operator sees on the issue, and a
      // second stranded run is the likeliest reason the cap is full at all.
      const r = drive('cap', '1')

      expect(r.out).toContain('wt list')
      expect(r.out).toContain('wt cleanup <branch>')
    })

    it.each(['0', '1'])('still counts toward the circuit breaker at retried=%s', (retried) => {
      // A cap failure ships nothing, so it feeds the breaker like every other
      // handle_failure path. That is what bounds the requeue loop: the issue
      // goes back to Queued and is immediately pickable, so three cap failures in
      // a row must pause spawning rather than walk the queue.
      expect(drive('cap', retried).consecutiveFailures).toBe(1)
    })

    it('ignores the non-terminal "running orphan GC" line on its own', () => {
      // That message is printed on the run where GC frees a branch and the
      // retry succeeds. Only the sentence after a FAILED retry is terminal.
      const r = drive('cap-gc-only')

      expect(r.out).toContain('Triage for HON-991: BACKLOG')
      // The verdict, not the bare substring: the run also prints a
      // CAP_REQUEUED: line, which is empty here and is not a classification.
      expect(r.out).not.toContain('triage=CAP')
      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
    })

    it('does not read a Claude session quoting the marker as a cap failure', () => {
      // The self-reference guard, and the reason the grep is scoped to the log
      // before "Starting autonomous Claude Code": this repo's own scripts, docs
      // and Linear issues carry that sentence verbatim, so a worker doing
      // ordinary work on the orchestrator prints it constantly. Unscoped, any
      // genuine failure of such a run would be requeued forever as "capacity".
      const r = drive('cap-after-claude')

      expect(r.out).toContain('Triage for HON-991: BACKLOG')
      expect(r.out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
      expect(r.out).not.toContain('RESTORE_QUEUED')
    })

    it('survives a log with megabytes of output after the marker', () => {
      // `grep -q` exits the instant it matches, so under `set -o pipefail` a
      // `sed … | grep -qF …` pipeline returns 141 — "no match" — once the tail
      // exceeds a 64 KB pipe buffer, because sed dies on SIGPIPE. That failure
      // is silent and lands on the worst branch: the run falls through to the
      // Claude triage and a cap death becomes Backlog + `Needs attention`,
      // i.e. HON-609 all over again. The tail here models `$create_out`, which
      // is `pnpm dlx … 2>&1` and therefore unbounded.
      const r = drive('cap-large')

      expect(r.out).toContain('Triage for HON-991: CAP')
      expect(r.out).not.toContain('MOVE_TO_BACKLOG')
    })

    it('bounds the requeue by suppressing re-selection for the run', () => {
      // Queued + unassigned + unlabelled is immediately re-selectable, and the
      // circuit breaker only rate-limits — it resets itself once the pause
      // expires. Without this list a genuinely full Neon project collects an
      // identical comment and a full worktree build per breaker window, all
      // night.
      // "HON-991:<expiry-epoch>" — the entry expires rather than lasting the
      // run, see the cooldown tests below.
      expect(drive('cap', '1').capRequeued).toMatch(/^HON-991:\d{10,}$/)
    })

    it('does not suppress an issue it merely retried', () => {
      // The retry keeps the same worker going; suppression is only for the
      // terminal requeue, or the respawn would be skipped by the next poll.
      expect(drive('cap', '0').capRequeued).toBe('')
    })

    it('says nothing and moves nothing when the issue was already moved on', () => {
      // restore_queue_if_in_progress is deliberately a no-op when a human (or
      // Linear's PR automation) advanced the issue while the worker was dying.
      // Commenting first would leave "back in Queued, unassigned and unlabelled"
      // on an issue that is assigned and elsewhere — false on the one artifact
      // an operator reads, and select_next_issue skips assigned issues forever.
      const r = drive('cap', '1', 'false', {
        HARNESS_ISSUE_STATE: '8e510dfa-7667-425f-abf2-c9202c4aee5b', // In Review
      })

      expect(r.out).toContain('HON-991 is no longer In Progress')
      expect(r.out).not.toContain('COMMENT:## Returned to Queued')
      expect(r.out).not.toContain('RESTORE_QUEUED')
      // Nothing was requeued, so nothing may be suppressed either.
      expect(r.capRequeued).toBe('')
    })

    it('requeues anyway when the issue state cannot be read', () => {
      // issue_state_id returns empty on ANY failed read. Treating that as "a
      // human moved it" would skip the comment, the Queued restore and the
      // cooldown entry over a transient API error — leaving the issue In
      // Progress and assigned, which fetch_queued_issues (Queued only) can never
      // surface again, under a WARN asserting the opposite.
      const r = drive('cap', '1', 'false', { HARNESS_ISSUE_STATE: '' })

      expect(r.out).toContain('Could not read the state of HON-991 — requeueing anyway')
      expect(r.out).toContain('COMMENT:## Returned to Queued — Neon branch cap')
      expect(r.out).toContain('RESTORE_QUEUED:HON-991')
      expect(r.capRequeued).toMatch(/^HON-991:\d{10,}$/)
      // Specifically NOT the "a human moved it" branch.
      expect(r.out).not.toContain('is no longer In Progress')
    })

    it('matches the marker worktree-claude.sh actually prints', () => {
      // Two files, one string, no shared constant — so the only thing keeping
      // the detector honest is this assertion. Reword the message in
      // worktree-claude.sh without this and the cap simply stops being detected:
      // every cap failure silently goes back to being triaged as a bad issue,
      // with nothing failing to say so.
      const orchestratorSource = fs.readFileSync(orchestrator, 'utf8')
      const marker = orchestratorSource.match(/^NEON_CAP_MARKER='(.+)'$/m)?.[1]

      expect(marker).toBeTruthy()
      expect(fs.readFileSync(worktreeClaude, 'utf8')).toContain(marker!)
    })

    it('agrees with worktree-claude.sh on the permanent-branch count', () => {
      // The same duplication, for the other half of the budget. The two scripts
      // share no library — worktree-claude.sh already keeps its own copies of
      // count_commits and detect_phase — so a divergence here would have the
      // startup gate enforcing one budget while the cap message explains
      // another, and only one of them could be right.
      const read = (file: string) =>
        fs.readFileSync(file, 'utf8').match(/^NEON_PERMANENT_BRANCHES=(\d+)$/m)?.[1]

      expect(read(orchestrator)).toBe('3')
      expect(read(worktreeClaude)).toBe(read(orchestrator))
    })
  })

  describe('HON-616 cap suppression is released, not permanent', () => {
    const ISSUES = JSON.stringify({
      data: {
        issues: {
          nodes: [991, 992].map((n) => ({
            id: `u${n}`,
            identifier: `HON-${n}`,
            title: `Fixture ${n}`,
            branchName: `henri/hon-${n}-fixture`,
            priority: 3,
            assignee: null,
            labels: { nodes: [] },
            relations: { nodes: [] },
            inverseRelations: { nodes: [] },
          })),
        },
      },
    })

    /** The REAL select_next_issue over a fixture — no stubs, it takes the response. */
    function select(capRequeued = '', gated = '') {
      return stripTimestamps(runHarness('select-next', ISSUES, capRequeued, gated))
    }

    it('skips an issue whose cap cooldown is still live', () => {
      const out = select('HON-991:9999999999')

      expect(out).toContain('PICK:u992\tHON-992')
      expect(out).toContain('[SKIP] HON-991 requeued at the Neon branch cap')
    })

    it('keeps suppressing an entry whose expiry is malformed', () => {
      // `[ 123 -ge HON-991 ]` is a shell error, and the picker must not fall
      // over — or fall open — on one. Failing safe costs a cooldown window.
      const out = select('HON-991')

      expect(out).toContain('PICK:u992\tHON-992')
      expect(out).toContain('[SKIP] HON-991 requeued at the Neon branch cap')
    })

    it('picks it when nothing was requeued', () => {
      // The control: without the suppression the same fixture yields HON-991,
      // so the test above is measuring the list and not the sort order.
      const out = select()

      expect(out).toContain('PICK:u991\tHON-991')
      expect(out).not.toContain('[SKIP] HON-991')
    })

    it('tells the operator how to release it', () => {
      // The skip line is the only place this state is visible — there is no
      // label to see in Linear, deliberately, since nothing is wrong with the
      // issue.
      expect(select('HON-991:9999999999')).toContain('wt cleanup <branch>')
    })

    it('releases the suppression once the cooldown lapses', () => {
      // The wedge this replaced: a run-scoped list can only be released by a
      // success, which needs a spawn, which needs a candidate the list has just
      // suppressed. Once the Queued page was walked the orchestrator idled until
      // restarted, and `wt cleanup` recovered nothing.
      const out = select('HON-991:1') // epoch 1 — January 1970

      expect(out).toContain('PICK:u991\tHON-991')
      expect(out).not.toContain('[SKIP] HON-991')
    })

    it('reads each entry independently', () => {
      // One expired, one live — a shared cooldown would release or hold both.
      const out = select('HON-991:1,HON-992:9999999999')

      expect(out).toContain('PICK:u991\tHON-991')
      expect(out).toContain('[SKIP] HON-992 requeued at the Neon branch cap')
    })

    it('is cleared by a run that ships', () => {
      // A merged run is proof the project has branches again, and the only
      // signal the orchestrator has for "the cap has freed". Without this the
      // suppression would last until restart, and an operator who frees
      // branches by hand would see the issue stay unpicked.
      const out = stripTimestamps(
        runHarnessEnv(
          { HARNESS_CAP_REQUEUED: 'HON-991:9999999999,HON-992:9999999999' },
          'outcome',
          '4',
          'done',
          'MERGED',
          'green',
        ),
      )

      // Issue ids, not the raw "id:epoch" entries — the epochs are bookkeeping.
      expect(out).toContain('[UNCAP] HON-991,HON-992')
      expect(out).toContain('SUCCESS')
    })

    it('says nothing about the cap on a success that had none to clear', () => {
      expect(stripTimestamps(runHarness('outcome', '4', 'done', 'MERGED', 'green'))).not.toContain(
        '[UNCAP]',
      )
    })
  })

  describe('HON-616 the cap error explains itself', () => {
    const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
    const CAP_ERROR = 'ERROR: branch limit exceeded for project'

    /** The real cap path, with every neonctl call fixture-driven. */
    function capMessage(env: Record<string, string> = {}): string {
      return execFileSync(
        'bash',
        [harness, 'neon-create', CAP_ERROR, 'henri/hon-616-neutral-slug', '0', 'retry-fail', '0'],
        { encoding: 'utf8', timeout: 30_000, env: harnessEnv(env) },
      ).replace(ANSI, '')
    }

    it('names the budget, the ceiling in force and the observed branch count', () => {
      // "branches limit exceeded" alone sent the next reader off to rediscover
      // the preview/* branch from scratch (HON-609). The stubbed `branches list`
      // returns an empty array, hence a count of 0.
      const out = capMessage({ ORCHESTRATOR_MAX_WORKERS: '8' })

      expect(out).toContain('Budget: N + 3 with N=8 workers = 11 of 10 branches at peak.')
      expect(out).toContain('Branches: 0 before GC, 0 after.')
      expect(out).toContain('NEON_BRANCH_CAP, currently 10')
    })

    it('names preview/* and the stranded-run hold as the things to look at', () => {
      const out = capMessage()

      expect(out).toContain('preview/<git-branch>')
      expect(out).toContain('wt cleanup <branch>')
    })

    it('quotes the cap the orchestrator gated on, not the one .env shadows it with', () => {
      // load_env_file re-exports unconditionally at the real entry point, so a
      // NEON_BRANCH_CAP line in .env would otherwise shadow the value in force.
      // Unfixed this printed "19 of 10 branches at peak … currently 10" for a
      // run the startup gate cleared at 25.
      const out = capMessage({
        ORCHESTRATOR_MAX_WORKERS: '16',
        NEON_BRANCH_CAP: '25',
        HARNESS_ENV_FILE_CAP: '10',
      })

      expect(out).toContain('Budget: N + 3 with N=16 workers = 19 of 25 branches at peak.')
      expect(out).toContain('NEON_BRANCH_CAP, currently 25')
      expect(out).not.toContain('19 of 10')
    })

    it('falls back to .env when no orchestrator passed a cap down', () => {
      // A hand-run `wt auto` has nothing inherited, so .env IS the value in
      // force — the fallback must not report the built-in default instead.
      const out = capMessage({ HARNESS_ENV_FILE_CAP: '17' })

      expect(out).toContain('cap 17.')
      expect(out).toContain('NEON_BRANCH_CAP, currently 17')
    })

    it('does not invent a worker count when wt auto was run by hand', () => {
      // No orchestrator, no ceiling to report. A default printed as fact here
      // would be a plausible wrong number in the one message meant to explain.
      const out = capMessage()

      expect(out).toContain('Budget: N + 3 branches for N concurrent workers, cap 10.')
      expect(out).not.toMatch(/with N=\d+ workers/)
    })

    it.each([
      ['[{"name":"a"},{"name":"b"}]', '2'],
      ['{"branches":[{"name":"a"}]}', '1'],
      ['[]', '0'],
      // A zero exit with empty stdout is a real neonctl outcome, and jq on
      // empty input prints nothing — which renders as "cap hit at  branches".
      ['', '?'],
      ['not json', '?'],
    ])('counts %j as %s', (fixture, expected) => {
      expect(runHarness('neon-branch-count', fixture).trim()).toBe(expected)
    })

    it('reports the branch count before and after the GC as separate numbers', () => {
      // Which of the two moved is what says whether the GC had anything to
      // reclaim — i.e. whether this is a stale-branch problem or a real ceiling
      // problem. One number cannot express that.
      expect(capMessage()).toMatch(/Branches: \S+ before GC, \S+ after\./)
    })
  })

  describe('HON-616 preview/* ownership is documented in the runbook', () => {
    const runbook = () =>
      fs.readFileSync(path.join(scriptsDir, '..', 'docs', 'RUNBOOKS', 'neon-branch-gc.md'), 'utf8')

    it('names the Vercel-Neon integration as the owner', () => {
      const text = runbook()

      expect(text).toContain('preview/')
      expect(text).toMatch(/Vercel[–-]Neon integration/)
    })

    it('names the name filters that keep the HON-shape reapers off it', () => {
      const text = runbook()

      // Both exclusions, by the name of the thing that enforces them — so a
      // future widening of either has an obvious place to be reflected.
      expect(text).toContain('neon_gc_orphan_names')
      expect(text).toContain('SAFE_BRANCH_REGEX')
    })

    it('names what stops PR branches getting one, and what must not be deleted', () => {
      const text = runbook()

      expect(text).toContain('git.deploymentEnabled')
      expect(text).toContain('A preview branch whose deployment is still live must not be deleted')
    })
  })
})
