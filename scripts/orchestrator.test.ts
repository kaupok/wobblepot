import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const orchestrator = path.join(scriptsDir, 'orchestrator.sh')
const harness = path.join(scriptsDir, 'orchestrator-outcome-harness.sh')

type PrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE'
type CiState = 'green' | 'pending' | 'failing' | 'unknown'

/**
 * Drive `handle_success` through the harness, which sources orchestrator.sh
 * with every network/Linear/GitHub collaborator stubbed. Returns the log lines
 * with their timestamps stripped, so assertions read against stable text.
 */
function classify(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return runHarness('outcome', String(commits), phase, pr, ci).replace(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm,
    '',
  )
}

function runHarness(...args: string[]): string {
  return execFileSync('bash', [harness, ...args], { encoding: 'utf8', timeout: 30_000 })
}

/** Run the real `pr_for_branch` / `pr_ci_state` against fixture `gh` output. */
function prForBranch(ghJson: unknown): string {
  return runHarness('pr-for-branch', JSON.stringify(ghJson)).trim()
}

function ciState(buckets: string[]): string {
  return runHarness('ci-state', JSON.stringify(buckets.map((bucket) => ({ bucket })))).trim()
}

describe('orchestrator.sh', () => {
  it('is syntactically valid', () => {
    expect(() => execFileSync('bash', ['-n', orchestrator], { timeout: 30_000 })).not.toThrow()
  })

  // HON-573: a worker that exits cleanly has not necessarily shipped anything.
  // Only a run that reached phase=done — or one whose PR is demonstrably merged
  // — may be logged SUCCESS, because SUCCESS is what triggers cleanup of the
  // worktree, local branch and Neon branch.
  describe('handle_success outcome classification', () => {
    it('gates a clean exit that produced no commits', () => {
      const out = classify(0, 'planning', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 GATED')
      expect(out).toContain('0-commits phase=planning')
      expect(out).not.toContain('SUCCESS')
      expect(out).toContain('RESTORE_TODO:HON-999')
      expect(out).toContain('LABEL:Gated')
    })

    it('reports SUCCESS for a run that reached done', () => {
      const out = classify(4, 'done', 'MERGED', 'green')

      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).toContain('4-commits phase=done')
      expect(out).not.toContain('STRANDED')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it('reports STRANDED — not SUCCESS — for commits with an open, unmerged PR', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('3-commits phase=pr-review pr=#650 ci=green')
      expect(out).not.toContain('SUCCESS')
    })

    it('preserves the worktree, branch and Neon branch when stranded', () => {
      const out = classify(3, 'pr-review', 'OPEN', 'green')

      // cleanup_worker_worktree is what deletes all three. It must not be
      // called: those artifacts are exactly what finishing the run requires.
      expect(out).not.toContain('CLEANUP:')
      expect(out).toContain('resume with: wt resume test-branch')
      expect(out).toContain('LABEL:Stranded')
    })

    it('still reports SUCCESS when the phase lags behind a merged PR', () => {
      // detect_phase can miss a "[merge:complete]" marker. Confirming against
      // the PR keeps that from manufacturing a false stranding.
      const out = classify(3, 'pr-review', 'MERGED', 'green')

      expect(out).toContain('but PR #650 is merged — treating as success')
      expect(out).toContain('[OUTCOME] HON-999 SUCCESS')
      expect(out).not.toContain('STRANDED')
      expect(out).toContain('CLEANUP:test-branch:false')
    })

    it('strands rather than guesses when the PR cannot be resolved', () => {
      // No PR found, or gh missing/unauthenticated — indistinguishable here.
      // A false SUCCESS deletes the branch, so the unknown case must strand.
      const out = classify(3, 'pr-review', 'NONE', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).toContain('pr=none ci=unknown')
      expect(out).not.toContain('CLEANUP:')
    })

    it('records the CI state so an operator can tell a merge-ready run apart', () => {
      expect(classify(2, 'pr-review', 'OPEN', 'failing')).toContain('pr=#650 ci=failing')
      expect(classify(2, 'pr-review', 'OPEN', 'pending')).toContain('pr=#650 ci=pending')
    })

    it('never logs SUCCESS for a closed-but-unmerged PR', () => {
      const out = classify(3, 'pr-review', 'CLOSED', 'unknown')

      expect(out).toContain('[OUTCOME] HON-999 STRANDED')
      expect(out).not.toContain('SUCCESS')
    })
  })

  // These drive the real helpers against fixture `gh` output. The
  // classification tests above stub them out, so without this block the jq
  // expression and the bucket rules would be untested — and `.[0]` on an empty
  // result really did once yield a PR numbered "null".
  describe('pr_for_branch', () => {
    it('emits nothing when no PR matches the branch', () => {
      expect(prForBranch([])).toBe('')
    })

    it('emits state, number and url as TSV', () => {
      const out = prForBranch([{ state: 'OPEN', number: 650, url: 'https://x/650' }])

      expect(out).toBe('OPEN\t650\thttps://x/650')
    })
  })

  describe('pr_ci_state', () => {
    it('is green when every check passed or was skipped', () => {
      expect(ciState(['pass', 'skipping', 'pass'])).toBe('green')
    })

    it('is pending while any check is still running', () => {
      expect(ciState(['pass', 'pending'])).toBe('pending')
    })

    it('is failing for a failed or cancelled check', () => {
      expect(ciState(['pass', 'fail'])).toBe('failing')
      expect(ciState(['cancel'])).toBe('failing')
    })

    it('is unknown when no checks were reported', () => {
      expect(ciState([])).toBe('unknown')
    })
  })
})
