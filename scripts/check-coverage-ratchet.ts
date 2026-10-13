/**
 * Coverage ratchet gate (HON-1192)
 *
 * `vitest.config.ts` → `coverage.thresholds` holds the measured coverage of
 * `main`, and `pnpm test:coverage` fails a run that falls under it. That run
 * cannot see a PR that lowers the threshold itself: the lower bar is the one it
 * reads. This check compares the four thresholds with the PR's base, so a
 * threshold only goes down in a PR that says why.
 *
 * A lowered threshold passes when the PR body has a line
 * `Coverage threshold lowered: <why>`. CI passes the body in `PR_BODY`.
 *
 * The thresholds are read with a regex, not by loading the config: the base
 * version exists only as text from `git show`. A config the regex cannot read
 * fails the check rather than passing it, so a refactor of the block has to
 * update this file too.
 *
 * Usage: pnpm coverage:ratchet <base-ref> [repo-root]
 *   `repo-root` defaults to this repo. It exists so the unit test can point the
 *   check at a fixture repository.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const METRICS = ['lines', 'functions', 'branches', 'statements'] as const
export type Metric = (typeof METRICS)[number]
export type Thresholds = Record<Metric, number>

const CONFIG_FILE = 'vitest.config.ts'

/** The line a PR body carries to lower a threshold on purpose. */
export const REASON_PREFIX = 'Coverage threshold lowered:'

/**
 * The four numbers in the config's `thresholds: { … }` block. Throws when the
 * block is missing, appears twice, or lacks a metric.
 */
export function parseThresholds(configText: string): Thresholds {
  const blocks = [...configText.matchAll(/\bthresholds\s*:\s*\{([^}]*)\}/g)]
  const block = blocks.length === 1 ? blocks[0]?.[1] : undefined
  if (block === undefined) {
    throw new Error(`expected one \`thresholds: { … }\` block, found ${blocks.length}`)
  }
  // Drop line comments, so `// lines: 50` in the block is not read as a value.
  const body = block.replace(/\/\/.*$/gm, '')

  const result: Partial<Thresholds> = {}
  for (const metric of METRICS) {
    const match = body.match(new RegExp(`\\b${metric}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\b`))
    if (!match) throw new Error(`no numeric \`${metric}\` in the \`thresholds\` block`)
    result[metric] = Number(match[1])
  }
  return result as Thresholds
}

export interface Lowered {
  metric: Metric
  from: number
  to: number
}

/** Every metric whose threshold in `head` is under the one in `base`. */
export function findLowered(base: Thresholds, head: Thresholds): Lowered[] {
  return METRICS.filter((metric) => head[metric] < base[metric]).map((metric) => ({
    metric,
    from: base[metric],
    to: head[metric],
  }))
}

/** The reason text after {@link REASON_PREFIX} in a PR body, or null. */
export function loweringReason(prBody: string): string | null {
  for (const line of prBody.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith(REASON_PREFIX.toLowerCase())) continue
    const reason = trimmed.slice(REASON_PREFIX.length).trim()
    if (reason !== '') return reason
  }
  return null
}

function format(thresholds: Thresholds): string {
  return METRICS.map((metric) => `${metric} ${thresholds[metric]}`).join(', ')
}

// ============================================
// MAIN
// ============================================

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function main(): void {
  const baseRef = process.argv[2]
  if (!baseRef) throw new Error('usage: pnpm coverage:ratchet <base-ref> [repo-root]')
  const root = path.resolve(process.argv[3] ?? repoRoot)

  const baseText = execFileSync('git', ['show', `${baseRef}:${CONFIG_FILE}`], {
    cwd: root,
    encoding: 'utf8',
  })
  const base = parseThresholds(baseText)
  const head = parseThresholds(readFileSync(path.join(root, CONFIG_FILE), 'utf8'))
  const lowered = findLowered(base, head)

  if (lowered.length === 0) {
    console.log(`✓ Coverage thresholds not lowered: ${format(head)} (base: ${format(base)}).`)
    return
  }

  const list = lowered.map(({ metric, from, to }) => `  ${metric}: ${from} → ${to}`).join('\n')
  const reason = loweringReason(process.env.PR_BODY ?? '')
  if (reason !== null) {
    console.warn(
      `⚠ Coverage thresholds lowered, with a reason in the PR body:\n${list}\n  why: ${reason}`,
    )
    return
  }

  console.error(
    `\n✗ This PR lowers coverage thresholds in ${CONFIG_FILE}:\n${list}\n\n` +
      'Thresholds only rise (docs/DEPLOYMENT.md → CI Pipeline). Add the tests that\n' +
      'restore coverage instead. If the drop is deliberate, add a line to the PR body:\n\n' +
      `  ${REASON_PREFIX} <why>\n\n` +
      'and push a commit. A re-run of this job reads the body the run started with.\n',
  )
  process.exitCode = 1
}

// Guarded so the unit test can import the pure helpers without running the check.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\ncheck-coverage-ratchet failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
