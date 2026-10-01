/**
 * Model-comparison benchmark for the app's AI calls (HON-795).
 *
 * Runs a fixed set of committed, synthetic cases through two Claude models,
 * scores every output deterministically, and writes a report comparing them.
 * Manual only — it spends real money and must never run in CI.
 *
 * Usage:
 *   pnpm bench:models --baseline claude-sonnet-5 --candidate claude-sonnet-5-5 \
 *     [--task plan,recipe,imagine,review,tips] [--runs 3] [--dry-run] [--max-usd 10] \
 *     [--judge | --judge-api]
 *   pnpm bench:models --import-verdicts results/<stem>.judge-verdicts.json
 *
 * `--judge` (HON-798) adds a blind pairwise comparison of imagine and tips
 * output. By default the prompts are exported for a Claude Code session to
 * answer (`/bench-judge`), and `--import-verdicts` folds the answers into the
 * report; `--judge-api` has `JUDGE_MODEL` answer them through the API key
 * instead. See `judge.ts` and `judge-files.ts`.
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
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { MODEL_PRICES } from '../../src/lib/ai/pricing'
import { TASKS, type Task } from './case-schema'
import { CASES_DIR, loadCases } from './load-cases'
import { estimateRun } from './dry-run'
import { runBenchmark, type CallRecord, type ModelFactory } from './runner'
import { isJudgedTask, JUDGE_MODEL, runJudge, type JudgeResult } from './judge'
import {
  exportJudgePairs,
  importJudgeVerdicts,
  JudgeVerdictsFileSchema,
  type JudgeKey,
} from './judge-files'
import {
  buildReport,
  localDateString,
  renderSummary,
  writeReport,
  writeReportFiles,
} from './report'

export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results')

const DEFAULT_RUNS = 3
const DEFAULT_MAX_USD = 10

const USAGE = `Usage: pnpm bench:models --baseline <model> --candidate <model> [--task ${TASKS.join(',')}] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}] [--judge | --judge-api]
       pnpm bench:models --import-verdicts <results/stem.judge-verdicts.json>`

const VERDICTS_SUFFIX = '.judge-verdicts.json'

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

type Judge = 'claude-code' | 'api' | false

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
        judge: { type: 'boolean', default: false },
        'judge-api': { type: 'boolean', default: false },
        'import-verdicts': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (err) {
    throw new UsageError((err as Error).message)
  }

  if (values['import-verdicts'] !== undefined) {
    if (!values['import-verdicts'].endsWith(VERDICTS_SUFFIX)) {
      throw new UsageError(`--import-verdicts takes a \`*${VERDICTS_SUFFIX}\` file.`)
    }
    return { mode: 'import' as const, verdictsPath: values['import-verdicts'] }
  }

  if (!values.baseline || !values.candidate) {
    throw new UsageError('--baseline and --candidate are both required.')
  }
  if (values.judge && values['judge-api']) {
    throw new UsageError('--judge and --judge-api are alternatives; pass one.')
  }
  const judge: Judge = values['judge-api'] ? 'api' : values.judge ? 'claude-code' : false

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
    mode: 'bench' as const,
    baseline: values.baseline,
    candidate: values.candidate,
    tasks: tasks as Task[],
    runs,
    maxUsd,
    dryRun: values['dry-run'],
    judge,
  }
}

/** What `--import-verdicts` reads back from the run's `.json`. */
const RunFileSchema = z.object({
  baseline: z.string(),
  candidate: z.string(),
  date: z.string(),
  runs: z.number().int(),
  tasks: z.array(z.enum(TASKS)),
  partial: z.boolean(),
  plannedCalls: z.number().int(),
  benchSpendUsd: z.number(),
  maxUsd: z.number(),
  calls: z.array(z.custom<CallRecord>((v) => typeof v === 'object' && v !== null)),
  judgeKey: z.custom<JudgeKey>((v) => typeof v === 'object' && v !== null).optional(),
})

function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) throw new UsageError(`No ${what} at ${path}.`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new UsageError(`${what} ${path} is not valid JSON: ${(err as Error).message}`)
  }
}

function parseJson<T>(schema: z.ZodType<T>, raw: unknown, path: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new UsageError(`Invalid ${basename(path)}: ${issues}`)
  }
  return parsed.data
}

/**
 * Fold `<stem>.judge-verdicts.json` into `<stem>.md` and `<stem>.json`,
 * rewriting both in place: the report is for the same run, only now judged.
 */
function importVerdicts(verdictsPath: string, log: (line: string) => void): number {
  const dir = dirname(verdictsPath)
  const stem = basename(verdictsPath, VERDICTS_SUFFIX)
  const jsonPath = join(dir, `${stem}.json`)
  const markdownPath = join(dir, `${stem}.md`)

  const verdicts = parseJson(
    JudgeVerdictsFileSchema,
    readJson(verdictsPath, 'verdicts file'),
    verdictsPath,
  )
  const run = parseJson(RunFileSchema, readJson(jsonPath, 'run file'), jsonPath)
  if (!run.judgeKey) {
    throw new UsageError(`${basename(jsonPath)} exported no judge pairs: was it run with --judge?`)
  }

  const judge = importJudgeVerdicts(run.judgeKey, verdicts)
  const result = {
    calls: run.calls,
    plannedCalls: run.plannedCalls,
    spendUsd: run.benchSpendUsd,
    partial: run.partial,
  }
  const report = buildReport({
    result,
    judge,
    baseline: run.baseline,
    candidate: run.candidate,
    runs: run.runs,
    maxUsd: run.maxUsd,
    tasks: run.tasks,
    date: run.date,
  })
  writeReportFiles(markdownPath, jsonPath, {
    report,
    result,
    tasks: run.tasks,
    judge,
    // Kept, so the same run can be judged again.
    judgeKey: run.judgeKey,
  })

  const missing = judge.pairs.filter((p) => p.outcome === 'judge-error').length
  if (missing > 0) {
    log(`${missing} pair(s) had a verdict missing and count as judge errors.`)
  }
  log(renderSummary(report))
  log('')
  log(`Report: ${relative(process.cwd(), markdownPath)} (commit it and attach it to the PR)`)
  return 0
}

/** Returns the process exit code. */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const error = deps.error ?? ((line: string) => console.error(line))
  const env = deps.env ?? process.env

  let args
  try {
    args = parseCli(argv)
    if (args.mode === 'import') return importVerdicts(args.verdictsPath, log)
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    error(err.message)
    error(USAGE)
    return 2
  }

  // Before any call, and under --dry-run too: `estimateCostUsd` prices an
  // unknown model at $0, which would silently disable --max-usd.
  const priced = [args.baseline, args.candidate, ...(args.judge === 'api' ? [JUDGE_MODEL] : [])]
  const unpriced = priced.filter((id) => !MODEL_PRICES[id])
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
      judge: args.judge === 'api',
    })
    log(`Dry run — no API calls made.`)
    log(`Cases: ${estimate.caseCount} (${args.tasks.join(', ')}), runs: ${args.runs}`)
    log(`Total calls: ${estimate.totalCalls}`)
    const models = [
      ...estimate.perModel.map((m) => ({ ...m, label: m.model })),
      ...(estimate.judge ? [{ ...estimate.judge, label: `${estimate.judge.model} (judge)` }] : []),
    ]
    for (const m of models) {
      log(
        `  ${m.label}: ${m.calls} calls, ~${m.inputTokens} input + ~${m.outputTokens} output tokens, ~$${m.costUsd.toFixed(2)}`,
      )
    }
    if (args.judge === 'claude-code') {
      const pairs = cases.filter((c) => isJudgedTask(c.task)).length * args.runs
      log(
        `  judge: ${pairs} pairs, ${pairs * 2} prompts, exported for Claude Code (/bench-judge) — no API cost`,
      )
    }
    log(`Estimated cost: ~$${estimate.totalCostUsd.toFixed(2)} (--max-usd ${args.maxUsd})`)
    if (estimate.totalCostUsd > args.maxUsd) {
      log(
        `The estimate is above --max-usd ${args.maxUsd}: a real run would likely stop early and write a partial report. Raise --max-usd, or lower --runs.`,
      )
    }
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

  let judge: JudgeResult | undefined
  const judgeExport = args.judge === 'claude-code' ? exportJudgePairs(result, cases) : undefined
  if (args.judge === 'api') {
    log('')
    log(`Judging imagine and tips pairs with ${JUDGE_MODEL}, twice each`)
    judge = await runJudge({
      result,
      cases,
      maxUsd: args.maxUsd,
      modelFactory,
      onPair: (p, progress) =>
        log(
          `[judge ${progress.done}/${progress.planned}] ${p.caseId} run ${p.run}: ${p.outcome}${p.skipReason ? ` (${p.skipReason})` : ''} (total $${progress.spendUsd.toFixed(2)})`,
        ),
    })
  }

  const report = buildReport({
    result,
    judge,
    judgePending: judgeExport && {
      pairs: judgeExport.key.pairs.length,
      prompts: judgeExport.items.length,
    },
    baseline: args.baseline,
    candidate: args.candidate,
    runs: args.runs,
    maxUsd: args.maxUsd,
    tasks: args.tasks,
    date: localDateString((deps.today ?? (() => new Date()))()),
  })
  const outDir = deps.outDir ?? RESULTS_DIR
  const { markdownPath, jsonPath, pairsPath } = writeReport(outDir, report, result, {
    judge,
    judgeExport,
  })

  if (result.partial || judge?.partial) {
    const spend = result.spendUsd + (judge?.spendUsd ?? 0)
    error(
      `Stopped early${result.partial ? '' : ' while judging'}: spend $${spend.toFixed(2)} passed --max-usd ${args.maxUsd}. The report is marked partial.`,
    )
  }
  // The per-task tables stay in the file.
  log('')
  log(renderSummary(report))
  log('')
  log(`Report: ${relative(process.cwd(), markdownPath)} (commit it and attach it to the PR)`)
  log(`Raw outputs: ${relative(process.cwd(), jsonPath)} (gitignored)`)
  if (pairsPath) {
    log(
      `Judge pairs: ${relative(process.cwd(), pairsPath)} — run /bench-judge to judge them in Claude Code and import the verdicts`,
    )
  }
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
