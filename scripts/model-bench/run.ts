/**
 * Model-comparison benchmark for the app's AI calls (HON-795).
 *
 * Runs a fixed set of committed, synthetic cases through two Claude models,
 * scores every output deterministically, and writes a report comparing them.
 * Manual only — it spends real money and must never run in CI.
 *
 * Usage:
 *   pnpm bench:models --baseline claude-sonnet-5 --candidate claude-sonnet-5-5 \
 *     [--task plan,recipe,imagine,review,tips] [--runs 3] [--dry-run] [--max-usd 10]
 *
 * Output: scripts/model-bench/results/<YYYY-MM-DD>-<baseline>-vs-<candidate>.md
 * (commit it, attach it to the upgrade PR) and a gitignored `.json` beside it.
 * See docs/AI_MODELS.md.
 *
 * Runs under plain `tsx`, without `scripts/register-server-only.cjs`: every
 * import below loads with an empty environment. Never import
 * `src/lib/ai/usage.ts`, `@/lib/env` or a route file from here. `@/lib/prisma`
 * is reached through `plan-helpers` (see `scorers.ts`): it builds a client
 * without connecting, and nothing here queries it.
 */

import 'dotenv/config'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createAnthropic } from '@ai-sdk/anthropic'
import { MODEL_PRICES } from '../../src/lib/ai/pricing'
import { TASKS, type Task } from './case-schema'
import { CASES_DIR, loadCases } from './load-cases'
import { estimateRun } from './dry-run'
import { runBenchmark, type ModelFactory } from './runner'
import { buildReport, localDateString, renderMarkdown, writeReport } from './report'

export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results')

const DEFAULT_RUNS = 3
const DEFAULT_MAX_USD = 10

const USAGE = `Usage: pnpm bench:models --baseline <model> --candidate <model> [--task ${TASKS.join(',')}] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}]`

export interface MainDeps {
  /** Defaults to `createAnthropic` with `ANTHROPIC_API_KEY`; never built under `--dry-run`. */
  modelFactory?: ModelFactory
  env?: Record<string, string | undefined>
  log?: (line: string) => void
  error?: (line: string) => void
  casesDir?: string
  outDir?: string
  today?: () => Date
}

class UsageError extends Error {}

function parseCli(argv: string[]) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        baseline: { type: 'string' },
        candidate: { type: 'string' },
        task: { type: 'string' },
        runs: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'max-usd': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (err) {
    throw new UsageError((err as Error).message)
  }

  if (!values.baseline || !values.candidate) {
    throw new UsageError('--baseline and --candidate are both required.')
  }

  const tasks = values.task ? values.task.split(',').map((t) => t.trim()) : [...TASKS]
  const unknown = tasks.filter((t) => !(TASKS as readonly string[]).includes(t))
  if (unknown.length > 0 || tasks.length === 0) {
    throw new UsageError(`Unknown --task ${unknown.join(', ')}. Choose from ${TASKS.join(', ')}.`)
  }

  const runs = values.runs === undefined ? DEFAULT_RUNS : Number(values.runs)
  if (!Number.isInteger(runs) || runs < 1) {
    throw new UsageError(`--runs must be a positive integer, got "${values.runs}".`)
  }

  const maxUsd = values['max-usd'] === undefined ? DEFAULT_MAX_USD : Number(values['max-usd'])
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new UsageError(`--max-usd must be a positive number, got "${values['max-usd']}".`)
  }

  return {
    baseline: values.baseline,
    candidate: values.candidate,
    tasks: tasks as Task[],
    runs,
    maxUsd,
    dryRun: values['dry-run'],
  }
}

/** Returns the process exit code. */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const error = deps.error ?? ((line: string) => console.error(line))
  const env = deps.env ?? process.env

  let args
  try {
    args = parseCli(argv)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    error(err.message)
    error(USAGE)
    return 2
  }

  // Before any call, and under --dry-run too: `estimateCostUsd` prices an
  // unknown model at $0, which would silently disable --max-usd.
  const unpriced = [args.baseline, args.candidate].filter((id) => !MODEL_PRICES[id])
  if (unpriced.length > 0) {
    for (const id of unpriced) {
      error(
        `No MODEL_PRICES entry for "${id}" in src/lib/ai/pricing.ts. Add its prices before benchmarking it — without one every call costs $0 and --max-usd never trips.`,
      )
    }
    return 1
  }

  const cases = loadCases(args.tasks, deps.casesDir ?? CASES_DIR)
  if (cases.length === 0) {
    error(`No cases found for ${args.tasks.join(', ')}.`)
    return 1
  }

  if (args.dryRun) {
    const estimate = estimateRun({
      cases,
      runs: args.runs,
      models: [args.baseline, args.candidate],
    })
    log(`Dry run — no API calls made.`)
    log(`Cases: ${estimate.caseCount} (${args.tasks.join(', ')}), runs: ${args.runs}`)
    log(`Total calls: ${estimate.totalCalls}`)
    for (const m of estimate.perModel) {
      log(
        `  ${m.model}: ${m.calls} calls, ~${m.inputTokens} input + ~${m.outputTokens} output tokens, ~$${m.costUsd.toFixed(2)}`,
      )
    }
    log(`Estimated cost: ~$${estimate.totalCostUsd.toFixed(2)} (--max-usd ${args.maxUsd})`)
    return 0
  }

  let modelFactory = deps.modelFactory
  if (!modelFactory) {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) {
      error('ANTHROPIC_API_KEY is not set. Put it in .env, or use --dry-run to estimate cost.')
      return 1
    }
    const anthropic = createAnthropic({ apiKey })
    modelFactory = (id) => anthropic(id)
  }

  log(
    `Benchmarking ${args.baseline} vs ${args.candidate}: ${cases.length} cases × ${args.runs} runs × 2 models, cap $${args.maxUsd}`,
  )

  const result = await runBenchmark({
    cases,
    baseline: args.baseline,
    candidate: args.candidate,
    runs: args.runs,
    maxUsd: args.maxUsd,
    modelFactory,
    onCall: (r, p) =>
      log(
        `[${p.done}/${p.planned}] ${r.caseId} run ${r.run} ${r.model}: ${(r.latencyMs / 1000).toFixed(1)}s ${r.errorName ?? r.finishReason ?? ''} $${r.costUsd.toFixed(4)} (total $${p.spendUsd.toFixed(2)})`,
      ),
  })

  const report = buildReport({
    result,
    baseline: args.baseline,
    candidate: args.candidate,
    runs: args.runs,
    maxUsd: args.maxUsd,
    tasks: args.tasks,
    date: localDateString((deps.today ?? (() => new Date()))()),
  })
  const outDir = deps.outDir ?? RESULTS_DIR
  const { markdownPath, jsonPath } = writeReport(outDir, report, result)

  if (result.partial) {
    error(
      `Stopped early: spend $${result.spendUsd.toFixed(2)} passed --max-usd ${args.maxUsd}. The report is marked partial.`,
    )
  }
  // Echo the header, "Regressions" and "Within noise"; the per-task tables stay in the file.
  log('')
  log(renderMarkdown(report).split('\n## ').slice(0, 3).join('\n## ').trim())
  log('')
  log(`Report: ${relative(process.cwd(), markdownPath)} (commit it and attach it to the PR)`)
  log(`Raw outputs: ${relative(process.cwd(), jsonPath)} (gitignored)`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
