import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { harnessEnv, type PrState, scriptsDir, stripTimestamps } from './orchestrator-test-harness'

const deferredHarness = path.join(scriptsDir, 'orchestrator-deferred-harness.sh')

/** Poll 1 runs the error-exit handler; each later poll runs process_deferred. */
function polls(env: Record<string, string>, ...states: PrState[]): string {
  return stripTimestamps(
    execFileSync('bash', [deferredHarness, 'polls', 'error', '3', ...states], {
      encoding: 'utf8',
      timeout: 30_000,
      env: harnessEnv(env),
    }),
  )
}

function count(out: string, re: RegExp): number {
  return out.match(re)?.length ?? 0
}

// HON-1452: HON-1414's network respawn and deferred Linear writes had no end
// state. A respawn reopened work a human had closed, a write to a deleted issue
// failed on every poll for the life of the process, and a comment whose curl
// timed out after Linear took it was posted twice.
describe('deferred outcomes end (HON-1452)', () => {
  it('does not respawn a network crash whose PR a human closed', () => {
    const out = polls({ HARNESS_NETWORK: 'end' }, 'ERROR', 'CLOSED')

    expect(out).toContain('[DEFERRED] HON-999: PR #650 was closed — no network respawn')
    expect(out).not.toContain('WT_CALL:')
    expect(out).not.toContain('triage=RESPAWN')
    expect(out).not.toContain('triage=FINISH')
    expect(out).toMatch(/\[OUTCOME\] HON-999 STRANDED .* pr=#650 /)
    expect(out).toContain('COMMENT:## Auto-implementation stranded at `pr-review`')
    expect(out).toContain('LABEL:Stranded')
    expect(out).toContain('POLL:2:0:[]')
  })

  describe('a Linear write that keeps failing', () => {
    const failing = { HARNESS_RETRIED: '1', HARNESS_COMMENT_FAILS: '9' }
    const dropped =
      'ERROR [DEFERRED] HON-999: Linear writes still fail after 0s (comment) — dropped; make them by hand'

    it('is logged once and dropped past DEFER_MAX_AGE', () => {
      const out = polls({ ...failing, HARNESS_DEFER_MAX_AGE: '0' }, 'OPEN', 'OPEN', 'OPEN')

      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(count(out, /Linear writes still fail after/g)).toBe(1)
      expect(out).toContain(dropped)
      expect(out.indexOf(dropped)).toBeGreaterThan(out.indexOf('POLL:1:'))
      expect(out).toContain('POLL:2:0:[]')
      expect(out).toContain('POLL:3:0:[]')
      expect(out).not.toContain('COMMENT:')
    })

    // The label read calls linear_api inside $(…), so only the comment step
    // would see a flag kept in a variable.
    it.each([
      ['comment', failing],
      ['label', { HARNESS_RETRIED: '1', HARNESS_LABEL_FAILS: '1' }],
    ])('drops a %s write at once when Linear says the issue does not exist', (step, env) => {
      const out = polls({ ...env, HARNESS_LINEAR_GONE: '2' }, 'OPEN', 'OPEN', 'OPEN')

      expect(out).toContain(`POLL:1:1:[{"issue":"HON-999","kind":"linear"}]`)
      expect(
        count(
          out,
          new RegExp(
            `ERROR \\[DEFERRED\\] HON-999: Linear says the issue does not exist — dropping its Linear writes \\(${step}\\)`,
            'g',
          ),
        ),
      ).toBe(1)
      expect(out).toContain('POLL:2:0:[]')
      expect(out).not.toContain('still fail after')
    })

    it.each([
      ['Entity not found: Issue', 'GONE:true:true'],
      ['Could not find referenced Issue.', 'GONE:true:true'],
      ['Rate limit exceeded', 'GONE:false:false'],
    ])('reads the GraphQL error "%s" as %s', (message, gone) => {
      const out = execFileSync('bash', [deferredHarness, 'linear-error', message], {
        encoding: 'utf8',
        timeout: 30_000,
        env: harnessEnv(),
      })

      expect(out).toContain(gone)
    })
  })

  describe('a replayed comment', () => {
    it('is not posted again when Linear took the post that timed out', () => {
      const out = polls(
        { HARNESS_RETRIED: '1', HARNESS_COMMENT_FAILS: '1', HARNESS_COMMENT_LANDS: '1' },
        'OPEN',
        'OPEN',
        'OPEN',
      )

      expect(out).toContain('Failed to comment on HON-999')
      expect(out).toContain('POLL:1:1:[{"issue":"HON-999","kind":"linear"}]')
      expect(out).toContain('HON-999 already has the stranded comment — not posting it again')
      expect(count(out, /^COMMENT:/gm)).toBe(1)
      expect(out).toContain('POLL:2:0:[]')
    })

    it('is posted once from an entry older code deferred, with no marker', () => {
      const out = polls(
        { HARNESS_RETRIED: '1', HARNESS_COMMENT_FAILS: '1', HARNESS_OLD_ENTRY: '1' },
        'OPEN',
        'OPEN',
      )

      expect(out).not.toContain('already has the stranded comment')
      expect(count(out, /^COMMENT:/gm)).toBe(1)
      expect(out).toContain('POLL:2:0:[]')
    })
  })
})
