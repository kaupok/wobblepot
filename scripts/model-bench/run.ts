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
 *   pnpm bench:models --check [--model <id>] [--task …] [--runs 3] [--dry-run] [--max-usd 10]
 *   pnpm bench:models --record [--force] [--model <id>] [--task …] [--runs 3] [--dry-run] [--max-usd 10]
 *   pnpm bench:models --baseline golden --candidate <id> [--task …] [--runs 3] [--judge | --judge-api] …
 *   pnpm bench:models --import-verdicts results/<stem>.judge-verdicts.json
 *   pnpm bench:models --import-sample <sample file> --id <task>/<slug>
 *
 * `--check` (HON-901) runs one configuration — each task's production model
 * from `src/lib/ai/models.ts`, or `--model` for all — against absolute gates
 * on the metrics, writes `results/<date>-check-<model or production>.md`, and
 * exits 1 when a gate fails.
 *
 * `--record` (HON-902) is a `--check` that also writes `golden/<task>.json`
 * when every gate holds (or with `--force`). `--baseline golden` replays those
 * records as the baseline side and calls only the candidate: the way to
 * compare a prompt change with the prompt the golden was recorded on. See
 * `golden.ts`.
 *
 * `--judge` (HON-798) adds a blind pairwise comparison of imagine and tips
 * output. By default the prompts are exported for a Claude Code session to
 * answer (`/bench-judge`), and `--import-verdicts` folds the answers into the
 * report; `--judge-api` has `JUDGE_MODEL` answer them through the API key
 * instead. See `judge.ts` and `judge-files.ts`.
 *
 * `--import-sample` (HON-903) turns one production `[ai-sample]` line into
 * `cases/<task>/<slug>.draft.json` for a human to finish. It calls no model.
 * See `import-sample.ts`.
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
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { MODEL_PRICES } from '../../src/lib/ai/pricing'
import { TASKS, type Task } from './case-schema'
import { CASES_DIR, loadCases } from './load-cases'
import { estimateCheck, estimateRun, type ModelEstimate } from './dry-run'
import {
  runAgainstGolden,
  runBenchmark,
  runCheck,
  type CallRecord,
  type ModelFactory,
} from './runner'
import {
  buildGoldenFiles,
  compareGolden,
  GOLDEN,
  GOLDEN_DIR,
  goldenBaselineCalls,
  GoldenTaskInfoSchema,
  readGolden,
  writeGolden,
  type GoldenFile,
} from './golden'
import { TASK_SPECS } from './tasks'
import { describeDraft, importSample, ImportSampleError } from './import-sample'
import { isJudgedTask, JUDGE_MODEL, runJudge, type JudgeResult } from './judge'
import {
  exportJudgePairs,
  importJudgeVerdicts,
  JudgeVerdictsFileSchema,
  type JudgeKey,
} from './judge-files'
import {
  buildCheckReport,
  buildReport,
  checkSubject,
  localDateString,
  renderSummary,
  writeCheckReport,
  writeReport,
  writeReportFiles,
} from './report'

export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results')

const DEFAULT_RUNS = 3
const DEFAULT_MAX_USD = 10

const USAGE = `Usage: pnpm bench:models --baseline <model> --candidate <model> [--task ${TASKS.join(',')}] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}] [--judge | --judge-api]
       pnpm bench:models --check [--model <model>] [--task ${TASKS.join(',')}] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}]
       pnpm bench:models --record [--force] [--model <model>] [--task …] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}]
       pnpm bench:models --baseline ${GOLDEN} --candidate <model> [--task …] [--runs ${DEFAULT_RUNS}] [--dry-run] [--max-usd ${DEFAULT_MAX_USD}] [--judge | --judge-api]
       pnpm bench:models --import-verdicts <results/stem.judge-verdicts.json>
       pnpm bench:models --import-sample <sample file> --id <task>/<slug>`

const VERDICTS_SUFFIX = '.judge-verdicts.json'

export interface MainDeps {
  /** Defaults to `createAnthropic` with `ANTHROPIC_API_KEY`; never built under `--dry-run`. */
  modelFactory?: ModelFactory
  env?: Record<string, string | undefined>
  log?: (line: string) => void
  error?: (line: string) => void
  casesDir?: string
  outDir?: string
  /** Where `--record` writes and `--baseline golden` reads; defaults to `golden/`. */
  goldenDir?: string
  /** The short commit a golden is recorded at; defaults to `git rev-parse --short HEAD`. */
  commit?: () => string
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
        check: { type: 'boolean', default: false },
        model: { type: 'string' },
        record: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        'import-sample': { type: 'string' },
        id: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (err) {
    throw new UsageError((err as Error).message)
  }

  if (values['import-sample'] !== undefined || values.id !== undefined) {
    if (values['import-sample'] === undefined) {
      throw new UsageError('--id goes with --import-sample.')
    }
    const others = Object.entries(values)
      .filter(
        ([flag, v]) => flag !== 'import-sample' && flag !== 'id' && v !== undefined && v !== false,
      )
      .map(([flag]) => `--${flag}`)
    if (others.length > 0) {
      throw new UsageError(
        `--import-sample writes a draft case and runs nothing; it cannot be combined with ${others.join(', ')}.`,
      )
    }
    if (!values.id) {
      throw new UsageError(
        '--import-sample needs --id <task>/<slug>, e.g. --id imagine/en-pasta-for-two.',
      )
    }
    return { mode: 'import-sample' as const, samplePath: values['import-sample'], id: values.id }
  }

  if (values['import-verdicts'] !== undefined) {
    if (!values['import-verdicts'].endsWith(VERDICTS_SUFFIX)) {
      throw new UsageError(`--import-verdicts takes a \`*${VERDICTS_SUFFIX}\` file.`)
    }
    return { mode: 'import' as const, verdictsPath: values['import-verdicts'] }
  }

  // `--record` is a `--check` that also writes the golden.
  const checkMode = values.check || values.record
  if (values.force && !values.record) {
    throw new UsageError('--force goes with --record: it records a golden whose gates failed.')
  }
  if (checkMode) {
    const mixed = (['baseline', 'candidate', 'judge', 'judge-api'] as const).filter(
      (flag) => values[flag] !== undefined && values[flag] !== false,
    )
    if (mixed.length > 0) {
      throw new UsageError(
        `${values.record ? '--record' : '--check'} runs one configuration; it cannot be combined with ${mixed.map((f) => `--${f}`).join(', ')}.`,
      )
    }
    if (values.model === '') throw new UsageError('--model needs a model ID.')
  } else {
    if (values.model !== undefined) {
      throw new UsageError(
        '--model goes with --check; a comparison takes --baseline and --candidate.',
      )
    }
    if (!values.baseline || !values.candidate) {
      throw new UsageError('--baseline and --candidate are both required (or pass --check).')
    }
    if (values.judge && values['judge-api']) {
      throw new UsageError('--judge and --judge-api are alternatives; pass one.')
    }
    if (values.candidate === GOLDEN) {
      throw new UsageError(
        `--candidate takes a model ID; "${GOLDEN}" is a recorded run and can only be the --baseline.`,
      )
    }
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

  if (values.record && runs < 2) {
    throw new UsageError(
      `--record needs --runs 2 or more: a golden with one run measures no run-to-run range, so every difference against it would read as noise.`,
    )
  }

  const common = { tasks: tasks as Task[], runs, maxUsd, dryRun: values['dry-run'] }
  if (checkMode) {
    return {
      mode: 'check' as const,
      model: values.model ?? null,
      record: values.record,
      force: values.force,
      ...common,
    }
  }
  const judge: Judge = values['judge-api'] ? 'api' : values.judge ? 'claude-code' : false
  return {
    mode: 'bench' as const,
    /** Under `--baseline golden`, an omitted `--runs` takes the golden's count. */
    runsGiven: values.runs !== undefined,
    baseline: values.baseline!,
    candidate: values.candidate!,
    judge,
    ...common,
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
  /** Under `--baseline golden`: the golden header, so the re-rendered report keeps it. */
  golden: z.array(GoldenTaskInfoSchema).optional(),
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
  const raw = readJson(jsonPath, 'run file')
  if ((raw as { mode?: unknown } | null)?.mode === 'check') {
    throw new UsageError(
      `${basename(jsonPath)} is a --check run: it has one model and nothing to judge. --import-verdicts takes a comparison run.`,
    )
  }
  const run = parseJson(RunFileSchema, raw, jsonPath)
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
    golden: run.golden,
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

function describeEstimate(m: ModelEstimate): string {
  const cached = m.cacheReadTokens
    ? ` (+ ~${m.cacheWriteTokens} cache write, ~${m.cacheReadTokens} cache read)`
    : ''
  return `${m.calls} calls, ~${m.inputTokens} input${cached} + ~${m.outputTokens} output tokens, ~$${m.costUsd.toFixed(2)}`
}

/** Fails when any model lacks a price: an unpriced call costs $0 and `--max-usd` never trips. */
function unpricedModels(ids: string[], error: (line: string) => void): boolean {
  const unpriced = [...new Set(ids)].filter((id) => !MODEL_PRICES[id])
  for (const id of unpriced) {
    error(
      `No MODEL_PRICES entry for "${id}" in src/lib/ai/pricing.ts. Add its prices before benchmarking it — without one every call costs $0 and --max-usd never trips.`,
    )
  }
  return unpriced.length > 0
}

function buildModelFactory(
  deps: MainDeps,
  env: Record<string, string | undefined>,
  error: (line: string) => void,
): ModelFactory | null {
  if (deps.modelFactory) return deps.modelFactory
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    error('ANTHROPIC_API_KEY is not set. Put it in .env, or use --dry-run to estimate cost.')
    return null
  }
  const anthropic = createAnthropic({ apiKey })
  return (id) => anthropic(id)
}

function gitShortHead(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
}

/**
 * `--check`: one configuration against the gates. Exit 1 when any gate fails.
 * `--record` also writes the golden, but only from a complete run whose gates
 * all hold: a golden is the configuration later changes are measured against.
 * `--force` records over failed gates, never over a partial run, which would
 * leave cases out of the golden unnoticed. The exit code is the check's either way.
 */
async function check(
  args: {
    model: string | null
    record: boolean
    force: boolean
    tasks: Task[]
    runs: number
    maxUsd: number
    dryRun: boolean
  },
  deps: MainDeps,
  io: {
    log: (line: string) => void
    error: (line: string) => void
    env: Record<string, string | undefined>
  },
): Promise<number> {
  const { log, error, env } = io
  const modelFor = (task: Task) => args.model ?? TASK_SPECS[task].productionModel
  const subject = checkSubject(args.model)

  if (unpricedModels(args.tasks.map(modelFor), error)) return 1

  const cases = loadCases(args.tasks, deps.casesDir ?? CASES_DIR)
  if (cases.length === 0) {
    error(`No cases found for ${args.tasks.join(', ')}.`)
    return 1
  }

  if (args.dryRun) {
    const estimate = estimateCheck({ cases, runs: args.runs, modelFor })
    log(`Dry run — no API calls made.`)
    log(`Checking ${subject}:`)
    for (const task of args.tasks) log(`  ${task}: ${modelFor(task)}`)
    log(`Cases: ${estimate.caseCount} (${args.tasks.join(', ')}), runs: ${args.runs}`)
    log(`Total calls: ${estimate.totalCalls}`)
    for (const m of estimate.perModel) log(`  ${m.model}: ${describeEstimate(m)}`)
    log(`Estimated cost: ~$${estimate.totalCostUsd.toFixed(2)} (--max-usd ${args.maxUsd})`)
    if (estimate.totalCostUsd > args.maxUsd) {
      log(
        `The estimate is above --max-usd ${args.maxUsd}: a real run would likely stop early, and a partial check fails. Raise --max-usd, or lower --runs.`,
      )
    }
    if (args.record) {
      const dir = relative(process.cwd(), deps.goldenDir ?? GOLDEN_DIR)
      log(`Would record: ${args.tasks.map((t) => join(dir, `${t}.json`)).join(', ')}`)
    }
    return 0
  }

  const modelFactory = buildModelFactory(deps, env, error)
  if (!modelFactory) return 1

  log(`Checking ${subject}: ${cases.length} cases × ${args.runs} runs, cap $${args.maxUsd}`)
  const result = await runCheck({
    cases,
    modelFor,
    runs: args.runs,
    maxUsd: args.maxUsd,
    modelFactory,
    onCall: (r, p) =>
      log(
        `[${p.done}/${p.planned}] ${r.caseId} run ${r.run} ${r.model}: ${(r.latencyMs / 1000).toFixed(1)}s ${r.errorName ?? r.finishReason ?? ''} $${r.costUsd.toFixed(4)} (total $${p.spendUsd.toFixed(2)})`,
      ),
  })

  const date = localDateString((deps.today ?? (() => new Date()))())
  const report = buildCheckReport({
    result,
    model: args.model,
    modelFor,
    runs: args.runs,
    maxUsd: args.maxUsd,
    tasks: args.tasks,
    date,
  })
  const { markdownPath, jsonPath } = writeCheckReport(deps.outDir ?? RESULTS_DIR, report, result)

  if (result.partial) {
    error(
      `Stopped early: spend $${result.spendUsd.toFixed(2)} passed --max-usd ${args.maxUsd}. A partial check fails.`,
    )
  }
  log('')
  log(renderSummary(report))
  log('')
  log(`Report: ${relative(process.cwd(), markdownPath)}`)
  log(`Raw outputs: ${relative(process.cwd(), jsonPath)} (gitignored)`)

  if (args.record) {
    if (result.partial) {
      error('Golden not recorded: the run stopped early, and a golden must cover every case.')
    } else if (!report.passed && !args.force) {
      error(
        'Golden not recorded: a gate failed, and a golden is what later changes are measured against. Fix the configuration, or pass --force to record it anyway.',
      )
    } else {
      const paths = writeGolden(
        deps.goldenDir ?? GOLDEN_DIR,
        buildGoldenFiles({
          result,
          cases,
          tasks: args.tasks,
          modelFor,
          runs: args.runs,
          recordedAt: date,
          commit: (deps.commit ?? gitShortHead)(),
        }),
      )
      if (!report.passed) log('Recording over failed gates (--force).')
      for (const path of paths) log(`Golden: ${relative(process.cwd(), path)} (commit it)`)
    }
  }
  return report.passed ? 0 : 1
}

/**
 * The golden file of every task, or `null` after reporting the tasks that have
 * none or whose file does not parse.
 */
function loadGoldens(
  tasks: Task[],
  dir: string,
  error: (line: string) => void,
): GoldenFile[] | null {
  const goldens: GoldenFile[] = []
  const missing: Task[] = []
  // In the report's task order, whatever order `--task` gave.
  for (const task of TASKS.filter((t) => tasks.includes(t))) {
    let golden
    try {
      golden = readGolden(dir, task)
    } catch (err) {
      error((err as Error).message)
      return null
    }
    if (golden) goldens.push(golden)
    else missing.push(task)
  }
  const singleRun = goldens.filter((g) => g.runs < 2).map((g) => g.task)
  if (singleRun.length > 0) {
    error(
      `The golden for ${singleRun.join(', ')} has one run, so it measures no run-to-run range and every difference against it would read as noise. Re-record with \`pnpm bench:models --record --task ${singleRun.join(',')}\` (at least 2 runs).`,
    )
    return null
  }
  if (missing.length > 0) {
    error(
      `No golden for ${missing.join(', ')} in ${relative(process.cwd(), dir) || '.'}. Record one with \`pnpm bench:models --record --task ${missing.join(',')}\`, or leave ${missing.length === 1 ? 'it' : 'them'} out of --task.`,
    )
    return null
  }
  return goldens
}

/** Write the draft and say what is left to fill in; 1 when the sample cannot be imported. */
function importSampleFile(
  samplePath: string,
  id: string,
  casesDir: string,
  io: { log: (line: string) => void; error: (line: string) => void },
): number {
  try {
    const draft = importSample({ samplePath, id, casesDir })
    for (const line of describeDraft(draft, relative(process.cwd(), draft.path))) io.log(line)
    return 0
  } catch (err) {
    if (!(err instanceof ImportSampleError)) throw err
    io.error(err.message)
    return 1
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
    if (args.mode === 'import') return importVerdicts(args.verdictsPath, log)
    if (args.mode === 'import-sample') {
      return importSampleFile(args.samplePath, args.id, deps.casesDir ?? CASES_DIR, { log, error })
    }
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    error(err.message)
    error(USAGE)
    return 2
  }

  if (args.mode === 'check') return check(args, deps, { log, error, env })

  const fromGolden = args.baseline === GOLDEN

  // Before any call, and under --dry-run too: `estimateCostUsd` prices an
  // unknown model at $0, which would silently disable --max-usd. The golden's
  // calls are already priced in its file.
  const priced = [
    ...(fromGolden ? [] : [args.baseline]),
    args.candidate,
    ...(args.judge === 'api' ? [JUDGE_MODEL] : []),
  ]
  if (unpricedModels(priced, error)) return 1

  const allCases = loadCases(args.tasks, deps.casesDir ?? CASES_DIR)
  let cases = allCases
  if (cases.length === 0) {
    error(`No cases found for ${args.tasks.join(', ')}.`)
    return 1
  }

  let goldens: GoldenFile[] | undefined
  if (fromGolden) {
    const loaded = loadGoldens(args.tasks, deps.goldenDir ?? GOLDEN_DIR, error)
    if (!loaded) return 1
    goldens = loaded
    // A case the golden lacks has no baseline. Calling the candidate on it
    // would only shift the candidate's means over a different case set, so it
    // is left out and listed under "Not in golden".
    cases = cases.filter((c) => goldens!.some((g) => g.task === c.task && g.cases[c.id]))
    if (cases.length === 0) {
      error(
        `The golden has none of the selected cases. Re-record it: pnpm bench:models --record --task ${args.tasks.join(',')}`,
      )
      return 1
    }
  }
  const golden = goldens?.map((g) => compareGolden(g, allCases))

  // A candidate run past the golden's count has no baseline run to pair with:
  // the judge would drop it after it was paid for.
  let runs = args.runs
  if (goldens) {
    const goldenRuns = Math.min(...goldens.map((g) => g.runs))
    if (!args.runsGiven) runs = goldenRuns
    else if (runs > goldenRuns) {
      const short = goldens.filter((g) => g.runs < runs).map((g) => `${g.task} (${g.runs})`)
      error(
        `--runs ${runs} is more than the golden has for ${short.join(', ')}: the extra candidate runs would have no baseline to compare or judge against. Pass --runs ${goldenRuns} or fewer, or leave --runs out to match the golden.`,
      )
      return 1
    }
  }

  if (args.dryRun) {
    const estimate = estimateRun({
      cases,
      runs: runs,
      models: fromGolden ? [args.candidate] : [args.baseline, args.candidate],
      judge: args.judge === 'api',
    })
    log(`Dry run — no API calls made.`)
    if (golden) {
      log(`Baseline: golden, read from file — no calls.`)
      const missing = golden.flatMap((g) => g.notInGolden)
      if (missing.length > 0) log(`Not in golden, skipped: ${missing.join(', ')}`)
    }
    log(`Cases: ${estimate.caseCount} (${args.tasks.join(', ')}), runs: ${runs}`)
    log(`Total calls: ${estimate.totalCalls}`)
    const models = [
      ...estimate.perModel.map((m) => ({ ...m, label: m.model })),
      ...(estimate.judge ? [{ ...estimate.judge, label: `${estimate.judge.model} (judge)` }] : []),
    ]
    for (const m of models) log(`  ${m.label}: ${describeEstimate(m)}`)
    if (args.judge === 'claude-code') {
      const pairs = cases.filter((c) => isJudgedTask(c.task)).length * runs
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

  const modelFactory = buildModelFactory(deps, env, error)
  if (!modelFactory) return 1

  const onCall = (r: CallRecord, p: { done: number; planned: number; spendUsd: number }) =>
    log(
      `[${p.done}/${p.planned}] ${r.caseId} run ${r.run} ${r.model}: ${(r.latencyMs / 1000).toFixed(1)}s ${r.errorName ?? r.finishReason ?? ''} $${r.costUsd.toFixed(4)} (total $${p.spendUsd.toFixed(2)})`,
    )
  const common = { cases, runs: runs, maxUsd: args.maxUsd, modelFactory, onCall }

  let result
  if (goldens) {
    log(
      `Benchmarking golden vs ${args.candidate}: ${cases.length} cases × ${runs} runs, candidate only, cap $${args.maxUsd}`,
    )
    result = await runAgainstGolden({
      ...common,
      // Only the runs the candidate makes: a golden run with no candidate run
      // beside it would widen the baseline's range and skew its counts.
      baselineCalls: goldenBaselineCalls(goldens, cases).filter((r) => r.run <= runs),
      candidate: args.candidate,
    })
  } else {
    log(
      `Benchmarking ${args.baseline} vs ${args.candidate}: ${cases.length} cases × ${runs} runs × 2 models, cap $${args.maxUsd}`,
    )
    result = await runBenchmark({ ...common, baseline: args.baseline, candidate: args.candidate })
  }

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
    golden,
    baseline: args.baseline,
    candidate: args.candidate,
    runs: runs,
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
