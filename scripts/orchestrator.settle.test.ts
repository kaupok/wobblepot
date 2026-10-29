import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  harnessEnv,
  scriptsDir,
  shellFunctionBody,
  stripTimestamps,
} from './orchestrator-test-harness'

const deferredHarness = path.join(scriptsDir, 'orchestrator-deferred-harness.sh')

/**
 * Poll 1 runs handle_error_exit, which defers the outcome; then the harness
 * takes the exit path in HARNESS_EXIT (settle | force).
 */
function exitAfterDefer(env: Record<string, string>, commits: number, firstPoll = 'ERROR'): string {
  return stripTimestamps(
    execFileSync('bash', [deferredHarness, 'polls', 'error', String(commits), firstPoll], {
      encoding: 'utf8',
      timeout: 30_000,
      env: harnessEnv(env),
    }),
  )
}

const NETWORK = { HARNESS_NETWORK: 'end' }

// HON-1447: DEFERRED lives only in memory. A stop or a --once run that exited
// with an outcome still deferred left the issue In Progress and assigned, with
// no comment and no Stranded label, so the picker skipped it for good.
describe('deferred outcomes at exit (HON-1447)', () => {
  describe('graceful stop', () => {
    it('records a network crash without the PR lookup while gh still fails', () => {
      const out = exitAfterDefer(
        { ...NETWORK, HARNESS_SHUTTING_DOWN: 'true', HARNESS_EXIT: 'settle' },
        3,
      )

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).toContain('recording the outcome without the PR lookup')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 3-commits phase=pr-review pr=none')
      expect(out).toContain('LABEL:Stranded')
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('EXIT:0:2')
      expect(out).not.toContain('unrecorded')
    })

    it('replays a network crash when gh answers, and does not respawn it', () => {
      const out = exitAfterDefer(
        {
          ...NETWORK,
          HARNESS_SHUTTING_DOWN: 'true',
          HARNESS_EXIT: 'settle',
          HARNESS_EXIT_PR: 'OPEN',
        },
        3,
      )

      expect(out).toContain('Replaying the deferred outcome of HON-999 (network)')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 3-commits phase=pr-review pr=#650')
      expect(out).not.toContain('triage=RESPAWN')
      expect(out).not.toContain('WT_CALL:')
      expect(out).toContain('EXIT:0:2')
    })

    it('logs a Linear write that still fails at exit, with the issue and the write', () => {
      // An open PR records the strand at once; its comment fails on every call.
      const out = exitAfterDefer(
        {
          HARNESS_SHUTTING_DOWN: 'true',
          HARNESS_EXIT: 'settle',
          HARNESS_EXIT_PR: 'OPEN',
          HARNESS_COMMENT_FAILS: '99',
        },
        3,
        'OPEN',
      )

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(out).toContain(
        'ERROR [DEFERRED] HON-999: Linear writes still fail at exit (comment) — make them by hand',
      )
      expect(out).not.toContain('COMMENT:')
      expect(out).toContain('EXIT:0:2')
    })

    it('makes a deferred Linear write at exit when Linear answers', () => {
      const out = exitAfterDefer(
        {
          HARNESS_SHUTTING_DOWN: 'true',
          HARNESS_EXIT: 'settle',
          HARNESS_EXIT_PR: 'OPEN',
          HARNESS_COMMENT_FAILS: '1',
        },
        3,
        'OPEN',
      )

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(out).toContain('COMMENT:## Auto-implementation stranded at `pr-review`')
      expect(out).not.toContain('make them by hand')
      expect(out).toContain('EXIT:0:2')
    })
  })

  describe('force stop', () => {
    it('records a deferred network crash before it exits 1', () => {
      const out = exitAfterDefer(
        { ...NETWORK, HARNESS_SHUTTING_DOWN: 'true', HARNESS_EXIT: 'force' },
        3,
      )

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 3-commits phase=pr-review pr=none')
      expect(out).toContain('LABEL:Stranded')
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('EXIT:0:2')
      expect(out).toContain('EXIT_STATUS:1')
      // Recorded before the stop line, not after it.
      expect(out.indexOf('[OUTCOME] HON-999')).toBeLessThan(
        out.indexOf('Orchestrator stopped (forced)'),
      )
    })
  })

  describe('--once', () => {
    it('records a network-crashed worker and sets exit code 1, not 2', () => {
      const out = exitAfterDefer(
        { ...NETWORK, HARNESS_RUN_ONCE: 'true', HARNESS_EXIT: 'settle' },
        3,
      )

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 3-commits phase=pr-review pr=none')
      expect(out).toContain('LABEL:Stranded')
      expect(out).toContain('EXIT:0:1')
    })

    // --once does not set SHUTTING_DOWN, so without the exit pass setting it a
    // replay with gh back would respawn the worker after the loop has ended.
    it('does not respawn or finish a network crash when gh answers at exit', () => {
      const out = exitAfterDefer(
        { ...NETWORK, HARNESS_RUN_ONCE: 'true', HARNESS_EXIT: 'settle', HARNESS_EXIT_PR: 'NONE' },
        3,
      )

      expect(out).not.toContain('triage=RESPAWN')
      expect(out).not.toContain('triage=FINISH')
      expect(out).not.toContain('WT_CALL:')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 3-commits phase=pr-review pr=none')
      expect(out).toContain('EXIT:0:1')
    })
    // A network crash before the first commit, gh back at exit: the triage
    // cleanup would force-remove the worktree with its uncommitted work, and
    // send an issue that is fine to Backlog with Failed.
    it('strands a 0-commit network crash at exit and keeps its worktree', () => {
      const out = exitAfterDefer(
        { ...NETWORK, HARNESS_RUN_ONCE: 'true', HARNESS_EXIT: 'settle', HARNESS_EXIT_PR: 'NONE' },
        0,
      )

      expect(out).toContain('[OUTCOME] HON-999 STRANDED 0s 0-commits phase=pr-review pr=none')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).not.toContain('CLEANUP:')
      expect(out).toContain('RESTORE_QUEUED:HON-999')
      expect(out).toContain('EXIT:0:1')
    })
  })

  // A probe entry (no network marker) with gh back at exit and Linear maybe
  // still down: handle_failure would delete the worktree, log a Backlog move
  // that failed, and report no failed write (HON-1447 review).
  describe('a 0-commit probe-deferred run', () => {
    it.each(['error', 'timeout'] as const)(
      'strands on the %s path at exit, with no triage',
      (reason) => {
        const out = stripTimestamps(
          execFileSync('bash', [deferredHarness, 'polls', reason, '0', 'ERROR'], {
            encoding: 'utf8',
            timeout: 30_000,
            env: harnessEnv({
              HARNESS_SHUTTING_DOWN: 'true',
              HARNESS_EXIT: 'settle',
              HARNESS_EXIT_PR: 'NONE',
            }),
          }),
        )

        expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"probe"}]')
        expect(out).toContain('[OUTCOME] HON-999 STRANDED')
        expect(out).not.toContain('HANDLE_FAILURE')
        expect(out).not.toContain('CLEANUP:')
        expect(out).toContain('EXIT:0:2')
      },
    )
  })

  describe('wiring', () => {
    const source = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')

    it('runs on the graceful stop and before the --once exit', () => {
      const main = shellFunctionBody(source, 'main')

      expect(main.match(/^\s*settle_deferred_at_exit$/gm)).toHaveLength(2)
      expect(main).toMatch(/All workers finished, exiting"\n\s*settle_deferred_at_exit\n/)
      expect(main).toMatch(
        /settle_deferred_at_exit\n.*Orchestrator stopped.*\n\n.*\n\s*if \[ "\$RUN_ONCE" = true \]/,
      )
    })

    it('runs on the force drain, after the workers are drained', () => {
      expect(shellFunctionBody(source, 'drain_if_forced')).toMatch(
        /drain_workers_to_queue\n\s*settle_deferred_at_exit\n/,
      )
    })
  })
})
