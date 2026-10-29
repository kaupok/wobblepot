import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  scriptsDir,
  orchestrator,
  worktreeClaude,
  neonCleanup,
  e2eLocal,
  harness,
  models,
  prReview,
  harnessEnv,
  stripTimestamps,
  shellFunctionBody,
  runHarness,
  runHarnessEnv,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  // HON-572 widened this: worktree-claude.sh and neon-cleanup.sh are edited by
  // the same fixes, and a shell syntax error there is only caught at run time —
  // on the unattended path, hours after the change landed.
  it.each([
    ['orchestrator.sh', orchestrator],
    ['worktree-claude.sh', worktreeClaude],
    ['neon-cleanup.sh', neonCleanup],
    ['e2e-local.sh', e2eLocal],
    ['models.sh', models],
    ['orchestrator-deferred.sh', path.join(scriptsDir, 'orchestrator-deferred.sh')],
    ['pr-review.sh', prReview],
    ['pr-review-base.sh', path.join(scriptsDir, 'pr-review-base.sh')],
  ])('%s is syntactically valid', (_name, script) => {
    expect(() => execFileSync('bash', ['-n', script], { timeout: 30_000 })).not.toThrow()
  })

  describe('status file poll_interval (HON-937)', () => {
    // `wt watch` stretches its alert age-out to three polls on a slow
    // orchestrator, and this field is the only place it can learn the interval.
    const statusPoll = (interval: string): { poll: unknown; loop: unknown; breaker: unknown } => {
      const out = stripTimestamps(
        runHarnessEnv({ ORCHESTRATOR_POLL_INTERVAL: interval }, 'failure', 'RETRY', '0', 'false'),
      )
      const read = (key: string) => out.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1] ?? ''
      return {
        poll: JSON.parse(read('STATUS_POLL') || '"missing"'),
        loop: JSON.parse(read('STATUS_LOOP') || '"missing"'),
        breaker: read('STATUS_JSON'),
      }
    }

    it('records the poll interval in seconds', () => {
      expect(statusPoll('300').poll).toBe(300)
    })

    it('writes the rest of the status file when the interval is not a number', () => {
      // POLL_INTERVAL is never validated, so `--argjson` on "1m" would have
      // failed the whole write and blanked `wt status`.
      const r = statusPoll('1m')

      expect(r.poll).toBeNull()
      expect(r.breaker).toContain('consecutive_failures')
    })

    it('records the triage timeout, which `wt stop` sizes its wait from (HON-1067)', () => {
      const out = runHarnessEnv(
        { ORCHESTRATOR_TRIAGE_TIMEOUT: '300' },
        'failure',
        'RETRY',
        '0',
        'false',
      )

      expect(out).toMatch(/^STATUS_TRIAGE:300$/m)
    })

    it('leaves last_loop null when the file is written outside the main loop', () => {
      // The `failure` harness runs handle_failure and then write_status_file,
      // as monitor_workers does, without entering the main loop. If a write
      // like that moved last_loop, a triage that outran the age limit would
      // blank a live alert, which is why last_poll is not used.
      expect(statusPoll('60').loop).toBeNull()
    })

    it('stamps last_loop only in the main loop, just before the disk check', () => {
      // Every alert `wt watch` shows is re-logged after check_disk_space on
      // each loop, so a stamp taken just before it keeps a live alert fresh.
      const source = fs.readFileSync(orchestrator, 'utf8')
      const body = shellFunctionBody(source, 'main')
      const stamp = body.indexOf('LAST_LOOP_AT="$(date')
      const disk = body.indexOf('check_disk_space || disk_ok=false')

      expect(stamp).toBeGreaterThan(-1)
      expect(disk).toBeGreaterThan(stamp)
      expect(body.slice(stamp, disk)).not.toMatch(/monitor_workers|interruptible_sleep/)
      // One assignment in main, plus the empty initialiser at file scope.
      expect(source.match(/LAST_LOOP_AT=/g)).toHaveLength(2)
    })
  })

  // ─── HON-572 finding 3: duplicated log lines ──────────────────────────────
  // log() writes a clean line to $MAIN_LOG and, for a terminal, a colored copy
  // to stderr. cmd_start pointed the orchestrator's stderr at the same file, so
  // every line was stored twice — one copy carrying raw ANSI escapes — and
  // `grep '[OUTCOME]' orchestrator.log` returned every outcome twice. Once
  // stderr moved to orchestrator-console.log, that file got the copy instead,
  // so the copy is now written only to a terminal (HON-1068).
  describe('orchestrator.log is written once', () => {
    it('log() adds one clean line to MAIN_LOG and nothing to a stderr that is not a terminal', () => {
      const run = spawnSync('bash', [harness, 'log-once'], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      expect(run.status).toBe(0)
      expect(run.stdout).toContain('FILE_LINES:1')
      expect(run.stdout).toContain('FILE_MARKERS:1')
      expect(run.stdout).toContain('FILE_ESCAPES:0')
      expect(run.stderr).toBe('')
    })

    it('log() still writes the colored copy when stderr is a terminal', () => {
      // `script` gives the harness a pseudo-terminal. Its arguments differ:
      // util-linux (CI) takes the command as a string, BSD (macOS) as argv.
      const args =
        process.platform === 'darwin'
          ? ['-q', '/dev/null', 'bash', harness, 'log-once']
          : ['-qec', `bash '${harness}' log-once`, '/dev/null']
      const run = spawnSync('script', args, {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      expect(run.status).toBe(0)
      expect(run.stdout).toMatch(/\u001b\[[0-9;]*m\s*harness-marker/)
      expect(run.stdout).toContain('FILE_LINES:1')
      expect(run.stdout).toContain('FILE_ESCAPES:0')
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

  // ─── HON-1068: idle polls and worker rows logged on change ────────────────
  // Two DEBUG lines per idle poll were ~80k of the ~110k lines in
  // orchestrator.log on 2026-10-06, and the per-poll worker rows another ~25k.
  describe('quiet polls', () => {
    const pollLog = (steps: string[]) =>
      stripTimestamps(runHarness('poll-summary', steps.join(',')))
    const count = (out: string, text: string) =>
      out.split('\n').filter((l) => l.includes(text)).length

    it('logs ten idle polls with an unchanged queue once', () => {
      const out = pollLog(Array(10).fill('0:none'))

      expect(count(out, 'Polling: 0/5 workers active')).toBe(1)
      expect(count(out, 'No eligible issues found')).toBe(1)
    })

    it('logs a new Polling line when the worker count or the outcome changes', () => {
      const out = pollLog(['0:none', '0:none', '0:eligible', '1:none', '1:none', '0:none'])

      expect(out.split('\n').filter((l) => l.startsWith('DEBUG Polling'))).toEqual([
        'DEBUG Polling: 0/5 workers active',
        'DEBUG Polling: 0/5 workers active',
        'DEBUG Polling: 1/5 workers active',
        'DEBUG Polling: 0/5 workers active',
      ])
      // `eligible` is followed by a Selected line, not by "No eligible".
      expect(count(out, 'No eligible issues found')).toBe(3)
    })

    it('logs the first poll after a pass that did not poll Linear', () => {
      const out = pollLog(['0:none', '-', '0:none'])

      expect(count(out, 'Polling: 0/5 workers active')).toBe(2)
    })

    it('main routes both idle-poll lines through log_poll_summary', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')

      expect(body).not.toContain('log DEBUG "Polling')
      expect(body).not.toContain('log DEBUG "No eligible')
      expect(body).toContain('log_poll_summary "$active" none')
      expect(body).toContain('log_poll_summary "$active" eligible')
      expect(body).toContain('[ "$polled" = true ] || LAST_POLL_SUMMARY=""')
    })

    it('main still stamps last_poll on every pass, outside the poll gate', () => {
      // write_status_file stamps last_poll, and `wt watch` judges liveness by
      // it. It must run before the spawn gate, not only when a Polling line does.
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')
      const loop = body.slice(body.indexOf('while true'))
      const stamp = loop.indexOf('LAST_LOOP_AT="$(date')
      const gate = loop.indexOf('if [ "$active" -lt "$MAX_WORKERS" ]')

      expect(stamp).toBeGreaterThan(-1)
      expect(gate).toBeGreaterThan(stamp)
      expect(loop.slice(stamp, gate)).toContain('write_status_file')
      expect(
        shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'write_status_file'),
      ).toContain('--arg last_poll "$(date')
    })

    // HON-1078: the reload drain line was written 160 times on 2026-10-06 while
    // one worker finished, and the breaker line repeats for a whole pause.
    const drainLog = (steps: string[]) =>
      stripTimestamps(runHarness('reload-drain', steps.join(',')))
    const breakerLog = (steps: string[]) =>
      stripTimestamps(runHarness('breaker-pause', steps.join(',')))
    const drainLines = (out: string) => out.split('\n').filter((l) => l.includes('draining'))
    const breakerLines = (out: string) =>
      out.split('\n').filter((l) => l.includes('Circuit breaker active'))

    it('logs ten reload-pending passes with an unchanged worker count once', () => {
      expect(drainLines(drainLog(Array(10).fill('2')))).toEqual([
        'DEBUG Code changed on disk; draining 2 worker(s) before reloading',
      ])
    })

    it('logs a new drain line when the worker count drops from 2 to 1', () => {
      expect(drainLines(drainLog(['2', '2', '1', '1']))).toEqual([
        'DEBUG Code changed on disk; draining 2 worker(s) before reloading',
        'DEBUG Code changed on disk; draining 1 worker(s) before reloading',
      ])
    })

    it('logs the drain line again after a pass that did not take the drain branch', () => {
      expect(drainLines(drainLog(['1', '-', '1']))).toHaveLength(2)
    })

    it('logs ten passes in a breaker pause shorter than 5 minutes once', () => {
      const steps = Array.from({ length: 10 }, (_, i) => `${1000 + i * 25}:1250`)

      expect(breakerLines(breakerLog(steps))).toEqual([
        'DEBUG Circuit breaker active, 250s remaining',
      ])
    })

    it('logs the same breaker pause again after 5 minutes', () => {
      expect(breakerLines(breakerLog(['1000:1600', '1299:1600', '1300:1600']))).toEqual([
        'DEBUG Circuit breaker active, 600s remaining',
        'DEBUG Circuit breaker active, 300s remaining',
      ])
    })

    it('logs at once when a further failure moves the end of the pause', () => {
      expect(breakerLines(breakerLog(['1000:1600', '1060:1660']))).toHaveLength(2)
    })

    it('main routes the drain and breaker lines through their own gates', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')

      expect(body).not.toContain('log DEBUG "Circuit breaker active')
      expect(body).not.toContain('log DEBUG "Code changed on disk; draining')
      expect(body).toContain('log_breaker_pause "$now" "$remaining"')
      expect(body).toContain('log_reload_drain "$active"')
      expect(body).toContain('[ "$drained" = true ] || LAST_DRAIN_COUNT=""')
      // Neither gate may reset or share the idle-poll summary.
      for (const name of ['log_reload_drain', 'log_breaker_pause']) {
        expect(shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), name)).not.toContain(
          'LAST_POLL_SUMMARY',
        )
      }
    })

    const reportLog = (steps: string[]) =>
      stripTimestamps(runHarness('worker-report', steps.join(',')))
        .split('STEP:')
        .slice(1)
        .map((chunk) => chunk.split('\n').slice(1).filter(Boolean))

    it('writes a worker row once while its phase and commit count hold, within 10 minutes', () => {
      const steps = reportLog(['0;planning:0', '60;planning:0', '540;planning:0'])

      expect(steps[0]).toEqual([
        'DEBUG ── Active workers: 1/5 ──',
        'DEBUG   HON-1      0m00s  planning      no commits yet',
      ])
      // No header either: a quiet poll writes nothing.
      expect(steps[1]).toEqual([])
      expect(steps[2]).toEqual([])
    })

    it('writes a row when the phase changes, and when the commit count changes', () => {
      const steps = reportLog(['0;planning:0', '60;implementing:0', '120;implementing:1'])

      expect(steps[1]).toContain('DEBUG   HON-1      1m00s  implementing  no commits yet')
      expect(steps[2]).toHaveLength(2)
      expect(steps[2]?.[1]).toMatch(/^DEBUG {3}HON-1 {6}2m00s {2}implementing {2}1 commit\(s\)/)
    })

    it('writes an unchanged row again after 10 minutes', () => {
      const steps = reportLog(['0;planning:0', '599;planning:0', '600;planning:0'])

      expect(steps[1]).toEqual([])
      expect(steps[2]).toContain('DEBUG   HON-1     10m00s  planning      no commits yet')
    })

    it('writes only the rows that are due, under one header', () => {
      const steps = reportLog(['0;planning:0;planning:0', '60;planning:0;implementing:0'])

      expect(steps[1]).toEqual([
        'DEBUG ── Active workers: 2/5 ──',
        'DEBUG   HON-2      1m00s  implementing  no commits yet',
      ])
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

    it('rotates the console log to .1 once it passes the size cap', () => {
      const dir = makeDir()
      const consoleLog = path.join(dir, 'orchestrator-console.log')
      fs.writeFileSync(consoleLog, 'y'.repeat(2000))
      const out = rotate(dir, { ORCHESTRATOR_LOG_MAX_BYTES: '1000' })

      expect(out).toContain('CONSOLE_ROTATED_EXISTS:yes')
      expect(fs.readFileSync(`${consoleLog}.1`, 'utf8')).toBe('y'.repeat(2000))
      expect(fs.readFileSync(consoleLog, 'utf8')).toBe('')
      expect(fs.readFileSync(path.join(dir, 'orchestrator.log'), 'utf8')).toContain(
        'Rotated orchestrator-console.log at 2000 bytes (cap 1000)',
      )
    })

    it('keeps a console log descriptor held across the rotation writing to the live file', () => {
      // cmd_start's nohup holds the console log open in append mode. A move
      // would leave that descriptor writing into .1.
      const dir = makeDir()
      const consoleLog = path.join(dir, 'orchestrator-console.log')
      fs.writeFileSync(consoleLog, 'y'.repeat(2000))
      rotate(dir, { ORCHESTRATOR_LOG_MAX_BYTES: '1000', HARNESS_CONSOLE_HELD: '1' })

      expect(fs.readFileSync(consoleLog, 'utf8')).toBe('after-rotate\n')
      expect(fs.readFileSync(`${consoleLog}.1`, 'utf8')).toBe('y'.repeat(2000))
    })

    it('leaves a console log under the cap in place', () => {
      const dir = makeDir()
      const consoleLog = path.join(dir, 'orchestrator-console.log')
      fs.writeFileSync(consoleLog, 'y'.repeat(100))
      const out = rotate(dir, { ORCHESTRATOR_LOG_MAX_BYTES: '1000' })

      expect(out).toContain('CONSOLE_ROTATED_EXISTS:no')
      expect(fs.readFileSync(consoleLog, 'utf8')).toBe('y'.repeat(100))
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
  // UUID, and a stale STATE_QUEUED makes fetch_queued_issues match nothing forever
  // — the queue just looks empty. validate_environment now resolves each ID
  // against Linear and fails fast, naming the stale constant.
  describe('workflow-state UUID validation', () => {
    // Kept in sync with orchestrator.sh by the last test in this block.
    const LIVE_STATES = {
      STATE_BACKLOG: '035a5cef-88de-4334-98a0-b908f61d26a7',
      STATE_QUEUED: 'a397387b-c863-4174-bfc7-57f146196a04',
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

    // HON-1005: `printf … | grep -qxF` under pipefail. grep -q exits on the
    // first match; with the matching ID first and megabytes after it, printf is
    // still writing, dies of SIGPIPE, and the pipeline's 141 read as "stale".
    // The tail is far past a 64 KB pipe buffer plus one grep read, so the old
    // pipeline lost this race on every run, not just occasionally as in CI.
    it('passes when the live IDs are followed by megabytes of further states', () => {
      const filler = Array.from({ length: 50_000 }, (_, i) => `filler-${i}-${'x'.repeat(24)}`)
      const out = stripTimestamps(
        execFileSync('bash', [harness, 'validate-states', '-'], {
          encoding: 'utf8',
          timeout: 30_000,
          env: harnessEnv(),
          input: statesJson([...Object.values(LIVE_STATES), ...filler]),
        }),
      )

      expect(out).toContain('STALE_COUNT:0')
      expect(out).not.toContain('Stale workflow-state UUID')
    })

    it('leaves no echo or printf piped into a reader that exits early', () => {
      // grep -q, awk '…exit' and head stop reading before printf has finished,
      // so the writer dies of SIGPIPE: a wrong answer under `if`, and a 141 that
      // kills the orchestrator in a `$(…)` assignment under set -e. Feed them a
      // here-string or process substitution instead — see worker_hit_neon_cap.
      const earlyExitReader =
        /\b(printf|echo)\b.*\|\s*(grep\b[^|]*\s(-[a-zA-Z]*q[a-zA-Z]*|--quiet|--silent)\b|awk\b.*\bexit\b|head\b)/
      const offenders = fs
        .readFileSync(orchestrator, 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .filter((line) => earlyExitReader.test(line))

      expect(offenders).toEqual([])
    })

    it('names the stale constant when its UUID no longer exists', () => {
      // Queued recreated: its old UUID is gone, a fresh one takes its place.
      const others = Object.values(LIVE_STATES).filter((id) => id !== LIVE_STATES.STATE_QUEUED)
      const out = validate([...others, 'a-freshly-minted-queued-uuid'])

      expect(out).toContain('STALE_COUNT:1')
      expect(out).toContain('Stale workflow-state UUID: STATE_QUEUED')
      expect(out).toContain(LIVE_STATES.STATE_QUEUED)
    })

    it('flags every stale constant, not just the first', () => {
      const out = validate([LIVE_STATES.STATE_QUEUED])

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
  // ─── HON-580: janitorial pass over the orchestrator scripts ───────────────
  // Five minor HON-572 follow-ups. Each was invisible rather than broken: a
  // queue that truncated without saying so, a dead function, two hints naming
  // an entry point that cannot work, and a .env load that executed the file.
  describe('HON-580 orchestrator script cleanup', () => {
    describe('Queue cap', () => {
      const fetchQueue = (count: number) => stripTimestamps(runHarness('queue-cap', String(count)))

      it('warns when the queue is deeper than the cap, naming what it saw', () => {
        const out = fetchQueue(51)

        expect(out).toContain('WARN')
        expect(out).toContain('Queue is deeper than the 50-issue query cap')
        // The count, not the cap: the extra row is a live candidate that
        // select_next_issue sorts across, so at exactly 51 nothing was missed.
        // A message asserting otherwise is a false alarm every poll interval.
        expect(out).toContain('considered 51 issue(s)')
      })

      it.each([0, 1, 50])('stays silent at %i issues', (count) => {
        expect(fetchQueue(count)).not.toContain('Queue is deeper')
      })

      it('leaves the JSON the caller parses uncontaminated', () => {
        // log() writes stderr and $MAIN_LOG. A WARN on stdout would break
        // select_next_issue's jq parse on exactly the poll that needed it most.
        expect(fetchQueue(51)).toContain('NODES:51')
      })

      it('asks for one row past the cap, from the named constant', () => {
        const source = fs.readFileSync(orchestrator, 'utf8')
        const body = shellFunctionBody(source, 'fetch_queued_issues')

        expect(source).toContain('LINEAR_QUEUE_PAGE_SIZE=50')
        expect(body).toContain('first: \'"$((LINEAR_QUEUE_PAGE_SIZE + 1))"\'')
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

  // ─── HON-854: Queued is the queue, Todo belongs to humans ─────────────────
  // HON-852 carried a human-only step, was moved to Todo, and was claimed
  // sixteen seconds later: the queue used to be "Todo and unassigned". Only the
  // Queued state feeds unattended work now, and select_next_issue never sees
  // state at all — the GraphQL filter in fetch_queued_issues is the whole
  // definition of the queue — so these drive the query, not just the picker.
  describe('HON-854 the orchestrator reads Queued only', () => {
    const QUEUED = 'a397387b-c863-4174-bfc7-57f146196a04'
    const TODO = 'bcd0f639-33dd-4da8-a081-4d409c0fe5b4'

    const node = (n: number, state: string, priority = 3) => ({
      _state: state,
      id: `u${n}`,
      identifier: `HON-${n}`,
      title: `Fixture ${n}`,
      branchName: `henri/hon-${n}-fixture`,
      priority,
      assignee: null,
      labels: { nodes: [] },
      relations: { nodes: [] },
      inverseRelations: { nodes: [] },
    })

    const poll = (nodes: object[]) =>
      stripTimestamps(runHarness('queue-poll', JSON.stringify(nodes)))

    it('selects the Queued issue and never the Todo one', () => {
      // The Todo issue is listed first and outranks the Queued one on
      // priority, so only the state filter can explain picking HON-2.
      const out = poll([node(1, TODO, 1), node(2, QUEUED, 3)])

      expect(out).toContain(`QUERIED_STATE:${QUEUED}`)
      expect(out).toContain('PICK:u2\tHON-2')
      expect(out).not.toContain('HON-1')
    })

    // HON-1193: the PICK line carries the Small tier ahead of the title.
    it('marks a Small issue with 1 in the PICK line, and an unlabelled one with 0', () => {
      const small = { ...node(1, QUEUED), labels: { nodes: [{ name: 'Tech' }, { name: 'Small' }] } }

      expect(poll([small])).toContain('PICK:u1\tHON-1\thenri/hon-1-fixture\t1\tFixture 1\n')
      expect(poll([node(2, QUEUED)])).toContain(
        'PICK:u2\tHON-2\thenri/hon-2-fixture\t0\tFixture 2\n',
      )
    })

    it('selects nothing when the only unassigned, unblocked issue is in Todo', () => {
      expect(poll([node(1, TODO)])).toMatch(/^PICK:$/m)
    })

    it('no longer names the Todo state anywhere in the script', () => {
      // Nothing reads or writes Todo after the cutover, so neither the constant
      // nor its UUID has a reason to exist; a leftover is a path that still
      // hands issues to humans' Todo instead of back to the queue.
      const source = fs.readFileSync(orchestrator, 'utf8')

      expect(source).not.toContain('STATE_TODO')
      expect(source).not.toContain(TODO)
      expect(source).toContain(`STATE_QUEUED="${QUEUED}"`)
      expect(shellFunctionBody(source, 'fetch_queued_issues')).toContain('"\'"$STATE_QUEUED"\'"')
    })
  })

  describe('HON-940 a gate is answered once the issue leaves Queued', () => {
    /** A fetch_queued_issues-shaped response; `gated` ids carry the Gated label. */
    const response = (ids: number[], gated: number[] = []): string =>
      JSON.stringify({
        data: {
          issues: {
            nodes: ids.map((n) => ({
              id: `u${n}`,
              identifier: `HON-${n}`,
              title: `Fixture ${n}`,
              branchName: `henri/hon-${n}-fixture`,
              priority: 3,
              assignee: null,
              labels: { nodes: gated.includes(n) ? [{ name: 'Gated' }] : [] },
              relations: { nodes: [] },
              inverseRelations: { nodes: [] },
            })),
          },
        },
      })

    /** The REAL reconcile_gated_issues, called twice in one process, as two polls. */
    const reconcile = (json: string, gated: string, env: Record<string, string> = {}): string =>
      stripTimestamps(runHarnessEnv(env, 'gated-reconcile', json, gated))

    const count = (out: string, needle: string): number => out.split(needle).length - 1

    it('logs one [UNGATE] for a gated issue that is no longer in Queued', () => {
      // The operator moved HON-940 to Todo, Backlog or Canceled. Before this,
      // nothing answered that gate and `wt watch` showed it yellow until restart.
      const out = reconcile(response([992]), 'HON-940')

      expect(count(out, '[UNGATE] HON-940 — left Queued')).toBe(1)
      expect(out).toContain('GATED:\n')
    })

    it('logs one [UNGATE] when the label is removed, not one per poll', () => {
      // The HON-655 bug: the drop ran inside $(select_next_issue), died with
      // the subshell, and the same line was logged again on every poll.
      const out = reconcile(response([940]), 'HON-940')

      expect(count(out, '[UNGATE] HON-940 — Gated label removed by operator')).toBe(1)
      expect(out).not.toContain('left Queued')
      expect(out).toContain('GATED:\n')
    })

    it('keeps a gate open while the issue is in Queued with its label', () => {
      const out = reconcile(response([940], [940]), 'HON-940')

      expect(out).not.toContain('[UNGATE]')
      expect(out).toContain('GATED:HON-940')
    })

    it('survives a gated issue that is followed by megabytes of queue', () => {
      // HON-1005: awk's `exit` on the first match used to SIGPIPE the printf
      // feeding it, and the 141 from that `$(…)` assignment under set -e killed
      // the orchestrator outright. Thousands of nodes after the match keep the
      // writer busy long past a 64 KB pipe buffer, so the race is lost every run.
      const ids = Array.from({ length: 20_000 }, (_, i) => 940 + i)
      const out = stripTimestamps(
        execFileSync('bash', [harness, 'gated-reconcile', '-', 'HON-940'], {
          encoding: 'utf8',
          timeout: 30_000,
          env: harnessEnv({ HARNESS_QUEUE_PAGE_SIZE: '50000' }),
          input: response(ids, [940]),
        }),
      )

      expect(out).not.toContain('[UNGATE]')
      expect(out).toContain('GATED:HON-940')
    })

    it('answers each entry on its own', () => {
      const out = reconcile(response([941], [941]), 'HON-940,HON-941,HON-942')

      expect(count(out, '[UNGATE] HON-940 — left Queued')).toBe(1)
      expect(count(out, '[UNGATE] HON-942 — left Queued')).toBe(1)
      expect(out).not.toContain('[UNGATE] HON-941')
      expect(out).toContain('GATED:HON-941\n')
    })

    const IN_PROGRESS = 'efa0cbda-898d-440d-a6a9-36e798d00881'
    const QUEUED = 'a397387b-c863-4174-bfc7-57f146196a04'
    const BACKLOG = '035a5cef-88de-4334-98a0-b908f61d26a7'

    it('keeps a fresh gate whose issue is still In Progress', () => {
      // The requeue after a gate can fail and leave the issue In Progress,
      // where the gate is still in force. Its absence is not an answer.
      for (const state of [IN_PROGRESS, QUEUED, '']) {
        const out = reconcile(response([992]), 'HON-940:u940', { HARNESS_ISSUE_STATE: state })

        expect(out).not.toContain('[UNGATE]')
        expect(out).toContain('GATED:HON-940:u940\n')
      }
    })

    it('answers a fresh gate whose issue moved out before any poll saw it', () => {
      // The third gate in a row trips the circuit breaker, so no poll runs
      // until the pause ends. An operator who moves the issue meanwhile must
      // still get the answer, or the pane stays yellow until restart.
      const out = reconcile(response([992]), 'HON-940:u940', { HARNESS_ISSUE_STATE: BACKLOG })

      expect(count(out, '[UNGATE] HON-940 — left Queued')).toBe(1)
      expect(out).toContain('GATED:\n')
    })

    it('drops the uuid once a poll sees the issue in Queued', () => {
      const out = reconcile(response([940], [940]), 'HON-940:u940')

      expect(out).not.toContain('[UNGATE]')
      expect(out).toContain('GATED:HON-940\n')
    })

    it('still answers a fresh gate whose label is removed', () => {
      const out = reconcile(response([940]), 'HON-940:u940')

      expect(count(out, '[UNGATE] HON-940 — Gated label removed by operator')).toBe(1)
      expect(out).toContain('GATED:\n')
    })

    it('records a gate with its uuid when handle_success gates an issue', () => {
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'handle_success')

      expect(body).toContain('GATED_ISSUES="${GATED_ISSUES:+$GATED_ISSUES,}$issue_id:$issue_uuid"')
    })

    it('keeps an absent entry when the fetch hit the page cap', () => {
      // Past the cap the issue may still be in Queued; answering it would turn
      // the pane dim for a gate that is still in force.
      const out = reconcile(response([1, 2, 3]), 'HON-940', { HARNESS_QUEUE_PAGE_SIZE: '2' })

      expect(out).not.toContain('[UNGATE]')
      expect(out).toContain('GATED:HON-940')
    })

    it('changes nothing when the response has no issue list', () => {
      // A bad fetch read as an empty queue would answer every gate at once.
      for (const bad of ['not json', '{"data":{"issues":null}}']) {
        const out = reconcile(bad, 'HON-940')

        expect(out).not.toContain('[UNGATE]')
        expect(out).toContain('GATED:HON-940')
      }
    })

    it('still skips a re-queued issue that carries the Gated label', () => {
      // Dropping the entry must not let it through: the skip comes from the
      // label, so an empty in-memory list changes nothing here.
      const out = stripTimestamps(runHarness('select-next', response([940, 992], [940]), '', ''))

      expect(out).toContain('PICK:u992\tHON-992')
      expect(out).toContain('[SKIP] HON-940 gated')
    })

    it('runs in the main shell, ahead of the pick', () => {
      // Inside $(...) the rebuilt list would die with the subshell (HON-655).
      const body = shellFunctionBody(fs.readFileSync(orchestrator, 'utf8'), 'main')

      expect(body).toMatch(/^\s*reconcile_gated_issues "\$response"$/m)
      expect(body.indexOf('reconcile_gated_issues')).toBeLessThan(body.indexOf('select_next_issue'))
    })
  })

  describe('the disk check reaches a fully occupied orchestrator (HON-716)', () => {
    const source = () => fs.readFileSync(orchestrator, 'utf8')

    it('checks the disk every poll, not only when a slot is free', () => {
      // It used to be the spawn gate's own condition, inside
      // `if [ "$active" -lt "$MAX_WORKERS" ]`. A disk filling under three
      // running workers therefore logged nothing at all — and `wt watch` shows
      // this WARN as one of the two alerts a busy orchestrator still gets, so
      // the channel existed for a line that could never be written.
      const body = shellFunctionBody(source(), 'main')

      expect(body).toContain('check_disk_space || disk_ok=false')
      expect(body).not.toContain('elif check_disk_space; then')
      // Ordering is the whole point: the check has to precede the slot test.
      expect(body.indexOf('check_disk_space || disk_ok=false')).toBeLessThan(
        body.indexOf('local active=$(( ${#WORKER_PIDS[@]}'),
      )
    })

    it('still gates spawning on the result rather than ignoring it', () => {
      const body = shellFunctionBody(source(), 'main')

      expect(body).toContain('elif [ "$disk_ok" = true ]; then')
      expect(body).toContain('log WARN "Pausing: low disk space"')
    })
  })

  // ─── HON-861: the orchestrator reloads its own code ───────────────────────
  // It ran a day of PR #931's pre-merge code (polling Todo, never Queued)
  // because bash loads a script once and nobody ran `wt stop` / `wt start`.
  describe('HON-861 reload when the code on disk changes', () => {
    const reload = (scenario: string, ...rest: string[]) =>
      stripTimestamps(runHarness('reload', scenario, ...rest))

    it('re-execs itself with its original flags when idle and the code changed', () => {
      const out = reload('changed')

      expect(out).toMatch(
        /^EXEC:\S*bash \S*\/scripts\/orchestrator\.sh --max-workers 2 --poll-interval 30$/m,
      )
      expect(out).toMatch(
        /INFO +Orchestrator code changed on disk \(\S+ -> \S+\); reloading in place \(PID \d+\)/,
      )
      // The new image makes its own; exec skips the EXIT trap that would remove this one.
      expect(out).toContain('SKIPS_FILE:gone')
    })

    it('hands the breaker and the retry bounds to the new image', () => {
      const out = reload('changed')

      expect(out).toContain('ENV:ORCHESTRATOR_RELOAD_FAILURES=3')
      expect(out).toMatch(/^ENV:ORCHESTRATOR_RELOAD_PAUSED_UNTIL=\d+$/m)
      expect(out).toContain('ENV:ORCHESTRATOR_RELOAD_GATED=HON-1,HON-2')
      expect(out).toContain('ENV:ORCHESTRATOR_RELOAD_CAP_REQUEUED=HON-3:1790000000')
      expect(out).toContain('ENV:ORCHESTRATOR_RELOAD_START_TIME=2026-09-30T10:00:00Z')
      expect(out).toContain('ENV:ORCHESTRATOR_RELOAD_CHECKOUT_WARNED=0123456789abcdef')
    })

    it('does nothing while the code is unchanged', () => {
      const out = reload('unchanged')

      expect(out).toContain('NO_EXEC')
      expect(out).not.toContain('reloading')
    })

    it.each([
      ['once', 'the run is --once'],
      ['shutdown', 'the orchestrator is shutting down'],
    ])('does not reload while %s (%s)', (scenario) => {
      const out = reload(scenario)

      expect(out).toContain('NO_EXEC')
      expect(out).toContain('SKIPS_FILE:present')
      expect(out).toContain('PENDING:3:false')
      expect(out).not.toContain('reloading')
      expect(out).not.toContain('WARN')
    })

    it('does not reload when the signal lands during its checks (HON-1067)', () => {
      // The new image starts with SHUTTING_DOWN cleared, so an exec here would
      // lose the first `wt stop` signal.
      const out = reload('shutdown-mid')

      expect(out).toContain('Shutting down')
      expect(out).toContain('NO_EXEC')
      expect(out).not.toContain('reloading in place')
    })

    // A reload with workers running hands them to the new image, or drains
    // them when the new code refuses the handoff: orchestrator.reload.test.ts
    // (HON-1457).

    it.each([
      ['uncommitted', 'an edit that is not committed'],
      ['branch', 'a commit on a branch other than main'],
    ])('does not load %s code (%s) from the working checkout', (scenario) => {
      const out = reload(scenario)

      expect(out).toContain('NO_EXEC')
      // Not a drain: claims carry on as normal.
      expect(out).toContain('PENDING:3:false')
      expect(
        out.match(
          /INFO +Orchestrator code changed on disk but is not committed on main; not reloading it/g,
        ),
      ).toHaveLength(1)
      expect(out).not.toContain('reloading in place')
    })

    it('keeps the running code, with one WARN, when the change fails bash -n', () => {
      const out = reload('syntax')

      expect(out).toContain('NO_EXEC')
      // Three polls, one line: the WARN is once per rejected version.
      expect(
        out.match(/WARN +Orchestrator code changed on disk but fails bash -n \(code\.sh\)/g),
      ).toHaveLength(1)
      expect(out).not.toContain('reloading')
    })

    it('survives an exec that fails, and does not retry it every poll', () => {
      const out = reload('exec-fails')

      expect(out).toContain('NO_EXEC')
      expect(out.match(/reloading in place/g)).toHaveLength(1)
      expect(out).toMatch(/ERROR +Reload failed \(exec exit 126\); keeping the running code/)
      // Nothing half-handed-over is left behind for a worker to inherit.
      expect(out).toContain('LEFT_IN_ENV:0')
      expect(out).toContain('SKIPS_FILE:present')
    })

    describe('a real exec', () => {
      const run = () => {
        const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon861-reload-'))
        const out = stripTimestamps(runHarness('reload', 'round-trip', stateDir))
        // reload-restored owns the dir and removes it; this is only a backstop.
        fs.rmSync(stateDir, { recursive: true, force: true })
        return out
      }
      const field = (out: string, key: string) => out.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1]

      it('keeps the PID, and the lock accepts it', () => {
        const out = run()

        expect(field(out, 'PID_AFTER')).toBe(field(out, 'PID_BEFORE'))
        expect(field(out, 'LOCK_OK')).toBe(field(out, 'PID_BEFORE'))
        expect(out).not.toContain('Another orchestrator is already running')
      })

      it('carries an engaged circuit breaker through', () => {
        const out = run()
        const handedOver = out.match(/^ENV:ORCHESTRATOR_RELOAD_PAUSED_UNTIL=(\d+)$/m)?.[1]

        expect(field(out, 'RELOADED')).toBe('true')
        expect(field(out, 'FAILURES')).toBe('3')
        expect(handedOver).toBeDefined()
        expect(field(out, 'PAUSED_UNTIL')).toBe(handedOver)
        expect(field(out, 'STATUS')).toBe('{"started_at":"2026-09-30T10:00:00Z","failures":3}')
      })

      it('restores the retry bounds and the run start, then clears the hand-over', () => {
        const out = run()

        expect(field(out, 'GATED')).toBe('HON-1,HON-2')
        expect(field(out, 'CAP')).toBe('HON-3:1790000000')
        expect(field(out, 'WARNED')).toBe('0123456789abcdef')
        expect(field(out, 'START')).toBe('2026-09-30T10:00:00Z')
        expect(field(out, 'LEFT_IN_ENV')).toBe('0')
        expect(out).toMatch(/INFO +Reloaded from \S+: circuit breaker failures=3/)
      })
    })

    describe('acquire_lock', () => {
      it('accepts a pid file naming its own PID', () => {
        expect(runHarness('reload-lock', 'self')).toContain('LOCK_OK')
      })

      it('still refuses a pid file naming another live process', () => {
        const res = spawnSync('bash', [harness, 'reload-lock', String(process.pid)], {
          encoding: 'utf8',
          timeout: 30_000,
          env: harnessEnv(),
        })

        expect(res.status).toBe(1)
        expect(res.stdout).not.toContain('LOCK_OK')
        expect(res.stderr).toContain(`Another orchestrator is already running (PID ${process.pid})`)
      })
    })

    describe('wiring', () => {
      const source = () => fs.readFileSync(orchestrator, 'utf8')

      it('fingerprints every file the script sources at load time', () => {
        const src = source()
        const files = src.match(/^ORCHESTRATOR_CODE_FILES=\((.*)\)$/m)?.[1] ?? ''
        const sourced = src
          .split('\n')
          .filter((line) => /^\s*(source|\.)\s/.test(line))
          .map((line) => path.basename((line.trim().split(/\s+/)[1] ?? '').replace(/["']/g, '')))

        expect(files).toContain('"$SCRIPT_DIR/orchestrator.sh"')
        for (const file of sourced) expect(files).toContain(file)
      })

      it('decides on a reload before the spawn gate, which claims nothing while one is pending', () => {
        const body = shellFunctionBody(source(), 'main')

        expect(body.match(/reload_if_code_changed/g)).toHaveLength(1)
        // Before the spawn gate, so a poll that claims an issue cannot reload
        // after spawning it.
        expect(body.indexOf('reload_if_code_changed')).toBeLessThan(
          body.indexOf('local active=$(( ${#WORKER_PIDS[@]}'),
        )
        expect(body).toContain('elif [ "$RELOAD_PENDING" = true ]; then')
        expect(body.indexOf('elif [ "$RELOAD_PENDING" = true ]; then')).toBeLessThan(
          body.indexOf('response=$(fetch_queued_issues'),
        )
      })

      it('does not let a transient validation failure after a reload kill the process', () => {
        const src = source()
        const validate = shellFunctionBody(src, 'validate_environment')

        expect(shellFunctionBody(src, 'main')).toContain(
          'validate_environment || wait_for_environment',
        )
        // A first start still refuses outright.
        expect(validate.indexOf('[ "$RELOADED" = true ] && return 1')).toBeGreaterThan(-1)
        expect(validate.indexOf('[ "$RELOADED" = true ] && return 1')).toBeLessThan(
          validate.lastIndexOf('exit 1'),
        )
      })

      it('keeps the run start time across a reload', () => {
        expect(shellFunctionBody(source(), 'main')).toContain(
          '[ -n "$ORCHESTRATOR_START_TIME" ] || ORCHESTRATOR_START_TIME=',
        )
      })
    })
  })
})
