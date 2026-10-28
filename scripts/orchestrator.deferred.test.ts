import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  harnessEnv,
  scriptsDir,
  shellFunctionBody,
  stripTimestamps,
  worktreeClaude,
  type PrState,
} from './orchestrator-test-harness'

const deferredHarness = path.join(scriptsDir, 'orchestrator-deferred-harness.sh')

type Reason = 'clean' | 'timeout' | 'error'

/** Poll 1 runs the outcome handler; each later poll runs process_deferred. */
function polls(
  env: Record<string, string>,
  reason: Reason,
  commits: number,
  ...states: PrState[]
): string {
  return stripTimestamps(
    execFileSync('bash', [deferredHarness, 'polls', reason, String(commits), ...states], {
      encoding: 'utf8',
      timeout: 30_000,
      env: harnessEnv(env),
    }),
  )
}

/** The text a line starting with `prefix` carries, or undefined. */
function lineAfter(out: string, prefix: string): string | undefined {
  return out
    .split('\n')
    .find((l) => l.startsWith(prefix))
    ?.slice(prefix.length)
}

const NETWORK = { HARNESS_NETWORK: 'end' }

// HON-1414: on 2026-10-28 five workers died on a network drop while GitHub and
// Linear were also unreachable. Each outcome was recorded at once from a failed
// PR lookup, so no run got its finish attempt, no strand got its comment or
// label, and every run waited for a human who had no signal to look.
describe('deferred outcomes (HON-1414)', () => {
  describe('while GitHub does not answer', () => {
    it('records no outcome for a network crash, keeps the worktree and the breaker count', () => {
      const out = polls(NETWORK, 'error', 3, 'ERROR')

      expect(out).toContain('[DEFERRED] HON-999: the worker lost the network')
      expect(out).not.toContain('[OUTCOME]')
      expect(out).not.toContain('CLEANUP:')
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).not.toContain('LABEL:')
      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).toContain('CONSECUTIVE_FAILURES:0')
    })

    it.each(['clean', 'timeout', 'error'] as Reason[])(
      'records no outcome from a failed PR lookup on the %s path',
      (reason) => {
        const out = polls({}, reason, 3, 'ERROR')

        expect(out).toContain('[DEFERRED] HON-999: the PR lookup failed')
        expect(out).not.toContain('[OUTCOME]')
        expect(out).not.toContain('CLEANUP:')
        expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"probe"}]')
      },
    )

    it('defers a network crash even when gh answered at once', () => {
      const out = polls(NETWORK, 'error', 3, 'OPEN')

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).not.toContain('[OUTCOME]')
    })

    it('keeps waiting while the replayed lookup still fails', () => {
      const out = polls(NETWORK, 'error', 3, 'ERROR', 'ERROR')

      expect(out).toContain('POLL:2:1:[{"issue":"HON-999","kind":"network"}]')
      expect(out).not.toContain('[OUTCOME]')
    })

    it('replays nothing on a poll where Linear does not answer', () => {
      const out = polls(
        { ...NETWORK, HARNESS_LINEAR_DOWN: '2' },
        'error',
        3,
        'ERROR',
        'OPEN',
        'OPEN',
      )

      expect(out).toContain('POLL:2:1:')
      expect(out.indexOf('Replaying')).toBeGreaterThan(out.indexOf('POLL:2:'))
      expect(out).toContain('POLL:3:0:[]')
    })
  })

  describe('on the next poll that reaches GitHub and Linear', () => {
    it.each(['clean', 'timeout', 'error'] as Reason[])(
      'gives a failed lookup on the %s path its finish attempt',
      (reason) => {
        const out = polls({}, reason, 3, 'ERROR', 'OPEN')

        expect(out).toMatch(/\[OUTCOME\] HON-999 STRANDED .* pr=#650 ci=green .*triage=FINISH/)
        expect(out).toContain('CLEANUP:test-branch:true')
        expect(out).toContain('WT_CALL:1:auto HON-999')
        expect(out).toContain('POLL:2:0:[]')
      },
    )

    it('reports SUCCESS when the PR merged', () => {
      const out = polls(NETWORK, 'error', 3, 'ERROR', 'MERGED')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).toContain('CLEANUP:test-branch:false')
      expect(out).not.toContain('WT_CALL:')
    })

    it('respawns a network crash with an open PR on its branch, without triage', () => {
      const out = polls(NETWORK, 'error', 3, 'ERROR', 'OPEN')

      expect(out).toContain(
        '[OUTCOME] HON-999 NETWORK 0s 3-commits phase=pr-review pr=#650 triage=RESPAWN',
      )
      expect(out).not.toContain('HANDLE_FAILURE')
      expect(out).not.toContain('triage=FINISH')
      expect(out).toContain('CLEANUP:test-branch:true')
      expect(out).toContain('WT_CALL:1:auto HON-999')
      expect(out).not.toContain('WT_CALL:2:')
      const context = lineAfter(out, 'WT_CONTEXT:1:')
      expect(context).toMatch(/^Retry context: /)
      expect(context).toContain('because the network dropped')
      expect(context).toContain('phase pr-review')
      expect(context).toContain('PR #650 is OPEN: https://github.com/kaupok/wobblepot/pull/650')
    })

    it('does not count a network crash toward the circuit breaker', () => {
      const out = polls(NETWORK, 'error', 3, 'ERROR', 'OPEN')

      expect(out.match(/CONSECUTIVE_FAILURES:\d+/g)).toEqual([
        'CONSECUTIVE_FAILURES:0',
        'CONSECUTIVE_FAILURES:0',
      ])
    })

    it('keeps the finish attempt: an issue that had it still gets one network respawn', () => {
      const out = polls({ ...NETWORK, HARNESS_RETRIED: '1' }, 'error', 3, 'ERROR', 'OPEN')

      expect(out).toContain('triage=RESPAWN')
      expect(out).toContain('WT_CALL:1:auto HON-999')
      expect(out).toContain('WORKER_RETRIED:1')
    })

    it('leaves WORKER_RETRIED at 0 so a first attempt keeps its finish attempt', () => {
      expect(polls(NETWORK, 'error', 3, 'ERROR', 'OPEN')).toContain('WORKER_RETRIED:0')
    })

    it('records a second network crash of the same issue, still outside the breaker', () => {
      const out = polls(
        { ...NETWORK, HARNESS_RETRIED: '1', HARNESS_NETWORK_RESPAWNED: 'HON-998,HON-999' },
        'error',
        3,
        'ERROR',
        'OPEN',
      )

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('triage=RESPAWN')
      expect(out).not.toContain('WT_CALL:')
      expect(out).toContain('LABEL:Stranded')
      expect(out.match(/CONSECUTIVE_FAILURES:\d+/g)).toEqual([
        'CONSECUTIVE_FAILURES:0',
        'CONSECUTIVE_FAILURES:0',
      ])
    })

    it('does not respawn a network crash while the orchestrator shuts down', () => {
      const out = polls({ ...NETWORK, HARNESS_SHUTTING_DOWN: 'true' }, 'error', 3, 'ERROR', 'OPEN')

      expect(out).not.toContain('triage=RESPAWN')
      expect(out).not.toContain('WT_CALL:')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
    })
  })

  describe('uncommitted work', () => {
    const dirs: string[] = []
    afterEach(() => {
      for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
    })

    function fixture(dirty: boolean): { wt: string; logs: string } {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-deferred-wt-'))
      dirs.push(root)
      const wt = path.join(root, 'wt')
      const logs = path.join(root, 'logs')
      fs.mkdirSync(wt)
      fs.mkdirSync(logs)
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', wt, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
      git('init', '-q')
      fs.writeFileSync(path.join(wt, 'tracked.txt'), 'one\n')
      git('add', 'tracked.txt')
      git('commit', '-qm', 'init')
      if (dirty) {
        fs.writeFileSync(path.join(wt, 'tracked.txt'), 'one\ntwo\n')
        fs.writeFileSync(path.join(wt, 'untracked.txt'), 'new file\n')
      }
      return { wt, logs }
    }

    it('saves tracked and untracked changes as a patch that the retry context names', () => {
      const { wt, logs } = fixture(true)
      const out = polls(
        { ...NETWORK, HARNESS_WT_PATH: wt, HARNESS_LOG_DIR: logs },
        'error',
        0,
        'ERROR',
        'NONE',
      )

      const patches = fs.readdirSync(logs).filter((f) => f.endsWith('.patch'))
      expect(patches).toHaveLength(1)
      const patchFile = path.join(logs, patches[0] ?? '')
      expect(patches[0]).toMatch(/^HON-999-uncommitted-\d{8}-\d{6}\.patch$/)
      const patch = fs.readFileSync(patchFile, 'utf8')
      expect(patch).toContain('+two')
      expect(patch).toContain('+++ b/untracked.txt')
      expect(patch).toContain('+new file')

      expect(out).toContain(
        '[OUTCOME] HON-999 NETWORK 0s 0-commits phase=pr-review pr=none triage=RESPAWN',
      )
      expect(out).not.toContain('HANDLE_FAILURE')
      const context = lineAfter(out, 'WT_CONTEXT:1:')
      expect(context).toContain(`git apply ${patchFile}`)
      expect(context).toContain('No PR is open yet.')
      // The patch is written before the worktree is removed.
      expect(out.indexOf('Saved the uncommitted work')).toBeLessThan(out.indexOf('CLEANUP:'))
    })

    it('writes no patch for a clean worktree', () => {
      const { wt, logs } = fixture(false)
      const out = polls(
        { ...NETWORK, HARNESS_WT_PATH: wt, HARNESS_LOG_DIR: logs },
        'error',
        2,
        'ERROR',
        'NONE',
      )

      expect(fs.readdirSync(logs).filter((f) => f.endsWith('.patch'))).toEqual([])
      expect(lineAfter(out, 'WT_CONTEXT:1:')).toContain('The worktree had no uncommitted work.')
    })
  })

  describe('a Linear write that fails', () => {
    it('retries the comment on the next poll and posts it once', () => {
      const out = polls(
        { HARNESS_RETRIED: '1', HARNESS_COMMENT_FAILS: '1' },
        'error',
        3,
        'OPEN',
        'OPEN',
        'OPEN',
      )

      expect(out).toContain('Failed to comment on HON-999')
      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(out).toContain('POLL:2:0:[]')
      expect(out.match(/^COMMENT:/gm)).toHaveLength(1)
      expect(out.indexOf('COMMENT:')).toBeGreaterThan(out.indexOf('POLL:1:'))
      // The label landed on poll 1, so the replay does not add it again.
      expect(out.match(/^LABEL:Stranded/gm)).toHaveLength(1)
      // The strand was counted once, on poll 1.
      expect(out).toMatch(/POLL:3:0:\[\]\nCONSECUTIVE_FAILURES:1/)
    })

    it('retries only the label when the comment landed', () => {
      const out = polls(
        { HARNESS_RETRIED: '1', HARNESS_LABEL_FAILS: '1' },
        'error',
        3,
        'OPEN',
        'OPEN',
      )

      expect(out).toContain('Linear writes failed (label)')
      expect(out).toContain('POLL:2:0:[]')
      expect(out.match(/^COMMENT:/gm)).toHaveLength(1)
      expect(out.match(/^LABEL:Stranded/gm)).toHaveLength(1)
      expect(out.indexOf('LABEL:Stranded')).toBeGreaterThan(out.indexOf('POLL:1:'))
    })

    it.each([
      ['the state read fails', 'fail', 'ok', '[ queue]'],
      ['the move to Queued fails', 'ok', 'fail', '[ queue]'],
      ['both answer', 'ok', 'ok', '[]'],
    ])('marks the return to Queued for a retry when %s', (_name, read, move, failed) => {
      const out = execFileSync('bash', [deferredHarness, 'restore-queue', read, move], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      expect(out).toContain(`LINEAR_WRITES_FAILED:${failed}`)
    })

    it('keeps the write deferred while the comment keeps failing', () => {
      const out = polls(
        { HARNESS_RETRIED: '1', HARNESS_COMMENT_FAILS: '2' },
        'error',
        3,
        'OPEN',
        'OPEN',
        'OPEN',
      )

      expect(out).toContain('POLL:2:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(out).toContain('POLL:3:0:[]')
      expect(out.match(/^COMMENT:/gm)).toHaveLength(1)
    })
  })

  describe('a worker that quotes the marker', () => {
    it('is not a network crash when ordinary output follows the marker', () => {
      const out = polls({ HARNESS_NETWORK: 'mid', HARNESS_RETRIED: '1' }, 'error', 3, 'OPEN')

      expect(out).not.toContain('[DEFERRED]')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
    })

    it('is not a network crash on a timeout, which is the orchestrator’s own kill', () => {
      const out = polls({ ...NETWORK, HARNESS_RETRIED: '1' }, 'timeout', 3, 'OPEN')

      expect(out).not.toContain('[DEFERRED]')
      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
    })
  })

  describe('a reload', () => {
    it('hands every deferred entry and the network respawns to the new image', () => {
      const out = execFileSync('bash', [deferredHarness, 'reload'], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      const before = out.match(/^BEFORE:(.*)$/gm)?.map((l) => l.slice('BEFORE:'.length))
      const after = out.match(/^AFTER:(.*)$/gm)?.map((l) => l.slice('AFTER:'.length))
      expect(before).toEqual([
        '[network][HON-1][error][uuid-1][branch-1][/logs/w1.log][0][Title one][1][60]',
        '[probe][HON-2][clean][uuid-2][branch-2][/logs/w2.log][1][Title two][][120]',
      ])
      expect(after).toEqual(before)
      expect(out).toContain('RESPAWNED:HON-7')
      expect(out).toContain('LEFT_IN_ENV:unset')
    })

    it('holds a slot for each deferred worker that keeps its worktree', () => {
      const out = execFileSync('bash', [deferredHarness, 'slots'], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      expect(out).toContain('SLOTS:2')
      expect(out).toContain('EMPTY:0')
    })

    // Without it the gate fills a deferred worker's slot on the same poll, and
    // the replay's respawn then runs past MAX_WORKERS and the Neon branch cap.
    it('counts the deferred slots in the spawn gate', () => {
      const source = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')

      expect(shellFunctionBody(source, 'main')).toContain(
        'local active=$(( ${#WORKER_PIDS[@]} + $(deferred_slots) ))',
      )
    })

    // A replay in the poll that deferred the outcome would respawn a network
    // crash at once, while the API is likely still down.
    it('replays before monitor_workers, so a deferral waits a full poll', () => {
      const source = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')
      const main = shellFunctionBody(source, 'main')
      const calls = main.match(/^\s*(process_deferred|monitor_workers)$/gm)?.map((l) => l.trim())

      expect(calls).toEqual([
        'process_deferred',
        'monitor_workers',
        'process_deferred',
        'monitor_workers',
      ])
    })

    it('replays on every poll, in the shutdown wait too', () => {
      const source = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')
      const main = shellFunctionBody(source, 'main')

      expect(main.match(/^\s*process_deferred$/gm)).toHaveLength(2)
      expect(main.match(/^\s*warn_deferred_left$/gm)).toHaveLength(2)
    })

    it('is wired into reload_if_code_changed and restore_reload_state', () => {
      const source = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')

      expect(source).toMatch(/\n {2}export_deferred_state\n/)
      expect(source).toMatch(/\n {2}restore_deferred_state\n/)
    })
  })

  describe('wt watch', () => {
    function note(status: unknown): string {
      return execFileSync(
        'bash',
        [
          '-c',
          'source "$1" >/dev/null 2>&1; printf "[%s]" "$(watch_deferred_note "$2")"',
          '_',
          worktreeClaude,
          JSON.stringify(status),
        ],
        { encoding: 'utf8', timeout: 30_000, env: harnessEnv() },
      )
    }

    it('shows how many outcomes wait, and why', () => {
      expect(
        note({
          deferred: [
            { issue: 'HON-1', kind: 'network' },
            { issue: 'HON-2', kind: 'network' },
          ],
        }),
      ).toBe('[deferred: 2 (network)]')
      expect(
        note({
          deferred: [
            { issue: 'HON-1', kind: 'probe' },
            { issue: 'HON-2', kind: 'network' },
          ],
        }),
      ).toBe('[deferred: 2 (network, probe)]')
    })

    it('shows nothing when none wait, or for a status file older than the field', () => {
      expect(note({ deferred: [] })).toBe('[]')
      expect(note({ workers: [] })).toBe('[]')
    })
  })
})
