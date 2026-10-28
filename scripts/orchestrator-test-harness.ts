import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

export const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
export const orchestrator = path.join(scriptsDir, 'orchestrator.sh')
export const worktreeClaude = path.join(scriptsDir, 'worktree-claude.sh')
export const neonCleanup = path.join(scriptsDir, 'neon-cleanup.sh')
export const e2eLocal = path.join(scriptsDir, 'e2e-local.sh')
export const harness = path.join(scriptsDir, 'orchestrator-outcome-harness.sh')
export const models = path.join(scriptsDir, 'models.sh')
export const prReview = path.join(scriptsDir, 'pr-review.sh')

/**
 * The harness inherits the developer's shell, and a machine that has sourced
 * `.env` exports NEON_USER_PREFIX — which would silently widen the Neon GC
 * selection under test. Pin it per call instead.
 *
 * NEON_BRANCH_CAP and ORCHESTRATOR_MAX_WORKERS are pinned for the same reason:
 * both are read from the environment at source time, so an operator who has
 * tuned either one in their shell would otherwise see the branch-budget
 * defaults under test resolve to their values (HON-616). Empty, not deleted —
 * `${VAR:-default}` treats the two alike, and an override below still wins.
 */
export function harnessEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Deleted, not emptied: models.sh reads an empty CLAUDE_*_EFFORT as "no
  // --effort flag", so only an unset one resolves to the default (HON-1193).
  const inherited = { ...process.env }
  for (const key of EFFORT_ENV_VARS) delete inherited[key]
  return {
    ...inherited,
    NEON_USER_PREFIX: '',
    NEON_BRANCH_CAP: '',
    ORCHESTRATOR_MAX_WORKERS: '',
    ORCHESTRATOR_CAP_REQUEUE_COOLDOWN: '',
    // A retry worker's own `pnpm test` must not see itself as a retry (HON-728).
    ORCHESTRATOR_RETRY_CONTEXT: '',
    // A swap test exports these into the worker that then runs `pnpm test`, so
    // the models.sh defaults under test would resolve to the swapped model (HON-730).
    CLAUDE_AUTO_MODEL: '',
    CLAUDE_REVIEW_MODEL: '',
    CLAUDE_TRIAGE_MODEL: '',
    CLAUDE_AUTO_MODEL_SMALL: '',
    ...overrides,
  }
}

export const stripTimestamps = (out: string) =>
  out.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm, '')

/** The models.sh effort overrides, which harnessEnv removes from the environment. */
export const EFFORT_ENV_VARS = [
  'CLAUDE_AUTO_EFFORT',
  'CLAUDE_REVIEW_EFFORT',
  'CLAUDE_TRIAGE_EFFORT',
  'CLAUDE_AUTO_EFFORT_SMALL',
] as const

/**
 * Slice a shell function's body out of a script's source, so a test can assert
 * on what one function does without matching text elsewhere in the file.
 * Relies on the repo's convention of closing every function with `}` at column 0.
 */
export function shellFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`\n${name}() {`)
  expect(start, `${name}() not found`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}\n', start)
  expect(end, `${name}() has no closing brace at column 0`).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The `env … claude` command in a function body, its `\` continuations joined. */
export function launchLine(body: string): string {
  const line = body
    .replace(/\\\n\s*/g, '')
    .split('\n')
    .find((l) => /^\s*(exec )?env -u /.test(l))
  expect(line, 'no `env -u` launch line').toBeDefined()
  return line!.trim()
}

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE' | 'ERROR'
export type CiState = 'green' | 'pending' | 'failing' | 'unknown'

/**
 * Drive `handle_success` through the harness, which sources orchestrator.sh
 * with every network/Linear/GitHub collaborator stubbed. Returns the log lines
 * with their timestamps stripped, so assertions read against stable text.
 */
export function classify(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return runHarness('outcome', String(commits), phase, pr, ci).replace(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm,
    '',
  )
}

/**
 * Same fixtures, but through `handle_timeout` — the path monitor_workers takes
 * when it kills a worker at WORKER_TIMEOUT. `handle_failure` is stubbed to a
 * `HANDLE_FAILURE:<type>` marker, so the three routes out are distinguishable.
 */
export function classifyTimeout(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return stripTimestamps(runHarness('timeout', String(commits), phase, pr, ci))
}

/**
 * Same fixtures, but through `handle_error_exit` with exit code 1 — the path
 * monitor_workers takes when a worker exits non-zero (HON-1064). The
 * `handle_failure` stub marker reads `HANDLE_FAILURE:exit:1`.
 */
export function classifyError(commits: number, phase: string, pr: PrState, ci: CiState): string {
  return stripTimestamps(runHarness('error', String(commits), phase, pr, ci))
}

export function runHarness(...args: string[]): string {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: harnessEnv(),
  })
}

/** Like runHarness, but threads environment overrides into the harness process. */
export function runHarnessEnv(env: Record<string, string>, ...args: string[]): string {
  return execFileSync('bash', [harness, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: harnessEnv(env),
  })
}

/** Run the real `pr_for_branch` / `pr_ci_state` against fixture `gh` output. */
export function prForBranch(ghJson: unknown): string {
  return runHarness('pr-for-branch', JSON.stringify(ghJson)).trim()
}

/**
 * One `gh pr checks` row. A bare bucket string models a GitHub Actions job —
 * those always carry a non-empty `workflow`. The object form is for a
 * third-party commit status, which reports `workflow: ""`; that field is what
 * the HON-600 pending-only exemption keys on, so it has to be in the fixture.
 */
export type CheckFixture = string | { bucket: string; workflow: string }

/** A commit status posted by a third-party GitHub app, e.g. Vercel's deploy. */
export const commitStatus = (bucket: string) => ({ bucket, workflow: '' })

export function ciState(checks: CheckFixture[]): string {
  const rows = checks.map((check) =>
    typeof check === 'string' ? { bucket: check, workflow: 'CI' } : check,
  )
  return runHarness('ci-state', JSON.stringify(rows)).trim()
}
