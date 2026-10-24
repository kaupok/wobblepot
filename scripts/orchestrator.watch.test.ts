import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  worktreeClaude,
  shellFunctionBody,
  runHarness,
  runHarnessEnv,
} from './orchestrator-test-harness'

describe('orchestrator.sh', () => {
  describe('wt watch summary data (watch_scan_log)', () => {
    /** Write a fixture orchestrator.log and scan it through the real helper. */
    // `now` drives the alert age-out. Empty means no age limit, which is what
    // lets the fixtures below sit on 2026-09-20 without every alert expiring.
    const scan = (lines: string[], since = '', now = '', poll = ''): Record<string, string> => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-scan-'))
      const log = path.join(dir, 'orchestrator.log')
      fs.writeFileSync(log, `${lines.join('\n')}\n`)
      try {
        const out = runHarness('watch-scan-log', log, since, now, poll)
        return Object.fromEntries(
          out
            .split('\n')
            .filter(Boolean)
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
        )
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    const OUTCOMES = [
      '2026-09-20 10:00:00 INFO  [OUTCOME] HON-700 SUCCESS 5m0s 2-commits phase=done',
      '2026-09-20 10:10:00 INFO  [OUTCOME] HON-701 FAILED 1m1s 0-commits phase=initializing triage=NEEDS_HUMAN',
      '2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 3h0m 16-commits phase=pr-review pr=#707 ci=green exit=timeout',
      '2026-09-20 10:30:00 WARN  [OUTCOME] HON-703 GATED 6m1s 0-commits phase=planning',
      '2026-09-20 10:40:00 INFO  [OUTCOME] HON-704 TIMEOUT 1h0m 2-commits phase=pr-review triage=RETRY',
    ]

    it('tallies every verdict the orchestrator can emit', () => {
      // All five [OUTCOME] grammars, since a verdict this misses would silently
      // read as zero on the dashboard rather than as an error.
      const r = scan(OUTCOMES)

      expect(r.TALLY_SUCCESS).toBe('1')
      expect(r.TALLY_FAILED).toBe('1')
      expect(r.TALLY_STRANDED).toBe('1')
      expect(r.TALLY_GATED).toBe('1')
      expect(r.TALLY_TIMEOUT).toBe('1')
    })

    it('reports the most recent outcome with its duration and commit count', () => {
      const r = scan(OUTCOMES)

      expect(r.LAST_OUTCOME).toBe('HON-704 TIMEOUT 1h0m 2-commits phase=pr-review triage=RETRY')
      expect(r.LAST_OUTCOME_AT).toBe('10:40')
    })

    it('excludes outcomes older than the run it is summarising', () => {
      // The window is what makes the pane "this run" rather than "all time":
      // orchestrator.log outlives any single orchestrator process.
      const r = scan(OUTCOMES, '2026-09-20 10:15:00')

      expect(r.TALLY_SUCCESS).toBe('0')
      expect(r.TALLY_FAILED).toBe('0')
      expect(r.TALLY_STRANDED).toBe('1')
      expect(r.TALLY_GATED).toBe('1')
      expect(r.TALLY_TIMEOUT).toBe('1')
    })

    it('flags a window that opens before the log does, so a floor is not shown as a total', () => {
      const inWindow = scan(OUTCOMES, '2026-09-20 09:00:00')
      const covered = scan(OUTCOMES, '2026-09-20 10:00:00')

      expect(inWindow.TALLY_TRUNCATED).toBe('1')
      expect(covered.TALLY_TRUNCATED).toBe('0')
    })

    it('reports the last claim, not a prediction of the next one', () => {
      // `Selected:` is the only trace selection leaves on disk, and it is
      // written after the pick — the candidate list never leaves select_next_issue.
      const r = scan([
        '2026-09-20 10:00:00 INFO  Selected: HON-700 — an earlier issue',
        '2026-09-20 11:00:00 INFO  Selected: HON-706 — Two drifting scoreCandidate() implementations',
      ])

      expect(r.LAST_PICK).toBe('HON-706')
      expect(r.LAST_PICK_AT).toBe('11:00')
    })

    it('counts each skipped issue once per reason, not once per poll', () => {
      // Every poll re-skips the same issues, so a raw line count would measure
      // orchestrator uptime rather than queue health.
      const r = scan([
        '2026-09-20 10:00:00 INFO  [SKIP] HON-640 blocked by HON-639 (Todo)',
        '2026-09-20 10:01:00 INFO  [SKIP] HON-640 blocked by HON-639 (Todo)',
        '2026-09-20 10:02:00 INFO  [SKIP] HON-640 blocked by HON-639 (Todo)',
      ])

      expect(r.SKIPS).toBe('1')
      expect(r.SKIP_SUMMARY).toBe('1 blocked')
    })

    it('groups skip reasons into the categories the pane has room for', () => {
      const r = scan([
        '2026-09-20 10:00:00 INFO  [SKIP] HON-640 blocked by HON-639 (Todo)',
        '2026-09-20 10:00:00 INFO  [SKIP] HON-641 blocker HON-639 is being worked on',
        '2026-09-20 10:00:00 INFO  [SKIP] HON-642 gated (Gated label) — remove it to re-enable',
        '2026-09-20 10:00:00 INFO  [SKIP] HON-643 stranded (Stranded label) — release with wt cleanup',
        '2026-09-20 10:00:00 INFO  [SKIP] HON-644 requeued at the Neon branch cap — cooling down',
        '2026-09-20 10:00:00 INFO  [SKIP] HON-645 assigned',
      ])

      expect(r.SKIPS).toBe('6')
      // Two distinct blocker grammars collapse to one category; the rest stay apart.
      expect(r.SKIP_SUMMARY).toContain('2 blocked')
      expect(r.SKIP_SUMMARY).toContain('1 gated')
      expect(r.SKIP_SUMMARY).toContain('1 stranded')
      expect(r.SKIP_SUMMARY).toContain('1 cap cooldown')
      expect(r.SKIP_SUMMARY).toContain('1 assigned')
    })

    it('surfaces the operational alert that explains an unfilled worker slot', () => {
      const r = scan([
        '2026-09-20 10:00:00 INFO  Selected: HON-700 — something',
        '2026-09-20 10:06:00 WARN  Pausing: low disk space',
      ])

      expect(r.ALERT).toBe('Pausing: low disk space')
      expect(r.ALERT_AT).toBe('10:06')
    })

    it.each([
      ['Low disk space: 0GB free (< 1GB threshold)'],
      ['Pausing: low disk space'],
      ['Failed to fetch issues from Linear'],
      ['Queue is deeper than the 50-issue query cap — this poll considered 51 issue(s)'],
    ])('recognises %j as an operational alert', (message) => {
      const r = scan([`2026-09-20 10:06:00 WARN  ${message}`])

      expect(r.ALERT).toBe(message)
    })

    it('suppresses an alert the orchestrator has since recovered from', () => {
      // The regression this prevents: a Linear fetch that failed hours ago stayed
      // pinned to the summary while three workers it had claimed since ran
      // happily below it, which reads as a live fault.
      const r = scan([
        '2026-09-20 19:25:39 ERROR Linear API request failed (curl error)',
        '2026-09-20 19:25:39 WARN  Failed to fetch issues from Linear',
        '2026-09-20 22:59:52 INFO  Selected: HON-706 — a later claim proves recovery',
      ])

      expect(r.ALERT).toBeUndefined()
      expect(r.LAST_PICK).toBe('HON-706')
    })

    it('keeps an alert that no later progress answers', () => {
      const r = scan([
        '2026-09-20 22:59:52 INFO  Selected: HON-706 — an earlier claim',
        '2026-09-20 23:10:00 WARN  Failed to fetch issues from Linear',
      ])

      expect(r.ALERT).toBe('Failed to fetch issues from Linear')
    })

    it('ignores ordinary progress logging', () => {
      // Only the blockers listed in the helper are alerts; routine INFO/WARN
      // chatter must not claim the alert line.
      const r = scan([
        '2026-09-20 10:00:00 INFO  Worker HON-700 (PID 1) exited cleanly (exit 0)',
        '2026-09-20 10:00:01 INFO  Cleaning up worktree for HON-700',
        '2026-09-20 10:00:02 WARN  Some unrelated warning nobody needs on screen',
      ])

      expect(r.ALERT).toBeUndefined()
    })

    it.each([
      ['HON-700 is no longer In Progress — leaving it untouched after the Neon branch cap'],
      [
        'Could not read the state of HON-701 — requeueing anyway; the Neon branch cap is not its fault',
      ],
    ])('does not report the already-handled requeue %j as a live fault', (message) => {
      // orchestrator.sh:1930 and :1934. Both say "the requeue has been dealt
      // with"; the old `/Neon branch cap/` pattern could not tell them from the
      // cap failure below, so a finished piece of bookkeeping claimed the alert
      // line — and, until HON-937 added the five-minute age-out, nothing but a
      // later claim or outcome cleared it, so it held the line.
      const r = scan([`2026-09-20 10:00:00 WARN  ${message}`])

      expect(r.ALERT).toBeUndefined()
      expect(r.ALERT_FULL).toBeUndefined()
    })

    it('still reports the Neon-cap failure that actually costs a worker slot', () => {
      // orchestrator.sh:1769 — the one cap line that means a worker could not
      // be started. Narrowing the pattern must not lose it.
      const message =
        'HON-700 failed on the Neon branch cap during worktree setup — capacity, not the issue'
      const r = scan([`2026-09-20 10:00:00 WARN  ${message}`])

      expect(r.ALERT).toBe(message)
      // Slot-scoped, though: it says a worker could not be STARTED, which is
      // not a question a full orchestrator is asking.
      expect(r.ALERT_FULL).toBeUndefined()
    })

    it('prefers the always-relevant alert when the two land in the same second', () => {
      // The channels are compared on a 19-character timestamp, so a tie is
      // reachable. It resolves to the alert that survives a full orchestrator,
      // which is the one that stays true under either slot state.
      const r = scan([
        '2026-09-20 10:00:00 WARN  Failed to fetch issues from Linear',
        '2026-09-20 10:00:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
      ])

      expect(r.ALERT).toBe('Low disk space: 0GB free (< 1GB threshold)')
    })

    it.each([['Low disk space: 0GB free (< 1GB threshold)'], ['Pausing: low disk space']])(
      'reports %j on the channel that survives a full orchestrator',
      (message) => {
        // These halt the orchestrator outright and bite the workers already
        // running, so they are worth the line whether or not a slot is free.
        const r = scan([`2026-09-20 10:06:00 WARN  ${message}`])

        expect(r.ALERT).toBe(message)
        expect(r.ALERT_FULL).toBe(message)
      },
    )

    it.each([
      ['Failed to fetch issues from Linear'],
      ['Circuit breaker: 3 consecutive failures, pausing new workers for 600s'],
      ['Queue is deeper than the 50-issue query cap — this poll considered 51 issue(s)'],
    ])('keeps %j off the full-orchestrator channel', (message) => {
      // Each of these only answers "why is a slot unfilled". With no slot to
      // fill the question does not arise, so ALERT_FULL must stay empty.
      const r = scan([`2026-09-20 10:06:00 WARN  ${message}`])

      expect(r.ALERT).toBe(message)
      expect(r.ALERT_FULL).toBeUndefined()
    })

    it('does not let an older always-relevant alert mask a newer slot-only one', () => {
      // The two channels are tracked independently, so ALERT is still the most
      // recent blocker of either kind — the split decides what survives a full
      // orchestrator, not what is reported first.
      const r = scan([
        '2026-09-20 09:00:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
        '2026-09-20 10:00:00 WARN  Failed to fetch issues from Linear',
      ])

      expect(r.ALERT).toBe('Failed to fetch issues from Linear')
      expect(r.ALERT_AT).toBe('10:00')
      expect(r.ALERT_FULL).toBe('Low disk space: 0GB free (< 1GB threshold)')
      expect(r.ALERT_FULL_AT).toBe('09:00')
    })

    it('suppresses a recovered alert on both channels independently', () => {
      // The disk warning predates the claim and is answered by it; the Linear
      // failure does not and is not.
      const r = scan([
        '2026-09-20 09:00:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
        '2026-09-20 09:30:00 INFO  Selected: HON-706 — a later claim proves recovery',
        '2026-09-20 10:00:00 WARN  Failed to fetch issues from Linear',
      ])

      expect(r.ALERT).toBe('Failed to fetch issues from Linear')
      expect(r.ALERT_FULL).toBeUndefined()
    })

    describe('ages out an alert nothing has answered (HON-937)', () => {
      // With an empty Queued state nothing is ever claimed, so the progress
      // rule alone held a single 07:45 curl blip on screen until 11:00. Every
      // condition that persists is re-logged on each one-minute poll, so a
      // live alert's latest occurrence is always within five minutes.
      const BLIP = [
        '2026-10-02 07:45:00 ERROR Linear API request failed (curl error)',
        '2026-10-02 07:45:00 WARN  Failed to fetch issues from Linear',
        '2026-10-02 07:46:00 DEBUG Polling Linear for Queued issues',
        '2026-10-02 07:47:00 DEBUG Polling Linear for Queued issues',
        '2026-10-02 07:48:00 DEBUG Polling Linear for Queued issues',
      ]

      it('drops a one-off WARN once it is more than five minutes old', () => {
        const r = scan(BLIP, '', '2026-10-02 07:52:00')

        expect(r.ALERT).toBeUndefined()
        expect(r.ALERT_AT).toBeUndefined()
      })

      it('keeps the same WARN while it is within five minutes', () => {
        const r = scan(BLIP, '', '2026-10-02 07:49:00')

        expect(r.ALERT).toBe('Failed to fetch issues from Linear')
        expect(r.ALERT_AT).toBe('07:45')
      })

      it('keeps a re-logged condition on screen, measured from its latest line', () => {
        const DISK = [
          '2026-09-20 10:00:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
          '2026-09-20 10:01:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
          '2026-09-20 10:02:00 WARN  Low disk space: 0GB free (< 1GB threshold)',
        ]
        const live = scan(DISK, '', '2026-09-20 10:06:00')
        const stale = scan(DISK, '', '2026-09-20 10:08:00')

        expect(live.ALERT).toBe('Low disk space: 0GB free (< 1GB threshold)')
        expect(live.ALERT_AT).toBe('10:02')
        expect(live.ALERT_FULL).toBe('Low disk space: 0GB free (< 1GB threshold)')
        // The full-orchestrator channel ages out on the same rule.
        expect(stale.ALERT).toBeUndefined()
        expect(stale.ALERT_FULL).toBeUndefined()
      })

      it('still clears a recent alert that a later claim answers', () => {
        // The two rules combine with OR on clearing: freshness does not
        // override recovery.
        const r = scan(
          [
            '2026-09-20 10:00:00 WARN  Failed to fetch issues from Linear',
            '2026-09-20 10:01:00 INFO  Selected: HON-706 — a later claim proves recovery',
          ],
          '',
          '2026-09-20 10:02:00',
        )

        expect(r.ALERT).toBeUndefined()
      })

      it('applies no age limit when no clock is passed', () => {
        const r = scan(BLIP, '', '')

        expect(r.ALERT).toBe('Failed to fetch issues from Linear')
      })

      it('stretches the limit to three polls on a slower orchestrator', () => {
        // A persisting condition is re-logged once per poll, so with
        // `--poll-interval 300` a live Linear outage repeats every five minutes
        // or more. A fixed five-minute limit would blank it between polls.
        const lines = ['2026-09-20 10:00:00 WARN  Failed to fetch issues from Linear']

        expect(scan(lines, '', '2026-09-20 10:12:00', '300').ALERT).toBe(
          'Failed to fetch issues from Linear',
        )
        expect(scan(lines, '', '2026-09-20 10:16:00', '300').ALERT).toBeUndefined()
        // Never shorter than five minutes, and a value that is not a number of
        // seconds falls back to the 60s default rather than breaking the scan.
        expect(scan(lines, '', '2026-09-20 10:04:00', '30').ALERT).toBe(
          'Failed to fetch issues from Linear',
        )
        expect(scan(lines, '', '2026-09-20 10:06:00', '1m').ALERT).toBeUndefined()
      })

      it('measures the five minutes across midnight', () => {
        // The cutoff is computed in epoch seconds, not by string arithmetic on
        // HH:MM, so a WARN just before midnight ages out on the next day.
        const lines = ['2026-09-20 23:58:00 WARN  Pausing: low disk space']

        expect(scan(lines, '', '2026-09-21 00:02:00').ALERT).toBe('Pausing: low disk space')
        expect(scan(lines, '', '2026-09-21 00:04:00').ALERT).toBeUndefined()
      })
    })

    // Logged once, so the five-minute age-out would drop it before anyone
    // looked, and no later claim recovers the commits (HON-1095).
    describe('holds a [LOST-BRANCH] warning for the whole run', () => {
      const LOST =
        '[LOST-BRANCH] HON-702 henri/hon-702-x: 2 commit(s) and no merged PR, but the branch is gone locally and on origin'
      const LINES = [
        `2026-09-20 10:00:00 WARN  ${LOST}`,
        '2026-09-20 10:30:00 INFO  Selected: HON-706 — a later claim',
        '2026-09-20 10:40:00 INFO  [OUTCOME] HON-706 SUCCESS 9m0s 1-commits phase=done',
      ]

      it('shows it as the alert in both slot states, past the age-out and a later claim', () => {
        const r = scan(LINES, '', '2026-09-20 12:00:00')

        expect(r.ALERT).toBe(LOST)
        expect(r.ALERT_AT).toBe('10:00')
        expect(r.ALERT_FULL).toBe(LOST)
        expect(r.ALERT_FULL_AT).toBe('10:00')
      })

      it('yields the line to a live operational alert', () => {
        const r = scan(
          [...LINES, '2026-09-20 11:58:00 WARN  Failed to fetch issues from Linear'],
          '',
          '2026-09-20 12:00:00',
        )

        expect(r.ALERT).toBe('Failed to fetch issues from Linear')
        // The Linear blocker only explains a free slot, so a full orchestrator
        // still shows the lost branch.
        expect(r.ALERT_FULL).toBe(LOST)
      })

      it('belongs to the run that logged it', () => {
        const r = scan(LINES, '2026-09-20 10:15:00', '2026-09-20 12:00:00')

        expect(r.ALERT).toBeUndefined()
        expect(r.ALERT_FULL).toBeUndefined()
      })
    })

    describe('tracks which stranded and gated outcomes are still open (HON-938)', () => {
      /** STRANDED_OPEN repeats, so `scan`'s object would keep only the last one. */
      const strandedOpen = (lines: string[]): string[] => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-scan-'))
        const log = path.join(dir, 'orchestrator.log')
        fs.writeFileSync(log, `${lines.join('\n')}\n`)
        try {
          return runHarness('watch-scan-log', log, '')
            .split('\n')
            .filter((l) => l.startsWith('STRANDED_OPEN='))
            .map((l) => l.slice('STRANDED_OPEN='.length))
        } finally {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }

      const GATED =
        '2026-09-20 10:30:00 WARN  [OUTCOME] HON-703 GATED 6m1s 0-commits phase=planning'
      const STRANDED = [
        '2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 3h0m 16-commits phase=pr-review pr=#707 ci=green exit=timeout',
        '2026-09-20 10:20:00 WARN  Preserved worktree and branch for HON-702 — resume with: wt resume auto/hon-702-thing (release with: wt cleanup auto/hon-702-thing)',
      ]

      it('counts a gated outcome the operator ungated as resolved', () => {
        const r = scan([
          GATED,
          '2026-09-20 10:45:00 INFO  [UNGATE] HON-703 — Gated label removed by operator; eligible again',
        ])

        expect(r.TALLY_GATED).toBe('1')
        expect(r.TALLY_GATED_OPEN).toBe('0')
      })

      it('counts a gated outcome as resolved once the issue leaves Queued (HON-940)', () => {
        const r = scan([GATED, '2026-09-20 10:45:00 INFO  [UNGATE] HON-703 — left Queued'])

        expect(r.TALLY_GATED).toBe('1')
        expect(r.TALLY_GATED_OPEN).toBe('0')
      })

      it('counts a gated outcome as resolved once the issue is claimed or finishes again', () => {
        const claimed = scan([GATED, '2026-09-20 10:45:00 INFO  Claimed HON-703 → In Progress'])
        const rerun = scan([
          GATED,
          '2026-09-20 11:30:00 INFO  [OUTCOME] HON-703 SUCCESS 45m0s 3-commits phase=done',
        ])

        expect(claimed.TALLY_GATED_OPEN).toBe('0')
        expect(rerun.TALLY_GATED).toBe('1')
        expect(rerun.TALLY_GATED_OPEN).toBe('0')
      })

      it('keeps a gated outcome open when only other issues move after it', () => {
        const r = scan([
          GATED,
          '2026-09-20 10:45:00 INFO  [UNGATE] HON-799 — Gated label removed by operator; eligible again',
          '2026-09-20 10:46:00 INFO  Claimed HON-705 → In Progress',
          '2026-09-20 11:30:00 INFO  [OUTCOME] HON-705 SUCCESS 45m0s 3-commits phase=done',
        ])

        expect(r.TALLY_GATED).toBe('1')
        expect(r.TALLY_GATED_OPEN).toBe('1')
      })

      it('counts a gated outcome open again when the re-run is gated too', () => {
        // The tally is the run's history (two gates); only the second is open.
        const r = scan([
          GATED,
          '2026-09-20 10:45:00 INFO  Claimed HON-703 → In Progress',
          '2026-09-20 10:55:00 WARN  [OUTCOME] HON-703 GATED 9m0s 0-commits phase=planning',
        ])

        expect(r.TALLY_GATED).toBe('2')
        expect(r.TALLY_GATED_OPEN).toBe('1')
      })

      it('hands an unanswered stranded outcome to the caller with its PR and branch', () => {
        expect(strandedOpen(STRANDED)).toEqual(['HON-702:707:auto/hon-702-thing'])
      })

      it('reports a stranded outcome with no PR as `none`, so the PR check is skipped', () => {
        expect(
          strandedOpen([
            '2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 3h0m 16-commits phase=pr-review pr=none ci=unknown exit=clean',
          ]),
        ).toEqual(['HON-702:none:'])
      })

      // HON-1064 added exit=error. watch_scan_log reads the verdict and pr=#N
      // only, so every exit reason must land in the same tally and open list.
      it.each(['clean', 'timeout', 'error'])(
        'reads a STRANDED line with exit=%s the same way',
        (exit) => {
          const line = `2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 47m42s 2-commits phase=pr-review pr=#707 ci=failing exit=${exit}`

          expect(scan([line]).TALLY_STRANDED).toBe('1')
          expect(strandedOpen([line, ...STRANDED.slice(1)])).toEqual([
            'HON-702:707:auto/hon-702-thing',
          ])
        },
      )

      it('drops a stranded outcome the issue was re-run past, and keeps the other', () => {
        const open = strandedOpen([
          ...STRANDED,
          '2026-09-20 10:25:00 WARN  [OUTCOME] HON-710 STRANDED 1h0m 4-commits phase=ci pr=#712 ci=failing exit=clean',
          '2026-09-20 10:25:00 WARN  Preserved worktree and branch for HON-710 — resume with: wt resume auto/hon-710-other (release with: wt cleanup auto/hon-710-other)',
          '2026-09-20 11:00:00 INFO  Claimed HON-702 → In Progress',
          '2026-09-20 12:00:00 INFO  [OUTCOME] HON-702 SUCCESS 1h0m 1-commits phase=done',
        ])

        expect(open).toEqual(['HON-710:712:auto/hon-710-other'])
      })

      it('emits one line for an issue stranded twice — the latest', () => {
        const open = strandedOpen([
          ...STRANDED,
          '2026-09-20 12:00:00 WARN  [OUTCOME] HON-702 STRANDED 1h0m 2-commits phase=ci pr=#720 ci=failing exit=clean',
          '2026-09-20 12:00:00 WARN  Preserved worktree and branch for HON-702 — resume with: wt resume auto/hon-702-thing (release with: wt cleanup auto/hon-702-thing)',
        ])

        expect(open).toEqual(['HON-702:720:auto/hon-702-thing'])
      })

      it('drops a stranded outcome once the issue is claimed again', () => {
        // The picker never claims a Stranded-labelled issue, so a claim means the
        // operator cleared the strand. The re-run recreates the preserved
        // worktree on the same branch, so the worktree check alone would turn
        // the strand yellow again for the whole re-run.
        expect(
          strandedOpen([...STRANDED, '2026-09-20 11:00:00 INFO  Claimed HON-702 → In Progress']),
        ).toEqual([])
      })

      // HON-1065: a first strand is respawned for one automatic finish attempt.
      // It is still a strand for the tally, but the operator has nothing to do
      // until the finish worker logs its own outcome.
      it('tallies a triage=FINISH strand but does not hand it to the operator', () => {
        const finish =
          '2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 3h0m 16-commits phase=pr-review pr=#707 ci=green exit=clean triage=FINISH'

        expect(scan([finish]).TALLY_STRANDED).toBe('1')
        expect(strandedOpen([finish])).toEqual([])
      })

      it('opens the second strand that follows a finish attempt', () => {
        const open = strandedOpen([
          '2026-09-20 10:20:00 WARN  [OUTCOME] HON-702 STRANDED 3h0m 16-commits phase=pr-review pr=#707 ci=green exit=clean triage=FINISH',
          ...STRANDED.map((l) => l.replace('10:20:00', '11:20:00')),
        ])

        expect(open).toEqual(['HON-702:707:auto/hon-702-thing'])
      })

      it('lets a finish attempt answer an earlier open strand of the same issue', () => {
        expect(
          strandedOpen([
            ...STRANDED,
            '2026-09-20 11:20:00 WARN  [OUTCOME] HON-702 STRANDED 1h0m 16-commits phase=pr-review pr=#707 ci=green exit=clean triage=FINISH',
          ]),
        ).toEqual([])
      })

      it('does not let an [UNGATE] answer a stranded outcome', () => {
        expect(
          strandedOpen([
            ...STRANDED,
            '2026-09-20 11:00:00 INFO  [UNGATE] HON-702 — Gated label removed by operator; eligible again',
          ]),
        ).toEqual(['HON-702:707:auto/hon-702-thing'])
      })
    })

    it('answers with zeroes rather than failing on a log that does not exist', () => {
      // The dashboard renders on a timer from the first tick, which can precede
      // the orchestrator's first log write.
      const out = runHarness(
        'watch-scan-log',
        path.join(os.tmpdir(), 'no-such-orchestrator.log'),
        '',
      )

      expect(out).toBe('')
    })
  })

  describe('wt watch terminal size (watch_term_size)', () => {
    const size = (env: Record<string, string>): [number, number] => {
      const out = runHarnessEnv(env, 'watch-term-size')
      const [lines, cols] = out.trim().split(' ').map(Number)
      return [lines ?? -1, cols ?? -1]
    }

    it('honours the size the caller declares when there is no terminal to ask', () => {
      // The harness stubs `stty` to fail, so this is the fallback path however
      // the suite is run: from an interactive shell the real one reaches the
      // developer's window through /dev/tty and answers with that instead.
      expect(size({ LINES: '17', COLUMNS: '90' })).toEqual([17, 90])
    })

    it('always answers with two usable numbers', () => {
      // cmd_watch does arithmetic on both immediately; an empty or non-numeric
      // answer is a shell error printed over the freshly cleared dashboard.
      const envs: Record<string, string>[] = [
        {},
        { LINES: 'abc', COLUMNS: '' },
        { LINES: '0', COLUMNS: '0' },
      ]
      for (const env of envs) {
        const [lines, cols] = size(env)

        expect(lines).toBeGreaterThan(0)
        expect(cols).toBeGreaterThan(0)
      }
    })

    it('asks the kernel rather than tput', () => {
      // macOS tput reports the terminfo entry's static 24x80 and consults only
      // $LINES/$COLUMNS — it never asks the terminal. A 17-row tmux pane read
      // as 24 rows, and every height decision below was made against a terminal
      // that was not there. Verified by hand in real tmux panes at 12-40 rows
      // and 80/100/130 columns; only `stty size` tracked them.
      const body = shellFunctionBody(fs.readFileSync(worktreeClaude, 'utf8'), 'watch_term_size')

      expect(body).toContain('stty size')
      expect(body.indexOf('stty size')).toBeLessThan(body.indexOf('tput lines'))
    })
  })

  describe('wt watch height budget (watch_height_budget)', () => {
    /** The real helper. Returns [landed rows, log lines per worker]. */
    const budget = (
      lines: number,
      workers: number,
      landedAvailable = 6,
      hasAlert = 0,
    ): [number, number] => {
      const out = runHarness(
        'watch-height-budget',
        String(lines),
        String(workers),
        String(landedAvailable),
        String(hasAlert),
      ).trim()
      const [landed, per] = out.split(' ').map(Number)
      return [landed ?? -1, per ?? -1]
    }

    /**
     * The lines cmd_watch prints for a given budget, counted the same way the
     * render loop builds them: pane heading + 3 rows (+ alert), blank, table
     * heading, one row per worker, blank, the landed pane with its heading and
     * trailing blank, one separator per worker, the tails, and the newline
     * `echo -e` appends — and one more for the row the cursor lands on, since
     * `buf` already ends in a newline so the last line is followed by a blank
     * one. This is the invariant the budget exists to hold, so the tests assert
     * against it rather than against the arithmetic twice. Verified against a
     * real 6-row tmux pane: five lines of content already scroll the first away.
     */
    const rendered = (workers: number, landed: number, per: number, hasAlert = 0) => {
      let n = 4 + hasAlert + 1 + 2
      if (workers > 0) n += 1 + workers + 1
      else n += 1 + 1
      if (landed > 0) n += landed + (workers > 0 ? 2 : 1)
      if (workers > 0 && per > 0) n += workers + workers * per
      return n
    }

    it('leaves an 80-line terminal exactly as it was', () => {
      // The full landed pane and the 14-line tail cap: the rework's own layout,
      // which this issue must not change on a terminal that fits it.
      expect(budget(80, 3)).toEqual([6, 14])
    })

    it('shortens the tails before it touches the landed pane', () => {
      // Six landed rows cost six lines; a 14-line tail costs fourteen per
      // worker. So the surplus above the 2-line tail floor is offered to the
      // pane first and the tails are what shrink on the way down — what merged
      // an hour ago is worth more screen than a worker's eighth-oldest log line.
      expect(budget(65, 3)).toEqual([6, 14])
      expect(budget(64, 3)).toEqual([6, 13])
      expect(budget(29, 3)).toEqual([6, 2])
    })

    it('trims the landed pane only once the tails are at their floor', () => {
      // 29 lines is the last height at which all six landed rows and the 2-line
      // tail floor both fit. One line less has to come out of the pane.
      expect(budget(29, 3)).toEqual([6, 2])
      expect(budget(28, 3)).toEqual([5, 2])
      expect(budget(27, 3)).toEqual([4, 2])
    })

    it('keeps the summary and the worker table on a 24-line terminal', () => {
      // The reported case: a 20-24 line tmux pane, three workers. Before this,
      // the landed pane was fixed at six rows and the overflow scrolled the
      // ORCHESTRATOR and THIS RUN panes off the top — losing exactly what the
      // rework was built to add.
      const [landed, per] = budget(24, 3)

      expect(per).toBeGreaterThanOrEqual(2)
      expect(rendered(3, landed, per)).toBeLessThanOrEqual(24)
    })

    it('drops the landed pane whole rather than leaving a heading over nothing', () => {
      expect(budget(23, 3)[0]).toBe(0)
      expect(budget(21, 3)).toEqual([0, 2])
    })

    it('shortens the tails to one line before dropping them', () => {
      expect(budget(19, 3)).toEqual([0, 1])
    })

    it('drops the activity section whole once a single line will not fit', () => {
      // 0 tells cmd_watch to skip the separators too: a separator with no tail
      // under it is a heading for nothing.
      expect(budget(17, 3)[1]).toBe(0)
      expect(budget(14, 3)).toEqual([0, 0])
    })

    it('gives the landed pane the room the dropped tails were holding', () => {
      // The pane is sized around a reservation for the separators and the
      // 2-line tail floor. When that reservation is never spent the room has to
      // go back, or a 16-line terminal renders 11 lines and five blank ones
      // with the pane suppressed for space nothing is using.
      expect(budget(17, 3)).toEqual([3, 0])
      expect(budget(15, 3)).toEqual([1, 0])
      expect(rendered(3, 3, 0)).toBe(17)
      expect(rendered(3, 1, 0)).toBe(15)
    })

    it.each([
      ['null', '3'],
      ['40', 'null'],
      ['', ''],
      ['not-a-number', '3'],
    ])('treats a non-numeric %j lines / %j workers as zero', (lines, workers) => {
      // The worker count comes straight out of jq over the status file, and the
      // helper does not rely on watch_term_size to have cleaned term_lines. An
      // unguarded `[` would print
      // "integer expression expected" straight over the freshly cleared
      // dashboard — stderr is not redirected in the render loop.
      const out = runHarness('watch-height-budget', lines, workers, '6', '0')

      expect(out).not.toMatch(/integer expression/)
      expect(out.trim()).toMatch(/^\d+ \d+$/)
    })

    it.each([
      [80, 3, 6, 0],
      [65, 3, 6, 0],
      [64, 3, 6, 0],
      [40, 3, 6, 0],
      [29, 3, 6, 0],
      [28, 3, 6, 0],
      [24, 3, 6, 0],
      [24, 3, 6, 1],
      [23, 3, 6, 0],
      [21, 3, 6, 0],
      [19, 3, 6, 0],
      [17, 3, 6, 0],
      [15, 3, 6, 0],
      [14, 3, 6, 0],
      [12, 3, 6, 0],
      [11, 3, 6, 0],
      [24, 1, 6, 0],
      [24, 5, 6, 0],
      [30, 0, 6, 0],
      [12, 0, 6, 0],
      [24, 3, 0, 0],
    ])(
      'never overruns a %i-line terminal with %i workers (%i landed, alert=%i)',
      (lines, workers, landedAvailable, hasAlert) => {
        const [landed, per] = budget(lines, workers, landedAvailable, hasAlert)
        const total = rendered(workers, landed, per, hasAlert)

        // The one exception is a terminal too short for the mandatory chrome
        // alone, where there is nothing left to give up. Everything else fits.
        const mandatory = rendered(workers, 0, 0, hasAlert)
        if (mandatory <= lines) expect(total).toBeLessThanOrEqual(lines)
        else expect(total).toBe(mandatory)
      },
    )

    it('budgets the placeholder line an empty landed cache still prints', () => {
      // With nothing fetched yet the pane renders "(fetching merged PRs…)",
      // which costs a row whether or not any PR has landed.
      expect(budget(80, 3, 0)).toEqual([1, 14])
    })

    it('trims the landed pane on an idle orchestrator too', () => {
      // No workers means no table and no tails, but the pane is still the first
      // thing that gives — the summary above it is the point of the screen.
      expect(budget(30, 0)).toEqual([6, 0])
      expect(budget(13, 0)).toEqual([3, 0])
      expect(budget(11, 0)).toEqual([1, 0])
      expect(budget(10, 0)).toEqual([0, 0])
    })

    it('counts the alert line against the budget', () => {
      // It is printed above everything the budget can trim, so it has to be
      // paid for out of the same total.
      const [withoutAlert] = budget(27, 3, 6, 0)
      const [withAlert] = budget(27, 3, 6, 1)

      expect(withAlert).toBe(withoutAlert - 1)
    })
  })

  describe('wt watch alert channel by slot state (watch_pick_alert)', () => {
    /** The real helper, plus the same split cmd_watch does. Returns [message, at]. */
    const pick = (
      workers: number | string,
      max: number | string,
      alert: string,
      at: string,
      full = '',
      fullAt = '',
    ): [string, string] => {
      const out = runHarness(
        'watch-pick-alert',
        String(workers),
        String(max),
        alert,
        at,
        full,
        fullAt,
      ).trim()
      const m = /^\[([\s\S]*)\]\[([\s\S]*)\]$/.exec(out)
      if (!m) throw new Error(`unparseable harness output: ${out}`)
      return [m[1] ?? '', m[2] ?? '']
    }

    const LINEAR = 'Failed to fetch issues from Linear'
    const DISK = 'Low disk space: 0GB free (< 1GB threshold)'

    it('shows a slot-only blocker while a slot is free', () => {
      expect(pick(2, 3, LINEAR, '10:06')).toEqual([LINEAR, '10:06'])
    })

    it('drops a slot-only blocker once every slot is busy', () => {
      // Nothing can clear it either: a full orchestrator claims nothing and
      // logs no outcome until a worker finishes, so the recovery rule never
      // fires and the line would stand for the whole run.
      expect(pick(3, 3, LINEAR, '10:06')).toEqual(['', ''])
    })

    it('keeps a blocker that bites the running workers too', () => {
      expect(pick(3, 3, DISK, '10:06', DISK, '10:06')).toEqual([DISK, '10:06'])
    })

    it('falls back to the full-orchestrator alert rather than showing nothing', () => {
      // ALERT is the newer Linear failure, but with no free slot the older disk
      // warning is the one that still applies.
      expect(pick(3, 3, LINEAR, '10:06', DISK, '09:00')).toEqual([DISK, '09:00'])
    })

    it('leaves an empty alert empty instead of promoting the timestamp', () => {
      // The pair is printed time-first and split on the first tab precisely
      // because `IFS=$'\t' read` collapses adjacent tabs: with the fields the
      // other way round, an empty message would render the clock AS the alert.
      expect(pick(3, 3, LINEAR, '10:06', '', '')).toEqual(['', ''])
    })

    it('leaves the alert alone when the worker counts are not numbers', () => {
      // Both come out of jq over orchestrator-status.json. A malformed status
      // file must not silently suppress the one line explaining the trouble —
      // and an unguarded `[ -ge ]` on a non-number is a shell error, not a
      // false comparison.
      expect(pick('null', 'null', LINEAR, '10:06')).toEqual([LINEAR, '10:06'])
      expect(pick('', '', LINEAR, '10:06')).toEqual([LINEAR, '10:06'])
      // max_workers of 0 is not "every slot is full", it is a broken read.
      expect(pick(0, 0, LINEAR, '10:06')).toEqual([LINEAR, '10:06'])
    })
  })

  describe('wt watch stranded resolution (watch_resolve_stranded, HON-938)', () => {
    let base = ''
    beforeAll(() => {
      base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-resolve-'))
    })
    afterAll(() => {
      fs.rmSync(base, { recursive: true, force: true })
    })

    const resolve = (lines: string[], resolvedPrs = ''): number =>
      Number(runHarness('watch-resolve-stranded', lines.join('\n'), base, resolvedPrs).trim())

    /** The worktree `wt cleanup` would remove, at the path cmd_cleanup derives. */
    const withWorktree = (branch: string) =>
      fs.mkdirSync(path.join(base, branch.replaceAll('/', '--')), { recursive: true })

    const LINE = 'HON-702:707:auto/hon-702-thing'

    it('resolves a stranded outcome whose PR has merged or closed', () => {
      withWorktree('auto/hon-702-thing')

      expect(resolve([LINE], '700\n707\n712')).toBe(0)
    })

    it('keeps it open while the PR is open and the worktree is still there', () => {
      withWorktree('auto/hon-702-thing')

      expect(resolve([LINE], '')).toBe(1)
      // A whole-number match: 70 and 7070 are other PRs.
      expect(resolve([LINE], '70 7070')).toBe(1)
    })

    it('resolves it once the operator has released the worktree', () => {
      expect(resolve(['HON-703:708:auto/hon-703-gone'], '')).toBe(0)
    })

    it('skips the PR check for a run that opened no PR', () => {
      withWorktree('auto/hon-704-nopr')

      expect(resolve(['HON-704:none:auto/hon-704-nopr'], 'none')).toBe(1)
      expect(resolve(['HON-705:none:auto/hon-705-gone'], '')).toBe(0)
    })

    it('counts only the open ones, and nothing for no lines', () => {
      withWorktree('auto/hon-702-thing')

      expect(resolve([LINE, 'HON-703:708:auto/hon-703-gone'], '')).toBe(1)
      expect(resolve([], '')).toBe(0)
    })
  })

  describe('wt watch merged and closed stranded PRs (watch_stranded_resolved_prs, HON-938)', () => {
    let dir = ''
    let base = ''
    let cacheDir = ''
    let landed = ''
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-resolved-prs-'))
      base = path.join(dir, 'worktrees')
      fs.mkdirSync(path.join(base, 'auto--hon-702-thing'), { recursive: true })
    })
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    beforeEach(() => {
      // Fresh caches per test: a state cache left by one test would answer the next.
      cacheDir = fs.mkdtempSync(path.join(dir, 'cache-'))
      landed = path.join(cacheDir, 'landed')
    })

    const LINE = 'HON-702:707:auto/hon-702-thing'

    const resolved = (lines: string[], prView = ''): string[] =>
      runHarness('watch-stranded-resolved-prs', lines.join('\n'), base, landed, cacheDir, prView)
        .split('\n')
        .filter(Boolean)

    it('takes the merged numbers from the landed cache', () => {
      fs.writeFileSync(
        landed,
        '707\tHON-702\tA title\t2026-10-02T07:22:00Z\n800\t-\tOther\t2026-10-02T07:00:00Z\n',
      )

      expect(resolved([LINE])).toEqual(['707', '800'])
    })

    it.each(['MERGED', 'CLOSED'])('adds a PR its own state cache reports as %s', (state) => {
      // Merged before the landed pane's six rows, or closed without merging:
      // neither is in the landed cache, so the per-PR lookup is what finds it.
      fs.writeFileSync(path.join(cacheDir, 'pr-state-707'), `${state}\n`)

      expect(resolved([LINE])).toEqual(['707'])
    })

    it('leaves a PR its state cache reports as OPEN out', () => {
      fs.writeFileSync(path.join(cacheDir, 'pr-state-707'), 'OPEN\n')

      expect(resolved([LINE])).toEqual([])
    })

    it('fills a cold state cache from gh in the background, for the next redraw', async () => {
      // The first redraw cannot know yet — the probe never blocks the render.
      expect(resolved([LINE], JSON.stringify({ state: 'CLOSED' }))).toEqual([])

      const cache = path.join(cacheDir, 'pr-state-707')
      for (let i = 0; i < 50 && !fs.existsSync(cache); i++) {
        await new Promise((r) => setTimeout(r, 100))
      }

      expect(fs.readFileSync(cache, 'utf8').trim()).toBe('CLOSED')
      expect(resolved([LINE])).toEqual(['707'])
    })

    it('asks gh nothing for a released worktree or a run with no PR', () => {
      // watch_resolve_stranded already settles a missing worktree, and `none`
      // has no number to ask about.
      resolved(
        ['HON-703:708:auto/hon-703-gone', 'HON-704:none:auto/hon-702-thing'],
        JSON.stringify({ state: 'MERGED' }),
      )

      expect(fs.readdirSync(cacheDir).filter((f) => f.startsWith('pr-state-'))).toEqual([])
    })
  })

  describe('wt watch tally row (watch_tally_row, HON-938)', () => {
    const YELLOW = '\\033[0;33m'
    const DIM = '\\033[2m'
    const NC = '\\033[0m'

    /** [decorated, plain], read back the way cmd_watch reads them. */
    const row = (...counts: (number | string)[]): [string, string] => {
      const out = runHarness('watch-tally-row', ...counts.map(String))
        .trimEnd()
        .split('\n')
      const strip = (l = '') => l.replace(/^\[/, '').replace(/\]$/, '')
      return [strip(out[0]), strip(out[1])]
    }

    it('shows a resolved stranded outcome dim, with the run total', () => {
      const [line, plain] = row(43, 0, 1, 0, 0, 0, 0, 0)

      expect(line).toContain(`${DIM}1 stranded (resolved)${NC}`)
      expect(line).not.toContain(YELLOW)
      expect(plain).toBe('43 merged · 0 failed · 1 stranded (resolved)')
    })

    it('shows an open stranded outcome yellow, with the open count', () => {
      const [line, plain] = row(43, 0, 2, 1, 0, 0, 0, 0)

      expect(line).toContain(`${YELLOW}1 stranded${NC}`)
      expect(plain).toBe('43 merged · 0 failed · 1 stranded')
    })

    it('treats gated the same way, and still omits it when there was none', () => {
      expect(row(43, 0, 0, 0, 1, 0, 0, 0)[0]).toContain(`${DIM}1 gated (resolved)${NC}`)
      expect(row(43, 0, 0, 0, 1, 1, 0, 0)[0]).toContain(`${YELLOW}1 gated${NC}`)
      expect(row(43, 0, 0, 0, 0, 0, 0, 0)[1]).toBe('43 merged · 0 failed · 0 stranded')
    })

    it('leaves timeout and failed alone', () => {
      const [line, plain] = row(1, 2, 0, 0, 0, 0, 3, 1)

      expect(line).toContain(`${YELLOW}3 timeout${NC}`)
      expect(plain).toBe('1 merged · 2 failed · 0 stranded · 3 timeout (floor: log rotated)')
    })

    it('measures exactly the text it shows', () => {
      // The plain twin is what the pane clips against, so the two must match
      // character for character once the escapes are gone.
      for (const counts of [
        [43, 0, 1, 0, 1, 0, 0, 0],
        [43, 1, 2, 1, 3, 2, 1, 1],
        [0, 0, 0, 0, 0, 0, 0, 0],
      ]) {
        const [line, plain] = row(...counts)
        expect(line.replace(/\\033\[[0-9;]*m/g, '')).toBe(plain)
      }
    })

    it('reads non-numeric counts as zero rather than printing a shell error', () => {
      const [line, plain] = row('', 'null', '', '', '', '', '', '')

      expect(line).not.toMatch(/integer expression/)
      expect(plain).toBe('0 merged · 0 failed · 0 stranded')
    })

    it('drops "(resolved)" before the row outgrows its pane, so the colour survives', () => {
      // A row wider than the pane is drawn as its clipped plain twin, with no
      // colour. pane_r is 49 on a 100-column terminal: the mixed state with
      // "(resolved)" is 54 wide and would lose the open strand's yellow.
      const [line, plain] = row(43, 0, 1, 1, 1, 0, 0, 0, 49)

      expect(plain).toBe('43 merged · 0 failed · 1 stranded · 1 gated')
      expect(line).toContain(`${YELLOW}1 stranded${NC}`)
      expect(line).toContain(`${DIM}1 gated${NC}`)
    })

    it('keeps "(resolved)" whenever the row fits', () => {
      expect(row(43, 0, 1, 0, 1, 0, 0, 0, 80)[1]).toBe(
        '43 merged · 0 failed · 1 stranded (resolved) · 1 gated (resolved)',
      )
      // Exactly at the width is a fit, not an overflow.
      expect(row(43, 0, 1, 0, 0, 0, 0, 0, 44)[1]).toBe(
        '43 merged · 0 failed · 1 stranded (resolved)',
      )
    })
  })

  describe('wt watch tallies for the 2026-10-02 log (HON-938)', () => {
    // The reported shape: HON-902 gated, ungated by the operator, re-claimed
    // and merged; HON-924 stranded, merged by hand, worktree removed. Both
    // were resolved, and both still rendered yellow.
    const LOG = [
      '2026-10-01 16:04:00 WARN  [OUTCOME] HON-902 GATED 7m0s 0-commits phase=planning',
      '2026-10-01 18:43:00 INFO  [UNGATE] HON-902 — Gated label removed by operator; eligible again',
      '2026-10-01 18:43:00 INFO  Claimed HON-902 → In Progress',
      '2026-10-01 20:16:00 INFO  [OUTCOME] HON-902 SUCCESS 1h33m 4-commits phase=done',
      '2026-10-02 03:37:00 WARN  [OUTCOME] HON-924 STRANDED 2h0m 6-commits phase=ci pr=#1018 ci=failing exit=clean',
      '2026-10-02 03:37:00 WARN  Preserved worktree and branch for HON-924 — resume with: wt resume henri/hon-924-rename (release with: wt cleanup henri/hon-924-rename)',
    ]

    let dir = ''
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-1002-'))
    })
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    /** Scan → resolve → render, as cmd_watch chains them. Returns [decorated, plain]. */
    const render = (lines: string[], resolvedPrs = ''): [string, string] => {
      const log = path.join(dir, 'orchestrator.log')
      fs.writeFileSync(log, `${lines.join('\n')}\n`)
      const out = runHarness('watch-scan-log', log, '').split('\n').filter(Boolean)
      const get = (k: string) => out.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? '0'
      const stranded = out
        .filter((l) => l.startsWith('STRANDED_OPEN='))
        .map((l) => l.slice('STRANDED_OPEN='.length))
      const strandedOpen = runHarness(
        'watch-resolve-stranded',
        stranded.join('\n'),
        path.join(dir, 'worktrees'),
        resolvedPrs,
      ).trim()
      const rendered = runHarness(
        'watch-tally-row',
        get('TALLY_SUCCESS'),
        get('TALLY_FAILED'),
        get('TALLY_STRANDED'),
        strandedOpen,
        get('TALLY_GATED'),
        get('TALLY_GATED_OPEN'),
        get('TALLY_TIMEOUT'),
        get('TALLY_TRUNCATED'),
      )
        .trimEnd()
        .split('\n')
        .map((l) => l.replace(/^\[/, '').replace(/\]$/, ''))
      return [rendered[0] ?? '', rendered[1] ?? '']
    }

    it('shows both as resolved, dim, once they were answered', () => {
      const [line, plain] = render(LOG)

      expect(plain).toBe('1 merged · 0 failed · 1 stranded (resolved) · 1 gated (resolved)')
      expect(line).not.toContain('\\033[0;33m')
    })

    it('turns gated yellow for a fresh gate and dim again once it is ungated', () => {
      const gated = [
        ...LOG,
        '2026-10-02 09:00:00 WARN  [OUTCOME] HON-999 GATED 5m0s 0-commits phase=planning',
      ]
      const ungated = [
        ...gated,
        '2026-10-02 09:10:00 INFO  [UNGATE] HON-999 — Gated label removed by operator; eligible again',
      ]

      expect(render(gated)[0]).toContain('\\033[0;33m1 gated\\033[0m')
      expect(render(ungated)[1]).toContain('2 gated (resolved)')
    })

    it('keeps a stranded outcome yellow while its PR is open and its worktree exists', () => {
      fs.mkdirSync(path.join(dir, 'worktrees', 'henri--hon-924-rename'), { recursive: true })
      try {
        expect(render(LOG)[0]).toContain('\\033[0;33m1 stranded\\033[0m')
        expect(render(LOG, '1018')[1]).toContain('1 stranded (resolved)')
      } finally {
        fs.rmSync(path.join(dir, 'worktrees'), { recursive: true, force: true })
      }
    })
  })

  describe('wt watch column widths', () => {
    // These exist because bash printf pads `%-8s` by BYTES while `${#s}` counts
    // CHARACTERS: `printf '%-6s' 'ab…'` yields four visible columns, not six, so
    // one clipped title or one ↻ used to skew every column to its right.
    const pad = (s: string, w: number) => {
      const out = runHarness('watch-pad', s, String(w)).trim()
      return out.slice(1, -1)
    }
    const clip = (s: string, w: number) => {
      const out = runHarness('watch-clip', s, String(w)).trim()
      return out.slice(1, -1)
    }

    it.each([
      ['ab', 6],
      ['abcdef', 6],
      ['abcdefghij', 6],
      ['HON-706↻', 8],
      ['HON-706↻', 12],
      ['…', 4],
    ])('pads %j to exactly %i visible characters', (input, width) => {
      expect([...pad(input, width)]).toHaveLength(width)
    })

    it('marks a truncated string with an ellipsis inside the budget', () => {
      expect(clip('abcdefghij', 6)).toBe('abcde…')
      expect([...clip('abcdefghij', 6)]).toHaveLength(6)
    })

    it('leaves a string that already fits untouched', () => {
      expect(clip('abcdef', 6)).toBe('abcdef')
      expect(clip('abc', 6)).toBe('abc')
    })

    it('hard-cuts rather than spending the whole budget on an ellipsis', () => {
      expect(clip('abcdef', 1)).toBe('a')
    })

    it('counts a multi-byte glyph as one column', () => {
      // The specific failure: '…' is three bytes, so printf under-pads by two.
      expect([...pad('ab…', 6)]).toHaveLength(6)
      expect(pad('ab…', 6)).toBe('ab…   ')
    })
  })
  describe('wt watch PR + CI probe (watch_pr_probe)', () => {
    type Check = { bucket: string; workflow: string }
    const probe = (
      prs: unknown,
      checks: Check[] = [],
      checksExit = 0,
    ): { state: string; number: string; ci: string } => {
      const out = runHarness(
        'watch-pr-probe',
        JSON.stringify(prs),
        JSON.stringify(checks),
        String(checksExit),
      ).trim()
      const fields = out.split('\t')
      return { state: fields[0] ?? '', number: fields[1] ?? '', ci: fields[2] ?? '' }
    }
    const OPEN = [{ state: 'OPEN', number: 790 }]

    it('reports no PR for a branch that has none', () => {
      // A branch pushed but not yet PR'd is the normal mid-run state, and must
      // not read as an error.
      expect(probe([])).toEqual({ state: 'NONE', number: '-', ci: '-' })
    })

    it.each([
      [[{ bucket: 'pass', workflow: 'CI' }], 'green'],
      [
        [
          { bucket: 'pass', workflow: 'CI' },
          { bucket: 'skipping', workflow: 'E2E' },
        ],
        'green',
      ],
      [
        [
          { bucket: 'pending', workflow: 'CI' },
          { bucket: 'pass', workflow: 'Lint' },
        ],
        'pending',
      ],
      [
        [
          { bucket: 'fail', workflow: 'CI' },
          { bucket: 'pass', workflow: 'Lint' },
        ],
        'failing',
      ],
      [[{ bucket: 'cancel', workflow: 'CI' }], 'failing'],
    ])('buckets %j as %s', (checks, expected) => {
      // Same ladder as orchestrator.sh's pr_ci_state: pending wins over
      // everything, then anything outside pass|skipping is a failure.
      expect(probe(OPEN, checks as Check[]).ci).toBe(expected)
    })

    it('reads the buckets even though gh exits non-zero for pending and failing', () => {
      // The one deliberate divergence from pr_ci_state, and the whole reason this
      // mode exists: `gh pr checks` exits 8 when checks are pending and 1 when
      // they fail. Collapsing a non-zero exit to "unknown" would mislabel every
      // PR the dashboard is actually waiting on.
      expect(probe(OPEN, [{ bucket: 'pending', workflow: 'CI' }], 8).ci).toBe('pending')
      expect(probe(OPEN, [{ bucket: 'fail', workflow: 'CI' }], 1).ci).toBe('failing')
    })

    it('exempts a pending third-party status with no workflow name', () => {
      // HON-600: the Vercel commit status can sit pending after the deploy is
      // Ready, so it must not hold an otherwise-green PR at pending.
      const checks = [
        { bucket: 'pass', workflow: 'CI' },
        { bucket: 'pending', workflow: '' },
      ]

      expect(probe(OPEN, checks).ci).toBe('green')
    })

    it('still fails on a third-party status that reports failure', () => {
      // The exemption is for pending only: CI runs no `next build`, so Vercel is
      // the only build gate and a fail there is real.
      const checks = [
        { bucket: 'pass', workflow: 'CI' },
        { bucket: 'fail', workflow: '' },
      ]

      expect(probe(OPEN, checks).ci).toBe('failing')
    })

    it('reports unknown when nothing but a stuck third-party status has spoken', () => {
      expect(probe(OPEN, [{ bucket: 'pending', workflow: '' }]).ci).toBe('unknown')
      expect(probe(OPEN, []).ci).toBe('unknown')
    })

    it.each([
      ['MERGED', 'merged'],
      ['CLOSED', 'closed'],
    ])('short-circuits a %s PR to ci=%s without asking for checks', (state, expected) => {
      // Checks on a merged PR are noise, and the column wants "merged", not the
      // CI state of a run that no longer matters.
      const r = probe([{ state, number: 790 }], [{ bucket: 'fail', workflow: 'CI' }])

      expect(r.ci).toBe(expected)
      expect(r.number).toBe('790')
    })
  })

  describe('wt watch recently-landed probe (watch_landed_probe)', () => {
    const landed = (prs: unknown) =>
      runHarness('watch-landed-probe', JSON.stringify(prs))
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const f = l.split('\t')
          return { number: f[0] ?? '', id: f[1] ?? '', title: f[2] ?? '', mergedAt: f[3] ?? '' }
        })

    const PR = (number: number, title: string, branch: string, mergedAt: string) => ({
      number,
      title,
      headRefName: branch,
      mergedAt,
    })

    it('orders by merge time, which gh does not do', () => {
      // The actual observed bug: `gh pr list --state merged` returned #787
      // (merged 11:53) above #786 (merged 12:50), so the pane claimed the wrong
      // PR had landed last.
      const rows = landed([
        PR(787, 'docs: c (HON-603)', 'henri/hon-603-c', '2026-09-20T11:53:28Z'),
        PR(786, 'feat: a (HON-513)', 'henri/hon-513-a', '2026-09-20T12:50:18Z'),
        PR(785, 'fix: b (HON-682)', 'henri/hon-682-b', '2026-09-20T12:08:48Z'),
      ])

      expect(rows.map((r) => r.number)).toEqual(['786', '785', '787'])
    })

    it('strips the trailing issue id, which has its own column', () => {
      const rows = landed([
        PR(786, 'feat(i18n): Localize emails (HON-513)', 'henri/hon-513-a', '2026-09-20T12:50:18Z'),
      ])

      expect(rows[0]?.id).toBe('HON-513')
      expect(rows[0]?.title).toBe('feat(i18n): Localize emails')
    })

    it('strips only a trailing id, not one inside the subject', () => {
      const rows = landed([
        PR(
          786,
          'fix: Revert (HON-500) behaviour (HON-513)',
          'henri/hon-513-a',
          '2026-09-20T12:50:18Z',
        ),
      ])

      expect(rows[0]?.title).toBe('fix: Revert (HON-500) behaviour')
    })

    it('derives the issue id from the branch, upcased', () => {
      const rows = landed([
        PR(786, 'feat: a', 'henri/hon-513-localize-emails', '2026-09-20T12:50:18Z'),
      ])

      expect(rows[0]?.id).toBe('HON-513')
    })

    it('emits "-" for a branch carrying no id, never an empty field', () => {
      // An ad-hoc branch still belongs in the pane; it just has no id to show.
      // The placeholder is load-bearing rather than cosmetic: the consumer reads
      // these rows with IFS=$'\t', tab is IFS whitespace, and an empty field
      // would collapse and shift every later column left.
      const rows = landed([PR(786, 'chore: tidy', 'henri/no-issue-here', '2026-09-20T12:50:18Z')])

      expect(rows[0]?.id).toBe('-')
      expect(rows[0]?.title).toBe('chore: tidy')
    })

    it('does not read a version-like branch segment as an issue id', () => {
      // `chore/bump-opus-5-5` (#818) rendered as issue "OPUS-5" when any
      // letters-dash-digits run counted as an id.
      const rows = landed([
        PR(
          818,
          'chore(scripts): Bump agent Opus default',
          'chore/bump-opus-5-5',
          '2026-09-22T09:00:00Z',
        ),
        PR(817, 'fix: b', 'posthog/hon-748-size-images', '2026-09-22T08:00:00Z'),
      ])

      expect(rows.map((r) => r.id)).toEqual(['-', 'HON-748'])
    })

    it('skips a row with no merge time rather than sorting on null', () => {
      const rows = landed([
        PR(786, 'feat: a', 'henri/hon-513-a', '2026-09-20T12:50:18Z'),
        { number: 999, title: 'odd', headRefName: 'henri/hon-1-x', mergedAt: null },
      ])

      expect(rows.map((r) => r.number)).toEqual(['786'])
    })
  })

  describe('wt watch pane rule width', () => {
    const head = (label: string, width: number) =>
      runHarness('watch-pane-head', label, String(width)).trim().slice(1, -1)

    it.each([
      ['ORCHESTRATOR', 48],
      ['THIS RUN (since 11:03)', 50],
      ['RECENTLY LANDED', 98],
    ])('pads the %j rule to exactly %i visible characters', (label, width) => {
      // The panes are laid out by arithmetic on this width; a rule that overruns
      // wraps and silently adds a line the height budget has not counted.
      expect([...head(label as string, width as number)]).toHaveLength(width as number)
    })

    it('still emits the label when the width cannot fit a rule', () => {
      // Degrades rather than corrupting the layout on a very narrow terminal.
      expect(head('ORCHESTRATOR', 4)).toContain('ORCHESTRATOR')
    })
  })
  describe('wt watch landed rows survive the shell read path', () => {
    // A JS split of the TSV cannot see this class of bug at all: tab is IFS
    // *whitespace*, so bash collapses adjacent tabs and a single empty field
    // shifts every later field one to the left. These go through the same
    // `IFS=$'\t' read` the render loop uses.
    const readRows = (prs: unknown): string[][] =>
      runHarness('watch-landed-read', JSON.stringify(prs))
        .split('\n')
        .filter(Boolean)
        .map((l) => [...l.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1] ?? ''))

    const PR = (number: number, title: string, branch: string, mergedAt: string) => ({
      number,
      title,
      headRefName: branch,
      mergedAt,
    })

    it('keeps the columns aligned for a branch carrying no issue id', () => {
      // The reported bug, and the shape this very branch has: an ad-hoc
      // `henri/<slug>` branch rendered its TITLE in the id column and lost the
      // merge timestamp entirely.
      const rows = readRows([PR(786, 'chore: tidy', 'henri/no-issue-here', '2026-09-20T12:50:18Z')])

      expect(rows[0]).toEqual(['786', '-', 'chore: tidy', '2026-09-20T12:50:18Z'])
    })

    it('never emits an empty field, which is what makes the read safe', () => {
      const raw = runHarness(
        'watch-landed-probe',
        JSON.stringify([PR(786, 'chore: tidy', 'henri/no-issue-here', '2026-09-20T12:50:18Z')]),
      )

      expect(raw).not.toMatch(/\t\t/)
    })

    it('keeps the columns aligned for an ordinary issue branch', () => {
      const rows = readRows([
        PR(786, 'feat(i18n): Localize emails', 'henri/hon-513-a', '2026-09-20T12:50:18Z'),
      ])

      expect(rows[0]).toEqual([
        '786',
        'HON-513',
        'feat(i18n): Localize emails',
        '2026-09-20T12:50:18Z',
      ])
    })
  })

  describe('wt watch widths do not depend on the caller locale', () => {
    // `${#s}` counts characters only in a UTF-8 locale; under LC_ALL=C it counts
    // bytes, which turned `watch_pad "HON-706↻" 9` into `HON-706…` — silently
    // eating the retried marker. Vitest inherits the developer's UTF-8 locale,
    // so only an explicit override exercises this.
    const padIn = (locale: string, s: string, w: number) =>
      runHarnessEnv({ LC_ALL: locale }, 'watch-pad', s, String(w)).trim().slice(1, -1)

    it.each([['en_US.UTF-8'], ['C'], ['POSIX'], ['']])(
      'pads to exact visible width under LC_ALL=%j',
      (locale) => {
        expect([...padIn(locale as string, 'HON-706↻', 9)]).toHaveLength(9)
        expect([...padIn(locale as string, 'ab…', 6)]).toHaveLength(6)
      },
    )

    it('keeps the retried marker instead of clipping it under LC_ALL=C', () => {
      expect(padIn('C', 'HON-706↻', 9)).toBe('HON-706↻ ')
    })
  })

  describe('wt watch skip histogram ordering', () => {
    const summary = (lines: string[]): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-order-'))
      const log = path.join(dir, 'orchestrator.log')
      fs.writeFileSync(log, `${lines.join('\n')}\n`)
      try {
        const out = runHarness('watch-scan-log', log, '')
        return (
          out
            .split('\n')
            .find((l) => l.startsWith('SKIP_SUMMARY='))
            ?.slice(13) ?? ''
        )
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    const ALL = [
      '2026-09-20 10:00:00 INFO  [SKIP] HON-1 assigned',
      '2026-09-20 10:00:00 INFO  [SKIP] HON-2 blocked by HON-9 (Todo)',
      '2026-09-20 10:00:00 INFO  [SKIP] HON-3 stranded (Stranded label)',
      '2026-09-20 10:00:00 INFO  [SKIP] HON-4 gated (Gated label)',
      '2026-09-20 10:00:00 INFO  [SKIP] HON-5 requeued at the Neon branch cap — cooling down',
    ]

    it('is deterministic rather than following awk hash order', () => {
      // Three runs of the same input must agree, or the pane reshuffles on every
      // redraw and the clip drops a different category each time.
      const runs = [summary(ALL), summary(ALL), summary(ALL)]

      expect(new Set(runs).size).toBe(1)
    })

    it('leads with the categories that need a human', () => {
      // gated needs the label removed, stranded needs `wt cleanup`; blocked and
      // assigned resolve themselves. The summary is clipped to fit the pane, so
      // ordering decides what survives.
      expect(summary(ALL)).toBe('1 gated, 1 stranded, 1 cap cooldown, 1 blocked, 1 assigned')
    })
  })
  describe('wt watch ignores log lines that are not log lines', () => {
    // orchestrator.sh:784 appends a raw, untimestamped 20-line worker tail
    // straight into orchestrator.log on a timeout. The window test is a string
    // compare on the first 19 characters, so those lines were admitted or
    // rejected on their first byte alone — "npm ERR …" sorts above any 2026 date
    // and was always "in window"; "  [OUTCOME] …" sorts below and never was.
    const scan = (lines: string[], since = ''): Record<string, string> => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-watch-untimed-'))
      const log = path.join(dir, 'orchestrator.log')
      fs.writeFileSync(log, `${lines.join('\n')}\n`)
      try {
        return Object.fromEntries(
          runHarness('watch-scan-log', log, since)
            .split('\n')
            .filter(Boolean)
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
        )
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    const REAL = '2026-09-21 10:00:00 INFO  Selected: HON-2 — work'

    it('does not let a worker echoing [OUTCOME] inflate the run tally', () => {
      const r = scan(
        [REAL, 'npm ERR [OUTCOME] HON-9 FAILED 1m1s 0-commits phase=initializing'],
        '2026-09-21 00:00:00',
      )

      expect(r.TALLY_FAILED).toBe('0')
      expect(r.LAST_OUTCOME).toBeUndefined()
    })

    it('does not raise an alert from an untimestamped tail line', () => {
      // This produced ALERT_AT=could — the 12th to 16th characters of the text,
      // read as if they were a clock.
      const r = scan([REAL, 'npm ERROR  could not reach Linear API'], '2026-09-21 00:00:00')

      expect(r.ALERT).toBeUndefined()
      expect(r.ALERT_AT).toBeUndefined()
    })

    it('cannot be pinned by a garbage timestamp that no real one can beat', () => {
      // The compounding failure: alert_ts came from the same bad substring, so it
      // sorted above every real timestamp and the suppression rule — which fires
      // when a later claim proves recovery — could never clear it.
      const r = scan(['2026-09-21 09:00:00 WARN  zzz unreachable', REAL], '2026-09-21 00:00:00')

      expect(r.ALERT).toBeUndefined()
    })

    it.each([
      ['a bare continuation line', 'pnpm ERR! command failed'],
      ['an indented one', '    at Object.<anonymous> (/app/x.ts:1:1)'],
      ['a blank-prefixed one', ' 2026 was a good year'],
      ['a lookalike missing the time', '2026-09-21 INFO  [OUTCOME] HON-9 FAILED 1m 0-commits'],
    ])('ignores %s', (_label, line) => {
      const r = scan([REAL, line], '2026-09-21 00:00:00')

      expect(r.TALLY_FAILED).toBe('0')
      expect(r.ALERT).toBeUndefined()
    })

    it('still reads genuine log lines', () => {
      // The guard must not be so tight that it drops the real thing.
      const r = scan(
        [
          '2026-09-21 10:00:00 INFO  [OUTCOME] HON-3 SUCCESS 5m0s 2-commits phase=done',
          '2026-09-21 10:05:00 WARN  Pausing: low disk space',
        ],
        '2026-09-21 00:00:00',
      )

      expect(r.TALLY_SUCCESS).toBe('1')
      expect(r.ALERT).toBe('Pausing: low disk space')
    })

    it('measures the rotation window from the first real line, not the first line', () => {
      // first_ts feeds TALLY_TRUNCATED; if an untimestamped line set it, the
      // comparison against the window would be meaningless.
      const r = scan(
        ['npm ERR something', '2026-09-21 10:00:00 INFO  Selected: HON-2 — work'],
        '2026-09-21 00:00:00',
      )

      expect(r.TALLY_TRUNCATED).toBe('1')
    })
  })

  describe('wt watch rules are valid UTF-8 in any locale', () => {
    // The rule used to be drawn with `tr ' ' '─'`, which is byte-oriented: BSD tr
    // honours a UTF-8 locale, but GNU tr has NO multi-byte support at all, so the
    // same code drew a clean rule on macOS and a row of U+FFFD on Linux CI — this
    // test is what caught that. It is now built by slicing a repeated string, so
    // no tr is involved on any platform. A machine offering no UTF-8 locale falls
    // back to ASCII rather than emitting replacement characters, so either unit is
    // accepted as long as the rule is uniform and exactly the requested width.
    const head = (locale: string, label: string, width: number) =>
      runHarnessEnv({ LC_ALL: locale }, 'watch-pane-head', label, String(width)).trim().slice(1, -1)

    it.each([['en_US.UTF-8'], ['C'], ['POSIX'], ['']])(
      'draws a decodable rule of exact width under LC_ALL=%j',
      (locale) => {
        const rule = head(locale as string, 'TEST', 24)

        expect([...rule]).toHaveLength(24)
        // A lone lead byte would not survive the round trip through UTF-8.
        expect(Buffer.from(rule, 'utf8').toString('utf8')).toBe(rule)
        expect(rule).not.toContain('�')
        expect(rule).toMatch(/[─-]$/)
        // One unit throughout: a mix would mean a slice landed mid-character.
        const unit = rule.slice(-1)
        expect(rule.endsWith(unit.repeat(8))).toBe(true)
      },
    )
  })

  describe('wt watch clips to nothing rather than overflowing', () => {
    // The title budget floors at 0 now: the fixed columns already spend 54, so a
    // 12-column floor made the worker row 66 wide on a 64-column terminal. It
    // wrapped, and the wrap consumed a row the height budget had already counted.
    const clip = (s: string, w: number) =>
      runHarness('watch-clip', s, String(w)).trim().slice(1, -1)

    it.each([[0], [-1]])('returns empty for a budget of %i', (w) => {
      expect(clip('a title that cannot fit', w as number)).toBe('')
    })
  })
})
