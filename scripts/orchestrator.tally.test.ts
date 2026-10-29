import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runHarness } from './orchestrator-test-harness'

// The THIS RUN tally row in `wt watch`: which stranded, gated and failed
// outcomes are still open, and how the row colours them (HON-938, HON-1435).
// The scan that emits the open counts is tested in orchestrator.watch.test.ts.
describe('orchestrator.sh', () => {
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
    const RED = '\\033[0;31m'
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
      const [line, plain] = row(43, 0, 0, 1, 0, 0, 0, 0, 0)

      expect(line).toContain(`${DIM}1 stranded (resolved)${NC}`)
      expect(line).not.toContain(YELLOW)
      expect(plain).toBe('43 merged · 0 failed · 1 stranded (resolved)')
    })

    it('shows an open stranded outcome yellow, with the open count', () => {
      const [line, plain] = row(43, 0, 0, 2, 1, 0, 0, 0, 0)

      expect(line).toContain(`${YELLOW}1 stranded${NC}`)
      expect(plain).toBe('43 merged · 0 failed · 1 stranded')
    })

    it('treats gated the same way, and still omits it when there was none', () => {
      expect(row(43, 0, 0, 0, 0, 1, 0, 0, 0)[0]).toContain(`${DIM}1 gated (resolved)${NC}`)
      expect(row(43, 0, 0, 0, 0, 1, 1, 0, 0)[0]).toContain(`${YELLOW}1 gated${NC}`)
      expect(row(43, 0, 0, 0, 0, 0, 0, 0, 0)[1]).toBe('43 merged · 0 failed · 0 stranded')
    })

    it('leaves timeout alone', () => {
      const [line, plain] = row(1, 0, 0, 0, 0, 0, 0, 3, 1)

      expect(line).toContain(`${YELLOW}3 timeout${NC}`)
      expect(plain).toBe('1 merged · 0 failed · 0 stranded · 3 timeout (floor: log rotated)')
    })

    describe('treats failed the same way, in red (HON-1435)', () => {
      it('shows a failure that ran again dim, with the run total', () => {
        const [line, plain] = row(1, 1, 0, 0, 0, 0, 0, 0, 0)

        expect(line).toContain(`${DIM}1 failed (resolved)${NC}`)
        expect(line).not.toContain(RED)
        expect(plain).toBe('1 merged · 1 failed (resolved) · 0 stranded')
      })

      it('shows an open failure red', () => {
        const [line, plain] = row(0, 1, 1, 0, 0, 0, 0, 0, 0)

        expect(line).toContain(`${RED}1 failed${NC}`)
        expect(plain).toBe('0 merged · 1 failed · 0 stranded')
      })

      it('shows the open count, not the total, while one is still open', () => {
        const [line, plain] = row(1, 3, 1, 0, 0, 0, 0, 0, 0)

        expect(line).toContain(`${RED}1 failed${NC}`)
        expect(plain).toBe('1 merged · 1 failed · 0 stranded')
      })

      it('shows no failures plain', () => {
        const [line, plain] = row(1, 0, 0, 0, 0, 0, 0, 0, 0)

        expect(line).not.toContain(RED)
        expect(line).not.toContain(`${DIM}0 failed`)
        expect(plain).toBe('1 merged · 0 failed · 0 stranded')
      })

      it('keeps the red total for a cached scan that has no TALLY_FAILED_OPEN', () => {
        // cmd_watch passes an empty failed_open when the key is missing.
        const [line, plain] = row(1, 2, '', 0, 0, 0, 0, 0, 0)

        expect(line).toContain(`${RED}2 failed${NC}`)
        expect(plain).toBe('1 merged · 2 failed · 0 stranded')
      })

      it('drops "(resolved)" from failed too on a narrow pane', () => {
        // With "(resolved)" the row is 44 wide; without it, 33.
        const [line, plain] = row(43, 1, 0, 0, 0, 0, 0, 0, 0, 40)

        expect(plain).toBe('43 merged · 1 failed · 0 stranded')
        expect(line).toContain(`${DIM}1 failed${NC}`)
      })
    })

    it('measures exactly the text it shows', () => {
      // The plain twin is what the pane clips against, so the two must match
      // character for character once the escapes are gone.
      for (const counts of [
        [43, 0, 0, 1, 0, 1, 0, 0, 0],
        [43, 2, 1, 2, 1, 3, 2, 1, 1],
        [43, 2, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
      ]) {
        const [line, plain] = row(...counts)
        expect(line.replace(/\\033\[[0-9;]*m/g, '')).toBe(plain)
      }
    })

    it('reads non-numeric counts as zero rather than printing a shell error', () => {
      const [line, plain] = row('', 'null', '', '', '', '', '', '', '')

      expect(line).not.toMatch(/integer expression/)
      expect(plain).toBe('0 merged · 0 failed · 0 stranded')
    })

    it('drops "(resolved)" before the row outgrows its pane, so the colour survives', () => {
      // A row wider than the pane is drawn as its clipped plain twin, with no
      // colour. pane_r is 49 on a 100-column terminal: the mixed state with
      // "(resolved)" is 54 wide and would lose the open strand's yellow.
      const [line, plain] = row(43, 0, 0, 1, 1, 1, 0, 0, 0, 49)

      expect(plain).toBe('43 merged · 0 failed · 1 stranded · 1 gated')
      expect(line).toContain(`${YELLOW}1 stranded${NC}`)
      expect(line).toContain(`${DIM}1 gated${NC}`)
    })

    it('keeps "(resolved)" whenever the row fits', () => {
      expect(row(43, 0, 0, 1, 0, 1, 0, 0, 0, 80)[1]).toBe(
        '43 merged · 0 failed · 1 stranded (resolved) · 1 gated (resolved)',
      )
      // Exactly at the width is a fit, not an overflow.
      expect(row(43, 0, 0, 1, 0, 0, 0, 0, 0, 44)[1]).toBe(
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
      // A missing key reads as empty, as in cmd_watch.
      const get = (k: string) => out.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? ''
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
        get('TALLY_FAILED_OPEN'),
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

    it('shows failures dim once each issue succeeds later (HON-1435)', () => {
      // The 2026-10-28 shape: four spawns hit the Neon branch cap, and both
      // issues merged later the same day.
      const capped = [
        '2026-10-28 15:00:00 WARN  [OUTCOME] HON-1377 FAILED 0m12s 0-commits phase=initializing triage=CAP',
        '2026-10-28 15:01:00 WARN  [OUTCOME] HON-1377 FAILED 0m12s 0-commits phase=initializing triage=CAP',
        '2026-10-28 15:01:30 WARN  [OUTCOME] HON-1360 FAILED 0m12s 0-commits phase=initializing triage=CAP',
        '2026-10-28 15:02:00 WARN  [OUTCOME] HON-1360 FAILED 0m12s 0-commits phase=initializing triage=CAP',
      ]
      const merged = [
        ...capped,
        '2026-10-28 15:58:00 INFO  [OUTCOME] HON-1377 SUCCESS 50m0s 3-commits phase=done',
        '2026-10-28 17:19:00 INFO  [OUTCOME] HON-1360 SUCCESS 1h10m 4-commits phase=done',
      ]

      expect(render(capped)[0]).toContain('\\033[0;31m2 failed\\033[0m')
      const [line, plain] = render(merged)
      expect(plain).toBe('2 merged · 4 failed (resolved) · 0 stranded')
      expect(line).not.toContain('\\033[0;31m')
    })
  })
})
