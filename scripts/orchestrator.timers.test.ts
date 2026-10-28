import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  orchestrator,
  worktreeClaude,
  harness,
  harnessEnv,
  stripTimestamps,
  shellFunctionBody,
  runHarness,
  runHarnessEnv,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  // ─── HON-572 finding 5: wt stop drain window ──────────────────────────────
  // cmd_stop sent a second SIGTERM, slept 3s, then SIGKILLed. The force path
  // runs drain_workers_to_queue, which needs ~15s per worker; killing it partway
  // orphans `claude` processes and leaves their issues In Progress + assigned,
  // the state select_next_issue skips forever.
  describe('stop_wait_bound', () => {
    const bound = (workers: string, triage = '', statusTriage = '', deferred = '') =>
      Number(
        runHarnessEnv(
          { ORCHESTRATOR_TRIAGE_TIMEOUT: triage },
          'stop-wait-bound',
          workers,
          statusTriage,
          deferred,
        ).trim(),
      )

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

    // The drain runs in the main loop now, so a signal that lands during a
    // triage call waits for that call. Both signals can land in one call and
    // count as one, and the next failed worker's call can start before a
    // re-sent signal arrives, so the bound allows for two (HON-1067).
    it.each([0, 1, 3, 5])(
      'covers two default 120s triage calls plus 15s per worker for %i worker(s)',
      (n) => {
        expect(bound(String(n))).toBeGreaterThanOrEqual(2 * 120 + 15 * n)
      },
    )

    it.each([
      ['300', 300],
      ['1.5', 2],
    ])('follows ORCHESTRATOR_TRIAGE_TIMEOUT=%s', (triage, seconds) => {
      expect(bound('3', triage)).toBeGreaterThanOrEqual(2 * seconds + 15 * 3)
    })

    it('falls back to the 120s default for an unreadable triage timeout', () => {
      expect(bound('3', 'abc')).toBe(bound('3'))
    })

    it("prefers the orchestrator's triage timeout from its status file", () => {
      // ORCHESTRATOR_TRIAGE_TIMEOUT exported only into `wt start` is not in the
      // shell that runs `wt stop`.
      expect(bound('3', '', '300')).toBeGreaterThanOrEqual(2 * 300 + 15 * 3)
      expect(bound('3', '120', '300')).toBeGreaterThanOrEqual(2 * 300 + 15 * 3)
    })

    it('re-sends SIGTERM while it waits, so two signals merged into one still force the drain', () => {
      // Bash runs a trap once for any number of SIGTERMs that arrive during
      // one foreground command. Both of cmd_stop's signals can land inside one
      // triage call, and then only SHUTTING_DOWN is set (HON-1067).
      const out = runHarness('wait-for-drain', '10', '3')

      expect(out).toContain('ALIVE:no')
      expect(out).toMatch(/^TERMS:3$/m)
      expect(Number(out.match(/^ELAPSED:(\d+)$/m)?.[1])).toBeLessThan(10)
    })

    it('cmd_stop waits through wait_for_drain', () => {
      const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_stop')

      expect(body).toContain('wait_for_drain "$pid" "$bound"')
    })

    it('cmd_stop passes the status file triage_timeout and deferred count to stop_wait_bound', () => {
      const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'cmd_stop')

      expect(body).toContain('.triage_timeout // empty')
      expect(body).toContain("'(.deferred // []) | length'")
      expect(body).toContain('stop_wait_bound "$worker_count" "$triage_timeout" "$deferred_count"')
    })

    // The orchestrator records each deferred outcome before it exits, during
    // the outage that deferred it: five 30s Linear calls and a triage call each
    // (HON-1447). A SIGKILL partway leaves the issue In Progress and assigned.
    it.each([1, 2, 3])('adds 150s plus one triage call per deferred outcome for %i', (n) => {
      expect(bound('0', '', '', String(n))).toBe(2 * 120 + 60 + n * (150 + 120))
      expect(bound('0', '', '300', String(n))).toBe(2 * 300 + 60 + n * (150 + 300))
    })

    it.each(['', 'null', 'abc'])(
      'adds nothing for an unreadable deferred count (%s)',
      (deferred) => {
        expect(bound('2', '', '', deferred)).toBe(bound('2'))
      },
    )

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
  // ─── HON-1067: the second signal reaches the force drain ──────────────────
  // shutdown() ran the graceful wait loop inside the trap handler. Bash does not
  // re-enter a handler that is still running, so the second SIGTERM `wt stop`
  // sends was dropped, drain_workers_to_queue never ran, and SIGKILL left
  // orphaned workers and issues In Progress and assigned. The harness runs the
  // REAL main loop and trap with stub workers and real signals; against the old
  // handler, `force` and `triage` never exit.
  describe('shutdown signals', () => {
    function runShutdown(scenario: 'graceful' | 'force' | 'triage') {
      const run = spawnSync('bash', [harness, 'shutdown', scenario], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })
      const out = stripTimestamps(run.stdout)
      const pids = Object.fromEntries(
        [...out.matchAll(/^WORKER_PID:(HON-\d+):(\d+)$/gm)].map((m) => [m[1], Number(m[2])]),
      )
      return { status: run.status, out, pids }
    }

    const isAlive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    it('one signal: spawns nothing and exits 0 once the worker exits', { timeout: 30_000 }, () => {
      const { status, out } = runShutdown('graceful')

      expect(status).toBe(0)
      expect(out).toContain(
        'Shutting down — waiting for 1 worker(s); send the signal again to force',
      )
      // The signal landed during the Linear fetch; the handler returns now, so
      // the pick that follows must not claim or spawn.
      expect(out).toContain('Shutdown requested — not claiming HON-9')
      expect(out).not.toMatch(/^(CLAIM|SPAWN):/m)
      expect(out).toContain('HANDLED:HON-1:success')
      expect(out).toContain('All workers finished, exiting')
      expect(out).not.toContain('Force shutdown')
      expect(out).not.toMatch(/^RESTORE_QUEUED:/m)
    })

    it('two signals: drains a worker that ignores SIGTERM and exits 1', { timeout: 30_000 }, () => {
      const { status, out, pids } = runShutdown('force')

      expect(status).toBe(1)
      // Sent from the shutdown wait loop — where the old handler dropped it.
      expect(out.indexOf('SIGNAL:second')).toBeGreaterThan(out.indexOf('Shutting down'))
      expect(out).toContain('Second signal — force draining')
      expect(out).toContain('Force shutdown — killing 1 worker(s)')
      expect(out).toContain('CLEANUP:auto/HON-1')
      expect(out).toContain('RESTORE_QUEUED:HON-1')
      expect(out).not.toMatch(/^(CLAIM|SPAWN):/m)
      expect(isAlive(pids['HON-1'])).toBe(false)
    })

    it(
      'a second signal during a triage call reaches the drain once the call returns',
      { timeout: 30_000 },
      () => {
        const { status, out, pids } = runShutdown('triage')

        expect(status).toBe(1)
        // HON-1 and HON-3 both fail. Whichever is triaged first sends the
        // second signal; the other is left to the drain rather than costing a
        // second triage call that stop_wait_bound does not allow for.
        const triaged = [...out.matchAll(/^TRIAGE_START:(HON-\d+)$/gm)].map((m) => m[1])
        expect(triaged).toHaveLength(1)
        const triageEnd = out.indexOf(`TRIAGE_END:${triaged[0]}`)
        const drain = out.indexOf('Force shutdown — killing 2 worker(s)')
        expect(triageEnd).toBeGreaterThan(-1)
        expect(drain).toBeGreaterThan(triageEnd)
        const restored = [...out.matchAll(/^RESTORE_QUEUED:(HON-\d+)$/gm)].map((m) => m[1])
        expect(restored.sort()).toEqual(['HON-1', 'HON-2', 'HON-3'].filter((i) => i !== triaged[0]))
        expect(isAlive(pids['HON-2'])).toBe(false)
      },
    )

    it('the trap handler only sets flags', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'shutdown')

      expect(body).not.toMatch(/\b(exit|drain_workers_to_queue|monitor_workers|sleep)\b/)
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

    it('stops the command at once when the bound is not a whole number of seconds', () => {
      // GNU timeout accepts `1.5`, so ORCHESTRATOR_TRIAGE_TIMEOUT can carry one.
      // The watchdog cannot count it in ticks and must fail closed, not exit
      // on an arithmetic error and leave the triage call unbounded (HON-802).
      // The command sleeps well past the 2 s TERM-to-KILL grace, so the result
      // cannot hinge on the KILL racing the command's own exit (HON-856).
      const out = drive('1.5', '5')

      expect(out).toContain('EXIT:124')
      expect(out).not.toContain('piped-stdin')
    })

    it('re-sends TERM when the first one is lost', () => {
      // A TERM that lands before the forked child sheds orchestrator.sh's
      // inherited TERM trap is dropped. The command here swallows its first
      // TERM to stand in for that; a watchdog that signals once can only KILL
      // it, and it never prints RESENT (HON-856).
      const out = runHarness('bash-timeout-term-once', '1')

      expect(out).toContain('EXIT:124')
      expect(out).toContain('OUT:RESENT')
      expect(out).not.toContain('piped-stdin')
    })

    it('reads a leading-zero bound as decimal', () => {
      // Bash arithmetic reads `08` as bad octal and `010` as eight. The first
      // bound it mangles is 8 s, too slow to drive here, so pin the base.
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'bash_timeout')

      expect(body).toContain('10#$secs')
    })

    it('passes stdin through and returns the real status inside the bound', () => {
      const out = drive('5', '0')

      expect(out).toContain('EXIT:0')
      // Bash gives an async command /dev/null for stdin when job control is
      // off; without the explicit re-attach the triage CLI would be handed an
      // empty log and asked to diagnose it.
      expect(out).toContain('OUT:piped-stdin')
    })

    it('keeps waiting when a signal handler interrupts its wait', () => {
      // shutdown() now returns (HON-1067), and a trap that returns cuts `wait`
      // short with 128+signal. check_checkout_behind calls this in the main
      // shell, so a `wt stop` landing mid-fetch read as a timeout (124) and left
      // the command running.
      const out = runHarness('bash-timeout-signal')

      expect(out).toContain('SHUTTING_DOWN:true')
      expect(out).toContain('OUT:finished')
      expect(out).toContain('EXIT:0')
    })

    it('returns promptly when the command finishes well inside the bound', () => {
      // Every handle_failure test goes through this watchdog on a Mac, so its
      // poll interval is a floor under each one. At the old whole-second poll
      // ten 50 ms calls measured 10 s; at tenths they take about one.
      // The bound leaves room for a loaded machine without letting the old
      // floor back in (HON-802).
      const out = runHarness('bash-timeout-return', '10')
      const elapsed = Number(out.match(/^ELAPSED:(\d+)$/m)?.[1])

      expect(elapsed).toBeLessThan(5)
    })
  })
})
