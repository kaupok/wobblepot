import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  harnessEnv,
  orchestrator,
  scriptsDir,
  shellFunctionBody,
  stripTimestamps,
} from './orchestrator-test-harness'

const reloadHarness = path.join(scriptsDir, 'orchestrator-reload-harness.sh')
const reloadLib = path.join(scriptsDir, 'orchestrator-reload.sh')

/**
 * The old image starts three stub workers through the real spawn_worker, then
 * reloads; every scenario but `version` performs a real exec into the new
 * image, which adopts them. Returns the combined output and the exit status.
 */
function runReload(scenario: 'exits' | 'timeout' | 'stop' | 'version') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon1457-reload-'))
  try {
    const res = spawnSync('bash', [reloadHarness, 'reload', scenario, dir], {
      encoding: 'utf8',
      timeout: 60_000,
      env: harnessEnv(),
    })
    return { out: stripTimestamps(res.stdout), status: res.status, stderr: res.stderr }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const field = (out: string, key: string) => out.match(new RegExp(`^${key}:(.*)$`, 'm'))?.[1]
const lines = (out: string, prefix: string) =>
  out.split('\n').filter((line) => line.startsWith(prefix))

// HON-1457: a reload used to wait for every running worker to finish, and
// claimed nothing meanwhile. On 2026-10-28 two such drains cost about 10% of
// the slot-hours. The new image now adopts the workers through a handoff file.
describe('HON-1457 reload hands running workers to the new image', () => {
  describe('a worker that exits after the reload', () => {
    let run: ReturnType<typeof runReload>
    beforeAll(() => {
      run = runReload('exits')
    }, 60_000)

    it('reloads on the first poll with workers running, and keeps claiming', () => {
      expect(run.out).toMatch(
        /INFO +Orchestrator code changed on disk \(\S+ -> \S+\); reloading in place \(PID \d+\), handing over 3 running worker\(s\)/,
      )
      expect(run.out).not.toContain('claiming nothing new')
      // exec keeps the PID, so the workers stay this process's children.
      expect(run.out).toContain('RELOADED:true')
      expect(field(run.out, 'PENDING')).toBe('false')
      expect(run.out).toMatch(/INFO +Adopted 3 running worker\(s\): HON-1 HON-2 HON-3/)
      // A claim after the reload runs alongside the adopted three.
      expect(field(run.out, 'COUNT_AFTER_SPAWN')).toBe('4')
    })

    it('rebuilds every per-worker field and deletes the handoff file', () => {
      const handoff = JSON.parse(field(run.out, 'HANDOFF') ?? '{}')
      expect(handoff.version).toBe(1)
      expect(field(run.out, 'HANDOFF_FILE')).toBe('gone')

      const arrays = lines(run.out, 'ARR:').map((line) => line.split('|'))
      expect(arrays).toHaveLength(3)
      const first = arrays[0] ?? []
      const second = arrays[1] ?? []
      // pid|issue|uuid|branch|log|start|retried|title|reported_at|reported_sig|finishing
      expect(first[0]).toBe(`ARR:0:${handoff.workers[0].pid}`)
      expect(first.slice(1, 4)).toEqual(['HON-1', 'uuid-1', 'auto/hon-1'])
      expect(first[4]).toMatch(/^worker-HON-1-\d{8}-\d{6}\.log$/)
      expect(first[5]).toBe(String(handoff.workers[0].start_time))
      // A tab in a title reads back whole.
      expect(first[7]).toBe('First\ttitle')
      // The second worker is a retry and a finish attempt, with a reported row.
      // Its signature holds the `|` the line is split on, so it spans two cells.
      expect(second.slice(6, 12)).toEqual(['1', 'Second', '1790000000', 'Implementing', '2', '1'])
    })

    it('shows each adopted worker in `wt status` with its phase and its original elapsed time', () => {
      const status = JSON.parse(field(run.out, 'STATUS') ?? '[]')
      const startEpoch = JSON.parse(field(run.out, 'HANDOFF') ?? '{}').workers[0].start_time
      expect(status[0].started_at).toBe(
        new Date(startEpoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      )

      const rows = lines(run.out, 'WT_STATUS:')
      expect(rows).toHaveLength(3)
      // HON-1 started an hour before the reload; the phase comes from its log.
      expect(rows[0]).toMatch(/^WT_STATUS:HON-1 +Implementing +1h0m /)
      expect(rows[1]).toMatch(/^WT_STATUS:HON-2 +Implementing +\d+s /)
    })

    it('routes an adopted exit 0 to handle_success, as before', () => {
      expect(run.out).toMatch(/INFO +Worker HON-1 \(PID \d+\) exited cleanly \(exit 0\)/)
      expect(run.out).toContain('HANDLER:success:HON-1:0')
    })

    it('routes an adopted non-zero exit to handle_error_exit with its exit code', () => {
      expect(run.out).toContain('HANDLER:error:HON-2:3')
    })

    it('treats an adopted worker with no exit file as exit 1', () => {
      expect(run.out).toContain('HANDLER:error:HON-3:1')
    })

    it('leaves no adopted worker behind as a zombie', () => {
      // `kill -0` is true on a zombie, so an unreaped worker would never leave.
      expect(field(run.out, 'LEFT')).toBe('0')
      expect(field(run.out, 'ZOMBIES')).toBe('0')
      expect(lines(run.out, 'HANDLER:')).toHaveLength(4)
    })
  })

  it('times an adopted worker out from its original start time', () => {
    const { out } = runReload('timeout')

    expect(out).toMatch(/WARN +Worker HON-1 \(PID \d+\) timed out after \d+s/)
    expect(out).toMatch(/^HANDLER:timeout:HON-1:\d+$/m)
    expect(lines(out, 'HANDLER:')).toHaveLength(1)
    expect(field(out, 'LEFT')).toBe('2')
  }, 60_000)

  it('lets `wt stop` wait for adopted workers, then force-drain the rest', () => {
    const { out, status } = runReload('stop')

    expect(out).toContain('SHUTTING_DOWN:true FORCE:false')
    expect(out).toContain('Shutting down — waiting for 3 worker(s)')
    expect(out).toContain('HANDLER:success:HON-1:0')
    expect(out).toContain('SHUTTING_DOWN:true FORCE:true')
    expect(out).toContain('Force shutdown — killing 2 worker(s)')
    // HON-2 is a finish attempt; HON-3 goes back to Queued with its branch kept.
    expect(out).toContain('DRAIN_FINISH:HON-2')
    expect(out).toContain('CLEANUP:auto/hon-3:true')
    expect(out).toContain('RESTORE_QUEUED:HON-3')
    expect(status).toBe(1)
  }, 60_000)

  it('falls back to drain, then reload, when the new code refuses the handoff version', () => {
    const { out } = runReload('version')

    expect(out).toMatch(
      /cannot hand over the running workers \(the new code refused the handoff: version 99, this code reads 1\); claiming nothing new until 3 running worker\(s\) finish, then reloading/,
    )
    expect(field(out, 'PENDING')).toBe('true')
    expect(field(out, 'HANDOFF_FILE')).toBe('gone')
    // Once the workers finish, the next poll execs with nothing to hand over.
    expect(field(out, 'LEFT')).toBe('0')
    expect(out).toContain('EXEC')
    expect(field(out, 'WORKERS_FILE_ENV')).toBe('none')
    expect(out).not.toContain('NO_EXEC')
  }, 60_000)

  describe('--check-handoff', () => {
    const check = (content: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hon1457-check-'))
      const file = path.join(dir, 'handoff.json')
      fs.writeFileSync(file, content)
      const res = spawnSync('bash', [reloadLib, '--check-handoff', file], { encoding: 'utf8' })
      fs.rmSync(dir, { recursive: true, force: true })
      return { status: res.status, out: res.stdout.trim() }
    }
    const worker = { pid: 1, start_time: 1, reported_at: 0, log: '/x.log' }

    it('accepts a version 1 handoff', () => {
      expect(check(JSON.stringify({ version: 1, workers: [worker] })).status).toBe(0)
    })

    it.each([
      ['an unknown version', JSON.stringify({ version: 2, workers: [] }), 'version 2'],
      ['no version', JSON.stringify({ workers: [] }), 'version missing'],
      ['text that is not JSON', '{"version": 1, "workers": [', 'not valid JSON'],
      [
        'a worker with no PID',
        JSON.stringify({ version: 1, workers: [{ ...worker, pid: null }] }),
        'lacks a numeric pid',
      ],
    ])('refuses %s', (_name, content, reason) => {
      const res = check(content)
      expect(res.status).toBe(1)
      expect(res.out).toContain(reason)
    })
  })

  describe('wiring', () => {
    const source = fs.readFileSync(orchestrator, 'utf8')

    it('reads the exit code from the file spawn_worker writes', () => {
      const spawn = shellFunctionBody(source, 'spawn_worker')
      const monitor = shellFunctionBody(source, 'monitor_workers')

      expect(spawn).toContain('|| rc=$?')
      expect(spawn).toContain('echo "$rc" > "$log_file.exit"')
      expect(monitor).toContain('read_exit_file "$log_file"')
      expect(monitor).not.toContain('|| exit_code=$?')
    })

    it('is sourced, fingerprinted and listed as checkout code', () => {
      expect(source).toMatch(/^source "\$SCRIPT_DIR\/orchestrator-reload\.sh"$/m)
      expect(source).toMatch(
        /^ORCHESTRATOR_CODE_FILES=\(.*"\$SCRIPT_DIR\/orchestrator-reload\.sh"\)$/m,
      )
      expect(source).toMatch(/^CHECKOUT_CODE_PATHS=\(.*scripts\/orchestrator-reload\.sh /m)
    })

    it('is syntactically valid', () => {
      expect(() => execFileSync('bash', ['-n', reloadLib])).not.toThrow()
      expect(() => execFileSync('bash', ['-n', reloadHarness])).not.toThrow()
    })
  })
})
