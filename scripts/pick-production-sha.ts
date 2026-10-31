/**
 * Pick the commit a production deploy ships (HON-1507).
 *
 * `deploy-production.yml` runs this in its `pick` job, before any migration.
 * Production may only ship a commit that staging smoke tested green, so the
 * answer is always a `main` commit with a green `staging-smoke.yml` run:
 *
 *   - With a SHA (the workflow's `sha` input, full or short): that commit, or a
 *     failure when it has no green smoke run.
 *   - Without one: the newest commit that has a green smoke run.
 *
 * What counts as a green smoke run for commit X:
 *
 *   - `event == workflow_run`: the run the staging migrations workflow
 *     triggered. Its job runs only when those migrations succeeded, so a green
 *     one proves X migrated on staging too. A `schedule` or `workflow_dispatch`
 *     run passes no such gate: it can go green on a commit whose staging
 *     migration failed, so it never counts.
 *   - `conclusion == success`. A `skipped` run is the smoke job declining to
 *     run because the staging migrations failed; `failure` and `cancelled` are
 *     not green either.
 *   - X is read from the run name, not from `head_sha`. `staging-smoke.yml`
 *     sets `run-name` to the commit it waits for (the migration run's head).
 *     A `workflow_run` run's `head_sha` is `main` HEAD when the run was
 *     created, which is a newer commit whenever pushes land close together.
 *
 * "Newest" is the first green run in the API's newest-first order: smoke runs
 * start in the order the staging migrations finish, which is push order.
 *
 * Usage (from the workflow): node scripts/pick-production-sha.ts
 *   INPUT_SHA          optional SHA to pin
 *   GITHUB_REPOSITORY  owner/name
 *   GITHUB_OUTPUT      receives `sha=` and `run_url=`
 *   GH_TOKEN           read by `gh`
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Runs `gh` with these arguments and returns its stdout. Injected so tests stub it. */
export type Gh = (args: string[]) => string

export interface SmokeRun {
  display_title: string
  event: string
  conclusion: string | null
  html_url: string
}

export interface Pick {
  sha: string
  runUrl: string
}

export const SMOKE_WORKFLOW = 'staging-smoke.yml'

/** 5 pages of 100 runs. About one run per push to `main`, so 500 is weeks. */
export const MAX_PAGES = 5

const PAGE_SIZE = 100

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

/** The commit a smoke run tested, from its run name, or null when the name carries none. */
export function testedSha(run: SmokeRun): string | null {
  return /\b([0-9a-f]{40})\b/.exec(run.display_title)?.[1] ?? null
}

function isGreen(run: SmokeRun): boolean {
  return run.event === 'workflow_run' && run.conclusion === 'success' && testedSha(run) !== null
}

/** Newest-first completed smoke runs on `main` triggered by the staging migrations. */
function* smokeRuns(gh: Gh, repo: string): Generator<SmokeRun> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      branch: 'main',
      event: 'workflow_run',
      status: 'completed',
      per_page: String(PAGE_SIZE),
      page: String(page),
    })
    const body = JSON.parse(
      gh(['api', `repos/${repo}/actions/workflows/${SMOKE_WORKFLOW}/runs?${params.toString()}`]),
    ) as { workflow_runs?: SmokeRun[] }
    const runs = body.workflow_runs ?? []
    yield* runs
    if (runs.length < PAGE_SIZE) return
  }
}

/** A short SHA becomes the full one, because the run name carries the full SHA. */
function resolveSha(gh: Gh, repo: string, input: string): string {
  if (!SHA_PATTERN.test(input)) {
    throw new Error(`"${input}" is not a commit SHA (7 to 40 hex characters).`)
  }
  let full: string
  try {
    full = gh(['api', `repos/${repo}/commits/${input}`, '--jq', '.sha']).trim()
  } catch {
    throw new Error(`Commit ${input} does not exist in ${repo}.`)
  }
  if (!/^[0-9a-f]{40}$/.test(full)) {
    throw new Error(`Commit ${input} did not resolve to a full SHA (got "${full}").`)
  }
  return full
}

export function pickProductionSha({ repo, sha, gh }: { repo: string; sha?: string; gh: Gh }): Pick {
  const input = sha?.trim()

  if (input) {
    const full = resolveSha(gh, repo, input)
    const seen: SmokeRun[] = []
    for (const run of smokeRuns(gh, repo)) {
      if (testedSha(run) !== full) continue
      if (isGreen(run)) return { sha: full, runUrl: run.html_url }
      seen.push(run)
    }
    const found = seen.length
      ? seen.map((run) => `${run.conclusion ?? 'no conclusion'} (${run.html_url})`).join(', ')
      : 'no completed run'
    throw new Error(
      `Commit ${full} has no green ${SMOKE_WORKFLOW} run after its staging migrations (${found}). ` +
        'Production ships only a commit that staging smoke passed.',
    )
  }

  for (const run of smokeRuns(gh, repo)) {
    if (isGreen(run)) return { sha: testedSha(run)!, runUrl: run.html_url }
  }
  throw new Error(
    `No commit has a green ${SMOKE_WORKFLOW} run after its staging migrations in the newest ` +
      `${MAX_PAGES * PAGE_SIZE} runs. Fix staging smoke before deploying production.`,
  )
}

function main(): void {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set.')

  const gh: Gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
  const picked = pickProductionSha({ repo, sha: process.env.INPUT_SHA, gh })

  console.log(`Picked ${picked.sha}`)
  console.log(`Green staging smoke run: ${picked.runUrl}`)

  const output = process.env.GITHUB_OUTPUT
  if (output) appendFileSync(output, `sha=${picked.sha}\nrun_url=${picked.runUrl}\n`)

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(
      summary,
      `## Production commit\n\n**Commit:** \`${picked.sha}\`\n\n**Green staging smoke run:** ${picked.runUrl}\n`,
    )
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
