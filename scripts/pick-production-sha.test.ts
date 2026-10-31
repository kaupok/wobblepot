/**
 * The commit pick behind `deploy-production.yml`'s `pick` job (HON-1507).
 *
 * The workflow is `workflow_dispatch` only and deploys production, so no PR
 * runs it. These tests stub `gh` with canned API pages and assert which commit
 * the pick returns, or that it refuses.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type Gh, MAX_PAGES, pickProductionSha, type SmokeRun } from './pick-production-sha'

const REPO = 'kaupok/wobblepot'
const NEWEST = 'a'.repeat(40)
const OLDER = 'b'.repeat(40)
const OLDEST = 'c'.repeat(40)

/** A smoke run as the API returns it: the tested commit is in the run name. */
const run = (
  sha: string,
  conclusion: string | null,
  id: number,
  event = 'workflow_run',
): SmokeRun => ({
  display_title: `Staging smoke ${sha}`,
  event,
  conclusion,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
})

const runUrl = (id: number) => `https://github.com/${REPO}/actions/runs/${id}`

/** A `gh` stub: commit lookups from `commits`, run pages from `pages`, every call logged. */
function stubGh({
  pages = [],
  commits = {},
}: {
  pages?: SmokeRun[][]
  commits?: Record<string, string>
}): { gh: Gh; calls: string[][] } {
  const calls: string[][] = []
  const gh: Gh = (args) => {
    calls.push(args)
    const endpoint = args[1] ?? ''
    const commit = /^repos\/[^/]+\/[^/]+\/commits\/(.+)$/.exec(endpoint)
    if (commit) {
      const full = commits[commit[1]!]
      if (!full) throw new Error('gh: HTTP 422 No commit found')
      return `${full}\n`
    }
    const url = new URL(`https://api.github.com/${endpoint}`)
    expect(url.pathname).toBe(`/repos/${REPO}/actions/workflows/staging-smoke.yml/runs`)
    expect(url.searchParams.get('branch')).toBe('main')
    expect(url.searchParams.get('status')).toBe('completed')
    const page = Number(url.searchParams.get('page'))
    return JSON.stringify({ workflow_runs: pages[page - 1] ?? [] })
  }
  return { gh, calls }
}

const fullPageOf = (sha: string, conclusion: string) =>
  Array.from({ length: 100 }, (_, i) => run(sha, conclusion, 10_000 - i))

describe('pickProductionSha', () => {
  describe('with no SHA', () => {
    it('picks the newest commit with a green smoke run', () => {
      const { gh } = stubGh({
        pages: [[run(NEWEST, 'success', 3), run(OLDER, 'success', 2), run(OLDEST, 'success', 1)]],
      })

      expect(pickProductionSha({ repo: REPO, gh })).toEqual({ sha: NEWEST, runUrl: runUrl(3) })
    })

    it('passes over newer failed, skipped and cancelled runs to the newest green one', () => {
      const { gh } = stubGh({
        pages: [
          [
            run(NEWEST, 'skipped', 5),
            run(NEWEST, 'failure', 4),
            run(OLDER, 'cancelled', 3),
            run(OLDEST, 'success', 2),
          ],
        ],
      })

      expect(pickProductionSha({ repo: REPO, gh })).toEqual({ sha: OLDEST, runUrl: runUrl(2) })
    })

    it('takes the commit from the run name, not from head_sha', () => {
      const { gh } = stubGh({
        pages: [[{ ...run(OLDER, 'success', 6), head_sha: NEWEST } as SmokeRun]],
      })

      expect(pickProductionSha({ repo: REPO, gh }).sha).toBe(OLDER)
    })

    it('does not count a green scheduled or dispatched run', () => {
      const { gh } = stubGh({
        pages: [
          [
            run(NEWEST, 'success', 9, 'schedule'),
            run(NEWEST, 'success', 8, 'workflow_dispatch'),
            run(OLDER, 'success', 7),
          ],
        ],
      })

      expect(pickProductionSha({ repo: REPO, gh })).toEqual({ sha: OLDER, runUrl: runUrl(7) })
    })

    it('does not count a green run whose name carries no full SHA', () => {
      const { gh } = stubGh({
        pages: [
          [
            { ...run(NEWEST, 'success', 9), display_title: 'Deploy DB migrations [staging]' },
            run(OLDER, 'success', 7),
          ],
        ],
      })

      expect(pickProductionSha({ repo: REPO, gh }).sha).toBe(OLDER)
    })

    it('reads the next page when the first holds no green run', () => {
      const { gh } = stubGh({ pages: [fullPageOf(NEWEST, 'failure'), [run(OLDER, 'success', 7)]] })

      expect(pickProductionSha({ repo: REPO, gh }).sha).toBe(OLDER)
    })

    it('refuses when every run failed or was skipped', () => {
      const { gh } = stubGh({
        pages: [[run(NEWEST, 'failure', 3), run(OLDER, 'skipped', 2), run(OLDEST, null, 1)]],
      })

      expect(() => pickProductionSha({ repo: REPO, gh })).toThrow(
        'No commit has a green staging-smoke.yml run after its staging migrations in the newest 500 runs.',
      )
    })

    it(`stops after ${MAX_PAGES} full pages`, () => {
      const { gh, calls } = stubGh({
        pages: Array.from({ length: 8 }, () => fullPageOf(NEWEST, 'failure')),
      })

      expect(() => pickProductionSha({ repo: REPO, gh })).toThrow(/No commit has a green/)
      expect(calls).toHaveLength(5)
    })

    it('treats a blank SHA input as no input', () => {
      const { gh } = stubGh({ pages: [[run(OLDER, 'success', 2)]] })

      expect(pickProductionSha({ repo: REPO, sha: '  ', gh }).sha).toBe(OLDER)
    })
  })

  describe('with a SHA', () => {
    it('returns the commit when it has a green smoke run', () => {
      const { gh } = stubGh({
        commits: { [OLDER]: OLDER },
        pages: [[run(NEWEST, 'success', 5), run(OLDER, 'failure', 4), run(OLDER, 'success', 3)]],
      })

      expect(pickProductionSha({ repo: REPO, sha: OLDER, gh })).toEqual({
        sha: OLDER,
        runUrl: runUrl(3),
      })
    })

    it('finds the commit’s green run on a later page', () => {
      const { gh } = stubGh({
        commits: { [OLDER]: OLDER },
        pages: [fullPageOf(NEWEST, 'success'), [run(OLDER, 'success', 3)]],
      })

      expect(pickProductionSha({ repo: REPO, sha: OLDER, gh }).sha).toBe(OLDER)
    })

    it('resolves a short SHA to the full one', () => {
      const { gh } = stubGh({
        commits: { bbbbbbb: OLDER },
        pages: [[run(OLDER, 'success', 3)]],
      })

      expect(pickProductionSha({ repo: REPO, sha: 'bbbbbbb', gh }).sha).toBe(OLDER)
    })

    it('refuses a commit with no smoke run at all', () => {
      const { gh } = stubGh({
        commits: { [NEWEST]: NEWEST },
        pages: [[run(OLDER, 'success', 1)]],
      })

      expect(() => pickProductionSha({ repo: REPO, sha: NEWEST, gh })).toThrow(
        `Commit ${NEWEST} has no green staging-smoke.yml run after its staging migrations (no completed run).`,
      )
    })

    it('refuses a commit whose smoke runs only failed or were skipped', () => {
      const { gh } = stubGh({
        commits: { [NEWEST]: NEWEST },
        pages: [[run(NEWEST, 'skipped', 9), run(NEWEST, 'failure', 8), run(OLDER, 'success', 1)]],
      })

      expect(() => pickProductionSha({ repo: REPO, sha: NEWEST, gh })).toThrow(
        `Commit ${NEWEST} has no green staging-smoke.yml run after its staging migrations ` +
          `(skipped (${runUrl(9)}), failure (${runUrl(8)})).`,
      )
    })

    it('refuses a commit whose only green run is a scheduled one', () => {
      const { gh } = stubGh({
        commits: { [NEWEST]: NEWEST },
        pages: [[run(NEWEST, 'success', 9, 'schedule'), run(NEWEST, 'skipped', 8)]],
      })

      expect(() => pickProductionSha({ repo: REPO, sha: NEWEST, gh })).toThrow(
        `(success (${runUrl(9)}), skipped (${runUrl(8)}))`,
      )
    })

    it('refuses a commit that does not exist', () => {
      const { gh } = stubGh({})

      expect(() => pickProductionSha({ repo: REPO, sha: 'deadbeef', gh })).toThrow(
        `Commit deadbeef does not exist in ${REPO}.`,
      )
    })

    it('refuses input that is not a SHA, before any API call', () => {
      const { gh, calls } = stubGh({})

      expect(() => pickProductionSha({ repo: REPO, sha: 'main', gh })).toThrow(
        '"main" is not a commit SHA (7 to 40 hex characters).',
      )
      expect(calls).toEqual([])
    })
  })
})

describe('the CLI', () => {
  it('runs under plain node, as the workflow calls it', () => {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pick-production-sha.ts')
    const result = (() => {
      try {
        execFileSync('node', [script], {
          encoding: 'utf8',
          env: { ...process.env, GITHUB_REPOSITORY: '' },
          stdio: 'pipe',
        })
        return { status: 0, stderr: '' }
      } catch (error) {
        const failed = error as { status: number; stderr: string }
        return { status: failed.status, stderr: failed.stderr }
      }
    })()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::GITHUB_REPOSITORY is not set.')
  })
})
