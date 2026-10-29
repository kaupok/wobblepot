import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  e2eLocal,
  harness,
  harnessEnv,
  launchLine,
  models,
  orchestrator,
  prReview,
  runHarness,
  runHarnessEnv,
  scriptsDir,
  shellFunctionBody,
  stripTimestamps,
  worktreeClaude,
} from './orchestrator-test-harness'

// The worker's MCP flags: .mcp.json's linear-server and playwright entries only (HON-1238).
const mcpServers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../.mcp.json'), 'utf8'),
).mcpServers
const WORKER_MCP_ARGS = `--strict-mcp-config --mcp-config ${JSON.stringify({
  mcpServers: { playwright: mcpServers.playwright, 'linear-server': mcpServers['linear-server'] },
})}`

describe('orchestrator.sh', () => {
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
  // fault that reads as transient swept the whole queue into Backlog
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

    it('reads the verdict word from a multi-megabyte triage reply', () => {
      // HON-1005: `printf | awk 'NF{print $1; exit}'` SIGPIPE'd the printf once
      // awk had the first word, and the 141 from that `$(…)` assignment under
      // set -e killed the orchestrator. 60,000 lines after the verdict keep the
      // writer busy far past a 64 KB pipe buffer, so the race is lost every run.
      const r = parse(
        runHarnessEnv({ HARNESS_VERDICT_PAD_LINES: '60000' }, 'failure', 'RETRY', '0', 'false'),
      )

      expect(r.out).toContain('Triage for HON-991: RETRY')
      expect(r.out).toContain('SPAWN_WORKER:HON-991:retry=1')
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

  // ─── HON-728: the RETRY worker is told why the last attempt failed ────────
  // handle_failure used to respawn a RETRY with the same `wt auto` call as the
  // first attempt, discarding the phase, failure type and log tail it had just
  // triaged. The retry now carries a note, forwarded through the REAL
  // spawn_worker as ORCHESTRATOR_RETRY_CONTEXT to a recording `wt auto` stub.
  describe('retry context forwarded to the RETRY worker', () => {
    type Call = { args: string; context: string }
    type Run = { count: number; first: Call; retry: Call; out: string }

    function spawnRun(triage: string, flavour = 'plain'): Run {
      const out = stripTimestamps(runHarness('failure-spawn', triage, flavour))
      const call = (n: number): Call => ({
        args: out.match(new RegExp(`^WT_CALL:${n}:(.*)$`, 'm'))?.[1] ?? '',
        context: (out.match(new RegExp(`^WT_CONTEXT:${n}:(.*)$`, 'm'))?.[1] ?? '').trim(),
      })
      return { count: out.match(/^WT_CALL:/gm)?.length ?? 0, first: call(1), retry: call(2), out }
    }

    const tailOf = (context: string) => context.match(/```(.*)```/)?.[1]?.trim() ?? ''

    it('passes the failure phase, type and a non-empty log tail to the second wt auto call', () => {
      const { count, retry } = spawnRun('RETRY')

      expect(count).toBe(2)
      expect(retry.args).toBe('auto HON-991')
      expect(retry.context).toContain('failed in phase implementing (failed)')
      expect(retry.context).toContain('0 commit(s)')
      expect(tailOf(retry.context)).toContain('pnpm test failed in src/lib/example.test.ts')
    })

    it('gives the first attempt no retry context', () => {
      const { first } = spawnRun('RETRY')

      expect(first.args).toBe('auto HON-991')
      expect(first.context).toBe('')
    })

    it('redacts secrets in the forwarded log tail', () => {
      const { retry } = spawnRun('RETRY')
      const tail = tailOf(retry.context)

      expect(tail).toContain('[REDACTED]')
      // Planted in the fixture .env AND the log, with regex metacharacters.
      expect(tail).not.toContain('hrn-fake')
      // The sed backstop shapes.
      expect(tail).not.toContain('supersecretpw')
      expect(tail).not.toContain('lin_api_SECRET')
    })

    // The note can reach the retry's own log, which detect_phase, the
    // completion grep and worker_hit_neon_cap all scan. Attempt 1's markers
    // must not read as attempt 2's progress.
    it('defangs the progress markers the orchestrator greps worker logs for', () => {
      const { retry } = spawnRun('RETRY')
      const context = retry.context

      expect(context).not.toMatch(/\[[A-Za-z-]+:complete\]/)
      expect(context).not.toContain('[auto-implement]')
      expect(context).not.toContain('Starting autonomous Claude Code')
      expect(context).toContain('(plan-issue:complete)')
    })

    it('forwards the same note on the Neon-cap one-retry', () => {
      const { count, retry } = spawnRun('RETRY', 'cap')

      expect(count).toBe(2)
      expect(retry.context).toContain('Neon branch cap')
      expect(tailOf(retry.context)).toContain('cap still exceeded after orphan GC')
    })

    // HON-1193: an issue labelled `Small` runs on AUTO_MODEL_SMALL and
    // AUTO_EFFORT_SMALL. The retry follows a failure, so it goes back to the
    // default tier, whose call carries no model flags at all.
    it('spawns a Small issue on the small model and effort, logs both, and retries on the default tier', () => {
      const out = stripTimestamps(runHarnessEnv({ HARNESS_SMALL: '1' }, 'failure-spawn', 'RETRY'))

      expect(out).toContain('WT_CALL:1:auto --model claude-sonnet-5-5 --effort low HON-991\n')
      expect(out).toContain('Tier: Small | Model: claude-sonnet-5-5 | Effort: low')
      expect(out.match(/Tier: Small/g)).toHaveLength(1)
      expect(out).toContain('WT_CALL:2:auto HON-991\n')
    })

    it('passes the Small tier overrides through to wt auto', () => {
      const out = stripTimestamps(
        runHarnessEnv(
          { HARNESS_SMALL: '1', CLAUDE_AUTO_MODEL_SMALL: 'small-x', CLAUDE_AUTO_EFFORT_SMALL: '' },
          'failure-spawn',
          'RETRY',
        ),
      )

      // An empty effort is passed as an empty value, which wt auto reads as no flag.
      expect(out).toContain('WT_CALL:1:auto --model small-x --effort  HON-991\n')
      expect(out).toContain('Tier: Small | Model: small-x | Effort: default')
    })

    it('spawns nothing when triage does not retry', () => {
      const { count, out } = spawnRun('BACKLOG')

      expect(count).toBe(1)
      expect(out).toContain('MOVE_TO_BACKLOG:HON-991:Failed')
    })

    describe('worktree-claude.sh auto_prompt', () => {
      // cmd_auto hands the prompt to run_auto_claude, whose wt_auto_claude
      // starts claude, once and on every resume after a network drop (HON-1413).
      const launch = () =>
        launchLine(
          shellFunctionBody(
            fs.readFileSync(
              path.join(path.dirname(worktreeClaude), 'worktree-auto-run.sh'),
              'utf8',
            ),
            'wt_auto_claude',
          ),
        )
      const prompt = (context: string) =>
        execFileSync('bash', [harness, 'auto-prompt', '/auto-implement HON-991'], {
          encoding: 'utf8',
          timeout: 30_000,
          env: harnessEnv({ ORCHESTRATOR_RETRY_CONTEXT: context }),
        })

      it('leaves a first attempt prompt untouched', () => {
        expect(prompt('')).toBe('/auto-implement HON-991')
      })

      it('appends the retry note after the skill invocation', () => {
        expect(prompt('Retry context: failed in phase reviewing')).toBe(
          '/auto-implement HON-991\n\nRetry context: failed in phase reviewing',
        )
      })

      it('never echoes the note into the worker log, and unsets it for claude', () => {
        const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_auto')
        const echoes = body.split('\n').filter((l) => /^\s*echo /.test(l))

        for (const line of echoes) {
          expect(line).not.toContain('ORCHESTRATOR_RETRY_CONTEXT')
          expect(line).not.toContain('auto_prompt')
        }
        expect(launch()).toMatch(/env [^\n]*-u ORCHESTRATOR_RETRY_CONTEXT [^\n]*claude/)
        expect(body).toContain('run_auto_claude "$(auto_prompt "$prompt")" "$issue_id"')
      })

      // HON-1238: every MCP server that starts adds its tools to the base
      // prefix of every request. The worker needs Linear and Playwright only.
      it('launches the worker with a strict MCP config and -- before the prompt', () => {
        const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_auto')
        expect(body).toContain('claude_mcp_args linear-server playwright')
        expect(launch()).toContain('"${CLAUDE_MCP_ARGS[@]}" -- "$prompt"')
      })

      // HON-1119: Claude Code moves an MCP call past 2 minutes to the
      // background, and this headless worker exits when its turn ends, so the
      // result would never arrive. 0 keeps every MCP call in the foreground.
      it('launches the worker with MCP auto-backgrounding switched off', () => {
        expect(launch()).toMatch(/env [^\n]* CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0 claude /)
      })
    })
  })

  // ─── HON-1118: stderr diagnostics reach the verdict ───────────────────────
  // The triage call ran with `2>&1`, and the verdict is the first word of the
  // first non-empty line. Claude Code prints diagnostics to stderr in print
  // mode, so one printed ahead of the answer became the verdict and sent a
  // retryable failure down the "unexpected result" branch.
  describe('handle_failure triage stderr', () => {
    const driveTriage = (env: Record<string, string>) =>
      stripTimestamps(runHarnessEnv(env, 'failure', 'RETRY', '0', 'false', '1'))

    it('reads the verdict from stdout when a warning comes first on stderr', () => {
      const out = driveTriage({
        HARNESS_CLAUDE_STDERR: '[claude-code:unrecognized_model] Model claude-next-x is not known',
      })

      expect(out).not.toContain('Unexpected triage result')
      expect(out).toContain('Triage for HON-991: RETRY')
      expect(out).toContain('SPAWN_WORKER:HON-991:retry=1')
    })

    it('logs the stderr error and needs a human when the CLI exits non-zero', () => {
      const out = driveTriage({
        HARNESS_CLAUDE_STDERR: 'Error: OAuth token has expired, run /login',
        HARNESS_CLAUDE_EXIT: '1',
      })

      expect(out).toContain('Claude triage failed (exit 1): Error: OAuth token has expired')
      expect(out).toContain('Triage for HON-991: NEEDS_HUMAN')
      expect(out).not.toContain('SPAWN_WORKER')
    })

    it('runs the triage call with an empty strict MCP config, options ended before the prompt', () => {
      const input = stripTimestamps(runHarness('failure', 'BACKLOG', '0', 'false')).match(
        /^TRIAGE_INPUT:(.*)$/m,
      )?.[1]

      // --mcp-config takes several values, so the real CLI reads a prompt that
      // follows it directly as a second config file and exits 1. The `--` is
      // what keeps the prompt a prompt.
      expect(input).toContain(
        '--strict-mcp-config --mcp-config {"mcpServers":{}} -- Worker for HON-991 failed',
      )
    })
  })

  // ─── HON-730: one file names the workflow's models ────────────────────────
  // The worker, reviewer and triage models were picked in three scripts, the
  // triage one a literal with no override. scripts/models.sh now owns all three,
  // and each CLAUDE_*_MODEL env var overrides its default.
  describe('workflow model IDs', () => {
    /** What models.sh resolves under `env`, as `AUTO REVIEW TRIAGE`. */
    const resolveModels = (env: Record<string, string> = {}) =>
      execFileSync(
        'bash',
        ['-c', 'source "$1"; echo "$AUTO_MODEL $REVIEW_MODEL $TRIAGE_MODEL"', '_', models],
        { encoding: 'utf8', timeout: 30_000, env: harnessEnv(env) },
      )
        .trim()
        .split(' ')
    const triageArgs = (env: Record<string, string>) =>
      stripTimestamps(runHarnessEnv(env, 'failure', 'BACKLOG', '0', 'false')).match(
        /^TRIAGE_INPUT:.*?(-p --model \S+)/m,
      )?.[1]

    it('lets each CLAUDE_*_MODEL override its default, and an empty one fall back', () => {
      const defaults = resolveModels()
      expect(defaults).toHaveLength(3)
      for (const model of defaults) expect(model).toMatch(/^claude-/)

      expect(
        resolveModels({
          CLAUDE_AUTO_MODEL: 'auto-x',
          CLAUDE_REVIEW_MODEL: 'review-x',
          CLAUDE_TRIAGE_MODEL: 'triage-x',
        }),
      ).toEqual(['auto-x', 'review-x', 'triage-x'])
    })

    it('runs failure triage on CLAUDE_TRIAGE_MODEL', () => {
      expect(triageArgs({ CLAUDE_TRIAGE_MODEL: 'triage-swap-test' })).toBe(
        '-p --model triage-swap-test',
      )
    })

    it('runs failure triage on the models.sh default when nothing overrides it', () => {
      expect(triageArgs({})).toBe(`-p --model ${resolveModels()[2]}`)
    })

    it('names a model ID in no workflow script but models.sh', () => {
      const offenders = fs
        .readdirSync(scriptsDir)
        .filter((f) => f.endsWith('.sh') && f !== 'models.sh')
        .filter((f) =>
          /claude-(opus|sonnet|haiku|fable)/.test(
            fs.readFileSync(path.join(scriptsDir, f), 'utf8'),
          ),
        )

      expect(offenders).toEqual([])
    })

    it('hands the worker and the reviewer their models.sh variables', () => {
      const wt = fs.readFileSync(worktreeClaude, 'utf8')
      const sourceLine = 'source "$SCRIPT_DIR/models.sh"'

      expect(wt).toContain('claude_model_args "$AUTO_MODEL" "$AUTO_EFFORT"')
      // After load_env_file, or a CLAUDE_AUTO_MODEL line in .env never reaches it.
      expect(wt.indexOf(sourceLine)).toBeGreaterThan(wt.indexOf('load_env_file "$REPO_ROOT/.env"'))
      expect(wt.indexOf('load_env_file "$REPO_ROOT/.env"')).toBeGreaterThan(-1)

      const review = fs.readFileSync(prReview, 'utf8')
      expect(review).toContain(sourceLine)
      expect(review).toContain('MODEL="$REVIEW_MODEL"')
      expect(review).toContain('claude_model_args "$MODEL" "$REVIEW_EFFORT"')
      expect(review).toContain('"${CLAUDE_MODEL_ARGS[@]}"')
    })
  })

  // ─── HON-1193: an effort per role, and the Small tier ─────────────────────
  // No script passed --effort, so every call ran at the CLI default. models.sh
  // now holds an effort per role; an empty one passes no flag, which is what
  // keeps the default worker's spawn line as it was.
  describe('workflow effort levels', () => {
    /** What models.sh resolves under `env`, one `NAME=value` per line. */
    const resolveEfforts = (env: Record<string, string> = {}) =>
      execFileSync(
        'bash',
        [
          '-c',
          'source "$1"; for v in AUTO_EFFORT REVIEW_EFFORT TRIAGE_EFFORT AUTO_EFFORT_SMALL AUTO_MODEL_SMALL; do echo "$v=${!v}"; done',
          '_',
          models,
        ],
        { encoding: 'utf8', timeout: 30_000, env: harnessEnv(env) },
      )
    /** The REAL cmd_auto against a `claude` stub: what the worker CLI receives. */
    const wtAuto = (args: string[], env: Record<string, string> = {}) =>
      runHarnessEnv(env, 'wt-auto', String(args.length), ...args).replace(
        // The worker's own session ID, so a resume after a network drop takes
        // this session (HON-1413).
        /--session-id [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} /g,
        '--session-id <sid> ',
      )
    const triageInput = (env: Record<string, string>) =>
      stripTimestamps(runHarnessEnv(env, 'failure', 'BACKLOG', '0', 'false')).match(
        /^TRIAGE_INPUT:.*$/m,
      )?.[0] ?? ''

    it('defaults to no worker effort, medium review, low triage and a low-effort Sonnet 5.5 Small tier', () => {
      expect(resolveEfforts()).toBe(
        [
          'AUTO_EFFORT=',
          'REVIEW_EFFORT=medium',
          'TRIAGE_EFFORT=low',
          'AUTO_EFFORT_SMALL=low',
          'AUTO_MODEL_SMALL=claude-sonnet-5-5',
          '',
        ].join('\n'),
      )
    })

    it('lets each CLAUDE_* override win, and an empty effort override stay empty', () => {
      const out = resolveEfforts({
        CLAUDE_AUTO_EFFORT: 'high',
        CLAUDE_REVIEW_EFFORT: '',
        CLAUDE_TRIAGE_EFFORT: 'max',
        CLAUDE_AUTO_EFFORT_SMALL: '',
        CLAUDE_AUTO_MODEL_SMALL: 'small-x',
      })

      expect(out).toContain('AUTO_EFFORT=high\n')
      expect(out).toContain('REVIEW_EFFORT=\n')
      expect(out).toContain('TRIAGE_EFFORT=max\n')
      expect(out).toContain('AUTO_EFFORT_SMALL=\n')
      expect(out).toContain('AUTO_MODEL_SMALL=small-x\n')
    })

    it('spawns the default worker with the same arguments as before when AUTO_EFFORT is empty', () => {
      const out = wtAuto(['HON-991'])

      expect(out).toContain(
        'CLAUDE_ARGS:--session-id <sid> --dangerously-skip-permissions --model claude-opus-5-5 ' +
          WORKER_MCP_ARGS +
          ' -- /auto-implement HON-991\n',
      )
      expect(out).toContain('Model: claude-opus-5-5 | Effort: default')
      expect(out).toContain('EXIT:0')
    })

    it('passes --effort to the worker when CLAUDE_AUTO_EFFORT is set', () => {
      expect(wtAuto(['HON-991'], { CLAUDE_AUTO_EFFORT: 'xhigh' })).toContain(
        'CLAUDE_ARGS:--session-id <sid> --dangerously-skip-permissions --model claude-opus-5-5 --effort xhigh ' +
          WORKER_MCP_ARGS +
          ' -- /auto-implement HON-991\n',
      )
    })

    it('takes --model and --effort on wt auto, ahead of models.sh', () => {
      const out = wtAuto(['--model', 'small-x', '--effort', 'low', 'HON-991'], {
        CLAUDE_AUTO_MODEL: 'auto-x',
        CLAUDE_AUTO_EFFORT: 'max',
      })

      expect(out).toContain(
        'CLAUDE_ARGS:--session-id <sid> --dangerously-skip-permissions --model small-x --effort low ' +
          WORKER_MCP_ARGS +
          ' -- /auto-implement HON-991\n',
      )
    })

    it("reads wt auto --effort '' as no --effort flag", () => {
      expect(wtAuto(['--effort', '', 'HON-991'], { CLAUDE_AUTO_EFFORT: 'max' })).toContain(
        'CLAUDE_ARGS:--session-id <sid> --dangerously-skip-permissions --model claude-opus-5-5 ' +
          WORKER_MCP_ARGS +
          ' -- /auto-implement HON-991\n',
      )
    })

    it('refuses a wt auto --model with no value before it creates anything', () => {
      for (const args of [
        ['HON-991', '--model'],
        ['--model', '', 'HON-991'],
        ['HON-991', '--effort'],
      ]) {
        const out = wtAuto(args)
        expect(out).toContain('needs a value')
        expect(out).toContain('EXIT:1')
        expect(out).not.toContain('CLAUDE_ARGS:')
      }
    })

    it('runs failure triage at TRIAGE_EFFORT, and with no --effort when it is empty', () => {
      expect(triageInput({})).toContain(
        '-p --model claude-sonnet-5 --effort low --strict-mcp-config',
      )
      expect(triageInput({ CLAUDE_TRIAGE_EFFORT: '' })).toContain(
        '-p --model claude-sonnet-5 --strict-mcp-config',
      )
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
})
