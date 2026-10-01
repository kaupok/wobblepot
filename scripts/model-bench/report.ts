/**
 * Aggregates call records into the benchmark report (HON-795).
 *
 * **Per-run value:** for each metric, task, model and run, the mean over that
 * run's cases. **Summary:** the mean of the per-run values and their min–max
 * range. Sonnet 5 and 5.5 reject `temperature`, so output cannot be pinned and
 * the range is the only honest measure of run-to-run noise.
 *
 * **Noise rule:** a difference is noise when the gap between the two means is
 * no larger than the wider of the two models' ranges. Noise beats thresholds:
 * a noise-flagged difference is listed under "Within noise", never under
 * "Regressions". The latency rule holds the candidate's max to a share of
 * the route budget, and then asks what the baseline did (HON-898): both over
 * the line is the budget's problem, not the model change's, and a candidate
 * just over it while the baseline sits just under is noise when the gap is
 * inside the baseline's run-to-run range of per-run maxes. A
 * difference outside noise that crosses no threshold, in either direction, is
 * listed under "Other changes outside noise" (HON-858): most metrics have no
 * threshold, and a real move on one must still reach the summary.
 *
 * A side with a single per-run value (`--runs 1`, or a task a `--max-usd` stop
 * reached only once) has measured no range at all, so nothing it shows can be
 * "outside the range": every such difference counts as noise.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { TASKS, type Task } from './case-schema'
import { TASK_SPECS, type MetricDef } from './tasks'
import type { CallRecord, Role, RunResult } from './runner'
import {
  JUDGE_MIN_DECIDED,
  JUDGE_MIN_WIN_RATE,
  JUDGED_TASKS,
  summarizeJudge,
  type JudgeResult,
  type JudgeTaskSummary,
} from './judge'
import type { JudgeItem, JudgeKey } from './judge-files'
import type { GoldenTaskInfo } from './golden'

/** A delta, or its distance past a threshold, smaller than this is float residue. */
const FLOAT_TOLERANCE = 1e-9

/** The candidate's max latency may use at most this share of the route budget. */
export const LATENCY_BUDGET_SHARE = 0.8

export interface Summary {
  mean: number
  min: number
  max: number
}

export interface MetricComparison {
  metric: MetricDef
  baseline: Summary | null
  candidate: Summary | null
  /** Candidate mean minus baseline mean; `null` when either side has no value. */
  delta: number | null
  /** `null` when there is nothing to compare. */
  noise: boolean | null
  /** `false` when either side has fewer than two per-run values. */
  rangeMeasured: boolean
  /** The delta crosses the metric's regression threshold, noise or not. */
  thresholdBreached: boolean
}

export interface Operational {
  calls: number
  latencyP50Ms: number | null
  latencyMaxMs: number | null
  /** The max latency of each run, in run order. */
  latencyRunMaxesMs: number[]
  /** Calls the SDK retried. `null` for a run file that predates the count (HON-898). */
  retried: number | null
  overBudget: number
  errorsByName: Record<string, number>
  truncated: number
  mean: {
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    costUsd: number
  } | null
  totalCostUsd: number
}

export interface TaskReport {
  task: Task
  budgetMs: number
  budgetLabel: string
  metrics: MetricComparison[]
  operational: Record<Role, Operational>
}

export interface Finding {
  task: Task
  text: string
}

export interface JudgeReport {
  /** The judge model, or the label the verdicts file gave (`claude-code/opus`). */
  model: string
  tasks: JudgeTaskSummary[]
  /** `true` when `--max-usd` stopped the judge before every pair was judged. */
  partial: boolean
  judgedPairs: number
  plannedPairs: number
  calls: number
}

export interface BenchReport {
  baseline: string
  candidate: string
  date: string
  runs: number
  tasks: TaskReport[]
  regressions: Finding[]
  /** Outside noise but past no threshold, improvements included. */
  otherChanges: Finding[]
  withinNoise: Finding[]
  /** `--max-usd` stopped the benchmark. A judge stop is `judge.partial`. */
  partial: boolean
  plannedCalls: number
  madeCalls: number
  maxUsd: number
  /** `null` without a judge, or while the exported pairs are still unjudged. */
  judge: JudgeReport | null
  /** Set under `--judge` until `--import-verdicts` fills `judge` in. */
  judgePending: { pairs: number; prompts: number } | null
  /**
   * Set under `--baseline golden` (HON-902), one entry per task. The baseline
   * side was read from the golden, so `madeCalls` and the spend count the
   * candidate alone, and `cost.baseline` is what the golden cost to record.
   */
  golden: GoldenTaskInfo[] | null
  cost: Record<Role | 'judge', number>
}

function summarize(values: number[]): Summary | null {
  if (values.length === 0) return null
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length

/** Median by the lower-middle convention, so it is always an observed latency. */
function p50(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]!
}

/** Per-run means of one metric, skipping runs where no case produced a value. */
export function perRunValues(calls: CallRecord[], key: string): number[] {
  const byRun = new Map<number, number[]>()
  for (const call of calls) {
    const value = call.scores[key]
    if (value === null || value === undefined) continue
    const list = byRun.get(call.run) ?? []
    list.push(value)
    byRun.set(call.run, list)
  }
  return [...byRun.keys()].sort((a, b) => a - b).map((run) => mean(byRun.get(run)!)!)
}

export function compareMetric(
  metric: MetricDef,
  baselineCalls: CallRecord[],
  candidateCalls: CallRecord[],
): MetricComparison {
  const baselineRuns = perRunValues(baselineCalls, metric.key)
  const candidateRuns = perRunValues(candidateCalls, metric.key)
  const baseline = summarize(baselineRuns)
  const candidate = summarize(candidateRuns)
  const rangeMeasured = baselineRuns.length >= 2 && candidateRuns.length >= 2

  if (!baseline || !candidate) {
    return {
      metric,
      baseline,
      candidate,
      delta: null,
      noise: null,
      rangeMeasured,
      thresholdBreached: false,
    }
  }

  // Float residue is not a change: the mean of the same per-run value over 2
  // and over 3 runs can differ in the last bit, and 0.85 − 0.9 is a hair past
  // −0.05. Snap the one to zero, and let the other sit on its threshold (and
  // a gap equal to the range count as noise).
  const rawDelta = candidate.mean - baseline.mean
  const delta = Math.abs(rawDelta) < FLOAT_TOLERANCE ? 0 : rawDelta
  const widerRange = Math.max(baseline.max - baseline.min, candidate.max - candidate.min)
  // One per-run value measures no range, so it cannot show a difference lies
  // outside one.
  const noise = !rangeMeasured || Math.abs(delta) <= widerRange + FLOAT_TOLERANCE
  const thresholdBreached =
    metric.regressionDrop !== undefined && delta < -metric.regressionDrop - FLOAT_TOLERANCE

  return { metric, baseline, candidate, delta, noise, rangeMeasured, thresholdBreached }
}

function operational(calls: CallRecord[], budgetMs: number): Operational {
  const latencies = calls.map((c) => c.latencyMs)
  const errorsByName: Record<string, number> = {}
  for (const c of calls) {
    if (c.errorName) errorsByName[c.errorName] = (errorsByName[c.errorName] ?? 0) + 1
  }

  const billed = calls.filter((c) => c.usage)
  const tokenMean = (pick: (c: CallRecord) => number) => mean(billed.map(pick)) ?? 0

  const runMaxes = new Map<number, number>()
  for (const c of calls) runMaxes.set(c.run, Math.max(runMaxes.get(c.run) ?? 0, c.latencyMs))
  const counted = calls.filter((c) => c.attempts !== undefined)

  return {
    calls: calls.length,
    latencyP50Ms: p50(latencies),
    latencyMaxMs: latencies.length === 0 ? null : Math.max(...latencies),
    latencyRunMaxesMs: [...runMaxes.keys()].sort((a, b) => a - b).map((run) => runMaxes.get(run)!),
    retried: counted.length === 0 ? null : counted.filter((c) => c.attempts! > 1).length,
    overBudget: latencies.filter((ms) => ms > budgetMs).length,
    errorsByName,
    truncated: calls.filter((c) => c.finishReason === 'length').length,
    mean:
      calls.length === 0
        ? null
        : {
            inputTokens: tokenMean((c) => c.usage!.inputTokens),
            outputTokens: tokenMean((c) => c.usage!.outputTokens),
            reasoningTokens: tokenMean((c) => c.reasoningTokens ?? 0),
            cacheReadTokens: tokenMean((c) => c.usage!.cacheReadTokens),
            cacheWriteTokens: tokenMean((c) => c.usage!.cacheWriteTokens),
            // Over every call, billed or not: this is what a call costs on average.
            costUsd: mean(calls.map((c) => c.costUsd)) ?? 0,
          },
    totalCostUsd: calls.reduce((sum, c) => sum + c.costUsd, 0),
  }
}

export function buildReport(args: {
  result: RunResult
  /** Present under `--judge-api`, or once `--import-verdicts` has run. */
  judge?: JudgeResult
  /** Present under `--judge` while the pairs are still out for judging. */
  judgePending?: { pairs: number; prompts: number }
  /** Present under `--baseline golden`. */
  golden?: GoldenTaskInfo[]
  baseline: string
  candidate: string
  runs: number
  maxUsd: number
  tasks: readonly Task[]
  date: string
}): BenchReport {
  const { result, baseline, candidate, runs, maxUsd, date } = args
  const regressions: Finding[] = []
  const otherChanges: Finding[] = []
  const withinNoise: Finding[] = []

  const tasks: TaskReport[] = TASKS.filter((t) => args.tasks.includes(t)).map((task) => {
    const spec = TASK_SPECS[task]
    const taskCalls = result.calls.filter((c) => c.task === task)
    const byRole = (role: Role) => taskCalls.filter((c) => c.role === role)

    const metrics = spec.metrics.map((m) =>
      compareMetric(m, byRole('baseline'), byRole('candidate')),
    )

    for (const cmp of metrics) {
      if (cmp.delta === null || cmp.delta === 0) continue
      const line = `**${task} · ${cmp.metric.label}:** ${describeChange(cmp)}`
      if (cmp.noise) {
        const why = cmp.rangeMeasured
          ? 'inside the run-to-run range'
          : 'only one run, so no run-to-run range was measured'
        withinNoise.push({
          task,
          text: cmp.thresholdBreached
            ? `${line} — past the regression threshold, but ${why}`
            : cmp.rangeMeasured
              ? line
              : `${line} — ${why}`,
        })
      } else if (cmp.thresholdBreached) {
        regressions.push({ task, text: `${line}, outside the run-to-run range` })
      } else {
        otherChanges.push({ task, text: line })
      }
    }

    const ops = {
      baseline: operational(byRole('baseline'), spec.budgetMs),
      candidate: operational(byRole('candidate'), spec.budgetMs),
    }

    const latency = latencyFinding(task, spec, ops)
    if (latency) {
      const list = { regression: regressions, other: otherChanges, noise: withinNoise }
      list[latency.list].push({ task, text: latency.text })
    }

    const reasoning = reasoningAsymmetry(task, ops)
    if (reasoning) otherChanges.push({ task, text: reasoning })

    return {
      task,
      budgetMs: spec.budgetMs,
      budgetLabel: spec.budgetLabel,
      metrics,
      operational: ops,
    }
  })

  const judge = args.judge ? judgeReport(args.judge, args.tasks) : null
  for (const s of judge?.tasks ?? []) {
    if (s.status !== 'regression') continue
    regressions.push({
      task: s.task,
      text: `**${s.task} · Judge win rate:** ${formatWinRate(s)} is under ${JUDGE_MIN_WIN_RATE * 100}%`,
    })
  }

  return {
    baseline,
    candidate,
    date,
    runs,
    tasks,
    regressions,
    otherChanges,
    withinNoise,
    partial: result.partial,
    plannedCalls: result.plannedCalls,
    madeCalls: args.golden
      ? result.calls.filter((c) => c.role === 'candidate').length
      : result.calls.length,
    maxUsd,
    judge,
    judgePending: args.judgePending ?? null,
    golden: args.golden ?? null,
    cost: {
      baseline: sumCost(result.calls, 'baseline'),
      candidate: sumCost(result.calls, 'candidate'),
      judge: args.judge?.spendUsd ?? 0,
    },
  }
}

const budgetLine = (spec: { budgetMs: number }) => LATENCY_BUDGET_SHARE * spec.budgetMs

function budgetText(spec: { budgetMs: number; budgetLabel: string }): string {
  return `${LATENCY_BUDGET_SHARE * 100}% of the ${seconds(spec.budgetMs)} route budget (${spec.budgetLabel})`
}

/** `, N call(s) retried and latency includes the retries`, or nothing. */
function retriedNote(...ops: Operational[]): string {
  const retried = ops.reduce((n, op) => n + (op.retried ?? 0), 0)
  return retried === 0 ? '' : `; ${retried} call(s) retried, and latency includes the retries`
}

/**
 * The candidate's max over `LATENCY_BUDGET_SHARE` of the budget (HON-898):
 *
 * - candidate over the full budget and the baseline not → a regression,
 *   checked first: the route would time out on it;
 * - baseline over the line too → "Other changes": the budget is the problem;
 * - baseline under, the candidate inside the full budget, and the gap between
 *   the maxes inside the range of the baseline's per-run maxes → "Within
 *   noise". Only the baseline's range: the candidate's own range contains the
 *   outlier being judged, so measuring against it would excuse any spike;
 * - otherwise → a regression. With a single run on either side no range is
 *   measured, and nothing can show the crossing is noise.
 */
function latencyFinding(
  task: Task,
  spec: { budgetMs: number; budgetLabel: string },
  ops: Record<Role, Operational>,
): { list: 'regression' | 'other' | 'noise'; text: string } | null {
  const line = budgetLine(spec)
  const candidateMax = ops.candidate.latencyMaxMs
  if (candidateMax === null || candidateMax <= line) return null

  const head = `**${task} · Max latency:**`
  const note = retriedNote(ops.baseline, ops.candidate)
  const baselineMax = ops.baseline.latencyMaxMs
  if (baselineMax === null) {
    return {
      list: 'regression',
      text: `${head} the candidate's ${seconds(candidateMax)} is above ${budgetText(spec)}${note}`,
    }
  }
  // Past the full budget the route times out. A candidate that newly gets
  // there is a regression whatever else the baseline did.
  if (candidateMax > spec.budgetMs && baselineMax <= spec.budgetMs) {
    return {
      list: 'regression',
      text: `${head} the candidate's ${seconds(candidateMax)} is over the full ${seconds(spec.budgetMs)} route budget (${spec.budgetLabel}), and the baseline's ${seconds(baselineMax)} is not${note}`,
    }
  }
  if (baselineMax > line) {
    return {
      list: 'other',
      text: `${head} both models are above ${budgetText(spec)} (baseline ${seconds(baselineMax)}, candidate ${seconds(candidateMax)}): the budget, not the model change, is the problem${note}`,
    }
  }

  const b = ops.baseline.latencyRunMaxesMs
  const c = ops.candidate.latencyRunMaxesMs
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
  const inRange =
    b.length >= 2 &&
    c.length >= 2 &&
    candidateMax <= spec.budgetMs &&
    candidateMax - baselineMax <= spread(b) + FLOAT_TOLERANCE
  if (inRange) {
    const runs = (v: number[]) => `${seconds(Math.min(...v))}–${seconds(Math.max(...v))}`
    return {
      list: 'noise',
      text: `${head} the candidate's ${seconds(candidateMax)} is above ${budgetText(spec)} and the baseline's ${seconds(baselineMax)} is not, but the gap is inside the baseline's run-to-run range (its per-run maxes ${runs(b)}): both are close to the budget${note}`,
    }
  }
  return {
    list: 'regression',
    text: `${head} the candidate's ${seconds(candidateMax)} is above ${budgetText(spec)}, and the baseline's ${seconds(baselineMax)} is not, outside the baseline's run-to-run range${note}`,
  }
}

/**
 * One model reasons on a task and the other reports no reasoning tokens
 * (HON-899). The benchmark sends no thinking configuration, so this is each
 * model's default, and the task's latency and cost deltas include it.
 */
function reasoningAsymmetry(task: Task, ops: Record<Role, Operational>): string | null {
  const b = ops.baseline.mean?.reasoningTokens
  const c = ops.candidate.mean?.reasoningTokens
  if (b === undefined || c === undefined) return null
  const [reasons, does, doesNot] =
    c > 0 && b === 0
      ? [c, 'candidate', 'baseline']
      : b > 0 && c === 0
        ? [b, 'baseline', 'candidate']
        : [null, '', '']
  if (reasons === null) return null
  return `**${task} · Reasoning:** the ${does} reasons (${Math.round(reasons)} tokens/call), the ${doesNot} does not; latency and cost deltas on this task include that`
}

function judgeReport(judge: JudgeResult, tasks: readonly Task[]): JudgeReport {
  return {
    model: judge.judge,
    tasks: summarizeJudge(
      judge.pairs,
      JUDGED_TASKS.filter((t) => tasks.includes(t)),
    ),
    partial: judge.partial,
    judgedPairs: judge.pairs.length,
    plannedPairs: judge.plannedPairs,
    calls: judge.pairs.reduce((n, p) => n + p.calls.length, 0),
  }
}

const sumCost = (calls: CallRecord[], role: Role) =>
  calls.filter((c) => c.role === role).reduce((sum, c) => sum + c.costUsd, 0)

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`

function formatValue(metric: MetricDef, value: number): string {
  return metric.format === 'percent' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2)
}

function formatSummary(metric: MetricDef, s: Summary | null): string {
  if (!s) return '—'
  const range =
    s.min === s.max ? '' : ` (${formatValue(metric, s.min)}–${formatValue(metric, s.max)})`
  return `${formatValue(metric, s.mean)}${range}`
}

function formatDelta(metric: MetricDef, delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  const abs = Math.abs(delta)
  return metric.format === 'percent'
    ? `${sign}${(abs * 100).toFixed(1)} pp`
    : `${sign}${abs.toFixed(2)}`
}

function describeChange(cmp: MetricComparison): string {
  return `${formatSummary(cmp.metric, cmp.baseline)} → ${formatSummary(cmp.metric, cmp.candidate)} (${formatDelta(cmp.metric, cmp.delta)})`
}

function formatWinRate(s: JudgeTaskSummary): string {
  if (s.winRate === null) return '—'
  return `${(s.winRate * 100).toFixed(1)}% (${s.wins} won of ${s.decided} decided)`
}

function formatErrors(errors: Record<string, number>): string {
  const entries = Object.entries(errors)
  return entries.length === 0 ? 'none' : entries.map(([name, n]) => `${name} × ${n}`).join(', ')
}

function formatTokens(op: Operational): string {
  if (!op.mean) return '—'
  const m = op.mean
  return [m.inputTokens, m.outputTokens, m.reasoningTokens, m.cacheReadTokens, m.cacheWriteTokens]
    .map((n) => Math.round(n).toString())
    .join(' · ')
}

export function renderMarkdown(report: BenchReport): string {
  const { baseline, candidate } = report
  const lines: string[] = []

  lines.push(`# Model benchmark: ${baseline} vs ${candidate}`, '')
  lines.push(
    `${report.date} · ${report.runs} run(s) · tasks: ${report.tasks.map((t) => t.task).join(', ')} · ${report.madeCalls} calls`,
    '',
  )
  if (report.golden) lines.push(...renderGoldenHeader(report.golden))

  if (report.partial) {
    lines.push(
      `> **Partial run.** Measured spend passed \`--max-usd ${report.maxUsd}\` after ${report.madeCalls} of ${report.plannedCalls} planned calls, so the run stopped. Later runs and cases are missing; read every number below with that in mind.`,
      '',
    )
  } else if (report.judge?.partial) {
    lines.push(
      `> **Partial run.** Measured spend passed \`--max-usd ${report.maxUsd}\` while judging, after ${report.judge.judgedPairs} of ${report.judge.plannedPairs} pairs. Every benchmark call was made; the judge's counts are missing later pairs.`,
      '',
    )
  }

  const notInGolden = report.golden?.flatMap((g) => g.notInGolden) ?? []
  if (notInGolden.length > 0) {
    lines.push('## Not in golden', '')
    lines.push(
      'These cases are in the case set but not in the golden, so they have no baseline and were not run: re-record to include them (`pnpm bench:models --record`).',
      '',
    )
    for (const id of notInGolden) lines.push(`- \`${id}\` — re-record to include it`)
    lines.push('')
  }

  lines.push('## Regressions', '')
  if (report.regressions.length === 0) lines.push('None.')
  for (const f of report.regressions) lines.push(`- ${f.text}`)
  lines.push('')

  lines.push('## Other changes outside noise', '')
  lines.push(
    'The gap between the means is larger than both models’ run-to-run ranges, but crosses no regression threshold: the metric has none, the change is smaller than its threshold, or it goes the better way. These moved for real, so read each change for the worse — a lower rate, or more out-of-pool meal IDs — as a possible regression.',
    '',
  )
  if (report.otherChanges.length === 0) lines.push('None.')
  for (const f of report.otherChanges) lines.push(`- ${f.text}`)
  lines.push('')

  lines.push('## Within noise', '')
  lines.push(
    'The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.',
    '',
  )
  if (report.withinNoise.length === 0) lines.push('None.')
  for (const f of report.withinNoise) lines.push(`- ${f.text}`)
  lines.push('')

  if (report.judge) lines.push(...renderJudge(report.judge, candidate))
  else if (report.judgePending) {
    const { pairs, prompts } = report.judgePending
    lines.push(
      '## Judge',
      '',
      `**Pending.** ${pairs} pair(s), ${prompts} prompt(s), are exported to the \`.judge-pairs.json\` beside this report for judging in Claude Code. Run \`/bench-judge\`, which answers them and imports the verdicts here (\`pnpm bench:models --import-verdicts <that>.judge-verdicts.json\`).`,
      '',
    )
  }

  for (const t of report.tasks) {
    lines.push(`## ${t.task}`, '')
    lines.push(`| Metric | ${baseline} | ${candidate} | Delta | Noise |`)
    lines.push('| --- | --- | --- | --- | --- |')
    for (const cmp of t.metrics) {
      const noise =
        cmp.noise === null
          ? '—'
          : !cmp.rangeMeasured
            ? 'noise (1 run)'
            : cmp.noise
              ? 'noise'
              : 'outside range'
      lines.push(
        `| ${cmp.metric.label} | ${formatSummary(cmp.metric, cmp.baseline)} | ${formatSummary(cmp.metric, cmp.candidate)} | ${formatDelta(cmp.metric, cmp.delta)} | ${noise} |`,
      )
    }
    lines.push('')

    lines.push(
      ...renderOperational(t, [
        [baseline, t.operational.baseline],
        [candidate, t.operational.candidate],
      ]),
    )
  }

  const judgeCost = report.judge
    ? `, judge ${report.judge.model} ${usd(report.cost.judge)} over ${report.judge.calls} calls`
    : ''
  const partialNote = report.partial || report.judge?.partial ? ' — partial run' : ''
  if (report.golden) {
    // The golden's calls were paid for when it was recorded, not by this run.
    const total = report.cost.candidate + report.cost.judge
    lines.push(
      `**Total cost:** ${usd(total)} (${candidate} ${usd(report.cost.candidate)} over ${report.madeCalls} calls${judgeCost})${partialNote}. The golden's ${usd(report.cost.baseline)} was spent when it was recorded.`,
      '',
    )
  } else {
    const total = report.cost.baseline + report.cost.candidate + report.cost.judge
    lines.push(
      `**Total cost:** ${usd(total)} (${baseline} ${usd(report.cost.baseline)}, ${candidate} ${usd(report.cost.candidate)} over ${report.madeCalls} calls${judgeCost})${partialNote}.`,
      '',
    )
  }

  return lines.join('\n')
}

/**
 * Where the golden came from, and which tasks' prompts have changed since:
 * the line a prompt-change PR is read for (HON-902). One provenance line when
 * every task was recorded together, one per task otherwise.
 */
function renderGoldenHeader(golden: GoldenTaskInfo[]): string[] {
  const provenance = (g: GoldenTaskInfo) =>
    `\`${g.model}\` recorded ${g.recordedAt} at \`${g.commit}\`, ${g.runs} run(s)`
  const distinct = new Set(golden.map(provenance))
  const source =
    distinct.size === 1
      ? `**Baseline:** golden — ${provenance(golden[0]!)}.`
      : `**Baseline:** golden — ${golden.map((g) => `${g.task} ${provenance(g)}`).join('; ')}.`
  const prompts = golden.map((g) =>
    g.cases === 0
      ? `${g.task}: no case in the golden`
      : g.promptChanged === 0
        ? `${g.task}: unchanged`
        : `${g.task}: prompt changed for ${g.promptChanged} of ${g.cases} cases`,
  )
  return [source, '', `**Prompts since the golden:** ${prompts.join('; ')}.`, '']
}

/** The operational table for one task, one column per model. */
function renderOperational(
  t: { budgetMs: number; budgetLabel: string },
  columns: [string, Operational][],
): string[] {
  const ms = (v: number | null) => (v === null ? '—' : seconds(v))
  const row = (label: string, cell: (op: Operational) => string | number) =>
    `| ${label} | ${columns.map(([, op]) => cell(op)).join(' | ')} |`
  return [
    `| Operational | ${columns.map(([name]) => name).join(' | ')} |`,
    `| --- | ${columns.map(() => '---').join(' | ')} |`,
    row('Calls', (op) => op.calls),
    row('Latency p50', (op) => ms(op.latencyP50Ms)),
    // Fewer than 30 samples per task: a p95 would be the maximum, so call it that.
    row(`Latency max (budget ${seconds(t.budgetMs)}, \`${t.budgetLabel}\`)`, (op) =>
      ms(op.latencyMaxMs),
    ),
    row('Calls over budget', (op) => op.overBudget),
    // Latency is timed around `generateObject`, so it includes the SDK's retries.
    row('Calls retried (latency includes retries)', (op) => op.retried ?? 'not recorded'),
    row('Errors', (op) => formatErrors(op.errorsByName)),
    row('Truncated (`finishReason: length`)', (op) => op.truncated),
    row('Tokens / call (input · output · reasoning · cache read · cache write)', formatTokens),
    row('Cost / call', (op) => (op.mean ? usd(op.mean.costUsd) : '—')),
    '',
  ]
}

/**
 * The markdown up to the first per-task table: the header, the three lists and
 * any Judge section, or for `--check` the result and the Gates table. `run.ts`
 * echoes it to the console.
 */
export function renderSummary(report: BenchReport | CheckReport): string {
  const markdown = 'gates' in report ? renderCheckMarkdown(report) : renderMarkdown(report)
  const sections = markdown.split('\n## ')
  const firstTask = sections.findIndex((s) => report.tasks.some((t) => s.startsWith(`${t.task}\n`)))
  return sections
    .slice(0, firstTask === -1 ? undefined : firstTask)
    .join('\n## ')
    .trim()
}

function renderJudge(judge: JudgeReport, candidate: string): string[] {
  const lines = ['## Judge', '']
  lines.push(
    `Counts are for ${candidate}. ${judge.model} compared the two models' output for each case and run without knowing which wrote which, once in each order. A **win** or **loss** needs both orders to agree; a disagreement, or a \`tie\` from either, is a **tie**. Win rate is wins ÷ (wins + losses): ties are left out and shown beside it. A win rate under ${JUDGE_MIN_WIN_RATE * 100}% over at least ${JUDGE_MIN_DECIDED} decided pairs is a regression. A pair is skipped when either model's call errored.`,
    '',
  )
  if (judge.partial && judge.judgedPairs === 0) {
    lines.push(
      `**Not judged:** spend had already passed \`--max-usd\` before the first of ${judge.plannedPairs} pairs, so no judge call was made.`,
      '',
    )
    return lines
  }
  if (judge.tasks.length === 0) {
    lines.push(`No judged task in this run: the judge covers ${JUDGED_TASKS.join(' and ')}.`, '')
    return lines
  }

  lines.push('| Task | Wins | Ties | Losses | Skipped | Judge errors | Win rate |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const s of judge.tasks) {
    const rate =
      s.status === 'too-few'
        ? `too few decided pairs (${s.decided} of ${JUDGE_MIN_DECIDED})`
        : formatWinRate(s)
    lines.push(
      `| ${s.task} | ${s.wins} | ${s.ties} | ${s.losses} | ${s.skipped} | ${s.judgeErrors} | ${rate} |`,
    )
  }
  lines.push('')
  return lines
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Local `YYYY-MM-DD`, the date the report is filed under. */
export function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface ReportFiles {
  markdownPath: string
  jsonPath: string
  /** Present when the run exported judge pairs. */
  pairsPath?: string
}

export interface WriteReportExtras {
  judge?: JudgeResult
  /** From `exportJudgePairs`; writes the pairs file and fills in its file names. */
  judgeExport?: { items: JudgeItem[]; key: JudgeKey }
  /** A key read back from the run file, kept so the run can be judged again. */
  judgeKey?: JudgeKey
}

/**
 * `base`, or `base-2`, `base-3`, … when a report by that name exists: each run
 * cost money, and the earlier report may already be committed or attached to
 * a PR. Creates `outDir`.
 */
function uniqueStem(outDir: string, base: string): string {
  mkdirSync(outDir, { recursive: true })
  let stem = base
  for (
    let n = 2;
    existsSync(join(outDir, `${stem}.md`)) || existsSync(join(outDir, `${stem}.json`));
    n++
  ) {
    stem = `${base}-${n}`
  }
  return stem
}

/**
 * Write `<date>-<baseline>-vs-<candidate>.md` (committed) and the matching
 * `.json` with every raw output (gitignored), plus `.judge-pairs.json` when
 * the run exported its judge prompts. Returns the paths.
 *
 * A second run of the same pair on the same day gets a `-2`, `-3`, … suffix
 * rather than overwriting the first (`uniqueStem`).
 */
export function writeReport(
  outDir: string,
  report: BenchReport,
  result: RunResult,
  extras: WriteReportExtras = {},
): ReportFiles {
  const stem = uniqueStem(outDir, `${report.date}-${report.baseline}-vs-${report.candidate}`)
  return writeReportFiles(join(outDir, `${stem}.md`), join(outDir, `${stem}.json`), {
    report,
    result,
    tasks: report.tasks.map((t) => t.task),
    ...extras,
  })
}

/**
 * Write (or, after `--import-verdicts`, rewrite in place) the report files at
 * the given paths. The `.json` keeps everything a later import needs to
 * rebuild the report: the calls, the run's arguments and the judge key.
 */
export function writeReportFiles(
  markdownPath: string,
  jsonPath: string,
  args: { report: BenchReport; result: RunResult; tasks: readonly Task[] } & WriteReportExtras,
): ReportFiles {
  const { report, result, tasks, judge, judgeExport } = args
  const stem = basename(jsonPath, '.json')
  const dir = dirname(jsonPath)

  let pairsPath: string | undefined
  let judgeKey = args.judgeKey
  if (judgeExport) {
    pairsPath = join(dir, `${stem}.judge-pairs.json`)
    const verdictsFile = `${stem}.judge-verdicts.json`
    judgeKey = { ...judgeExport.key, pairsFile: basename(pairsPath), verdictsFile }
    writeFileSync(
      pairsPath,
      `${JSON.stringify({ verdictsFile, items: judgeExport.items }, null, 2)}\n`,
    )
  }

  writeFileSync(markdownPath, renderMarkdown(report))
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        baseline: report.baseline,
        candidate: report.candidate,
        date: report.date,
        runs: report.runs,
        tasks,
        partial: report.partial,
        plannedCalls: report.plannedCalls,
        /** Benchmark calls only; `spendUsd` adds the API judge. */
        benchSpendUsd: result.spendUsd,
        spendUsd: result.spendUsd + (judge?.spendUsd ?? 0),
        maxUsd: report.maxUsd,
        ...(report.golden && { golden: report.golden }),
        regressions: report.regressions,
        otherChanges: report.otherChanges,
        withinNoise: report.withinNoise,
        calls: result.calls,
        // Both verdicts and both reasons for every pair.
        ...(judge && {
          judge: {
            model: judge.judge,
            spendUsd: judge.spendUsd,
            partial: judge.partial,
            plannedPairs: judge.plannedPairs,
            pairs: judge.pairs,
          },
        }),
        // Which role each exported prompt showed as A. The judging session
        // reads the pairs file, never this.
        ...(judgeKey && { judgeKey }),
      },
      null,
      2,
    )}\n`,
  )

  return { markdownPath, jsonPath, ...(pairsPath && { pairsPath }) }
}

// ---------------------------------------------------------------------------
// --check (HON-901)
// ---------------------------------------------------------------------------

export type GateStatus = 'pass' | 'fail' | 'not measured'

export interface GateResult {
  task: Task
  /** The metric's label, or `Max latency`. */
  label: string
  observed: string
  threshold: string
  status: GateStatus
}

export interface CheckTaskReport {
  task: Task
  model: string
  budgetMs: number
  budgetLabel: string
  metrics: { metric: MetricDef; summary: Summary | null }[]
  operational: Operational
}

export interface CheckReport {
  /** The `--model` given, or `null` for the production configuration. */
  model: string | null
  date: string
  runs: number
  tasks: CheckTaskReport[]
  gates: GateResult[]
  /** Every gate holds and the run was not stopped early. */
  passed: boolean
  partial: boolean
  plannedCalls: number
  madeCalls: number
  maxUsd: number
  costUsd: number
}

function gateThreshold(metric: MetricDef): string {
  const gate = metric.gate!
  return 'min' in gate ? `≥ ${formatValue(metric, gate.min)}` : `≤ ${formatValue(metric, gate.max)}`
}

/**
 * Hold the mean over all runs to the gate. A metric no call produced a value
 * for — nothing in the case set to measure — passes as not measured.
 */
export function evaluateGate(metric: MetricDef, summary: Summary | null): GateStatus {
  const gate = metric.gate
  if (!gate || !summary) return gate ? 'not measured' : 'pass'
  const ok =
    'min' in gate
      ? summary.mean >= gate.min - FLOAT_TOLERANCE
      : summary.mean <= gate.max + FLOAT_TOLERANCE
  return ok ? 'pass' : 'fail'
}

/**
 * One configuration against the absolute gates: every gated metric's mean over
 * all runs, and each task's max latency against `LATENCY_BUDGET_SHARE` of its
 * route budget. A partial run fails: the tasks it never reached were not checked.
 */
export function buildCheckReport(args: {
  result: RunResult
  model: string | null
  modelFor: (task: Task) => string
  runs: number
  maxUsd: number
  tasks: readonly Task[]
  date: string
}): CheckReport {
  const { result, model, modelFor, runs, maxUsd, date } = args
  const gates: GateResult[] = []

  const tasks = TASKS.filter((t) => args.tasks.includes(t)).map((task): CheckTaskReport => {
    const spec = TASK_SPECS[task]
    const calls = result.calls.filter((c) => c.task === task)
    const metrics = spec.metrics.map((metric) => ({
      metric,
      summary: summarize(perRunValues(calls, metric.key)),
    }))

    for (const { metric, summary } of metrics) {
      if (!metric.gate) continue
      gates.push({
        task,
        label: metric.label,
        observed: formatSummary(metric, summary),
        threshold: gateThreshold(metric),
        status: evaluateGate(metric, summary),
      })
    }

    const ops = operational(calls, spec.budgetMs)
    const line = budgetLine(spec)
    gates.push({
      task,
      label: 'Max latency',
      observed:
        ops.latencyMaxMs === null
          ? '—'
          : `${seconds(ops.latencyMaxMs)}${ops.retried ? ` (${ops.retried} call(s) retried)` : ''}`,
      threshold: `≤ ${seconds(line)} (${LATENCY_BUDGET_SHARE * 100}% of \`${spec.budgetLabel}\`)`,
      status:
        ops.latencyMaxMs === null ? 'not measured' : ops.latencyMaxMs <= line ? 'pass' : 'fail',
    })

    return {
      task,
      model: modelFor(task),
      budgetMs: spec.budgetMs,
      budgetLabel: spec.budgetLabel,
      metrics,
      operational: ops,
    }
  })

  return {
    model,
    date,
    runs,
    tasks,
    gates,
    passed: !result.partial && gates.every((g) => g.status !== 'fail'),
    partial: result.partial,
    plannedCalls: result.plannedCalls,
    madeCalls: result.calls.length,
    maxUsd,
    costUsd: result.spendUsd,
  }
}

export const checkSubject = (model: string | null) => model ?? 'production configuration'

export function renderCheckMarkdown(report: CheckReport): string {
  const lines: string[] = []
  lines.push(`# AI eval check: ${checkSubject(report.model)}`, '')
  lines.push(
    `${report.date} · ${report.runs} run(s) · tasks: ${report.tasks.map((t) => t.task).join(', ')} · ${report.madeCalls} calls`,
    '',
  )
  lines.push(`Models: ${report.tasks.map((t) => `${t.task} \`${t.model}\``).join(' · ')}`, '')

  if (report.partial) {
    lines.push(
      `> **Partial run.** Measured spend passed \`--max-usd ${report.maxUsd}\` after ${report.madeCalls} of ${report.plannedCalls} planned calls, so the run stopped. Later runs and cases were never checked, so the check fails whatever the gates below say.`,
      '',
    )
  }

  const failed = report.gates.filter((g) => g.status === 'fail')
  lines.push('## Result', '')
  if (report.passed) {
    lines.push(`**Pass.** All ${report.gates.length} gates hold.`)
  } else if (failed.length === 0) {
    lines.push('**Fail.** The run stopped early; every gate it measured holds.')
  } else {
    lines.push(`**Fail.** ${failed.length} of ${report.gates.length} gates failed:`, '')
    for (const g of failed) {
      lines.push(`- **${g.task} · ${g.label}:** ${g.observed}, needs ${g.threshold}`)
    }
  }
  lines.push('')

  lines.push('## Gates', '')
  lines.push(
    `Each gate holds a metric's mean over all runs, with the run-to-run range in brackets, to an absolute threshold, and each task's slowest call to ${LATENCY_BUDGET_SHARE * 100}% of its route budget. A metric no case in this set measures passes as _not measured_.`,
    '',
  )
  lines.push('| Task | Gate | Observed | Threshold | Result |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const g of report.gates) {
    const result = g.status === 'fail' ? '**fail**' : g.status
    lines.push(`| ${g.task} | ${g.label} | ${g.observed} | ${g.threshold} | ${result} |`)
  }
  lines.push('')

  for (const t of report.tasks) {
    lines.push(`## ${t.task}`, '')
    lines.push(`| Metric | ${t.model} | Gate |`)
    lines.push('| --- | --- | --- |')
    for (const { metric, summary } of t.metrics) {
      lines.push(
        `| ${metric.label} | ${formatSummary(metric, summary)} | ${metric.gate ? gateThreshold(metric) : '—'} |`,
      )
    }
    lines.push('')
    lines.push(...renderOperational(t, [[t.model, t.operational]]))
  }

  lines.push(
    `**Total cost:** ${usd(report.costUsd)} over ${report.madeCalls} calls${report.partial ? ' — partial run' : ''}.`,
    '',
  )
  return lines.join('\n')
}

/**
 * Write `<date>-check-<model or "production">.md` and the matching `.json`,
 * with the same `-2` suffix rule as a comparison. The `.json` carries
 * `mode: 'check'`, which `--import-verdicts` refuses.
 */
export function writeCheckReport(
  outDir: string,
  report: CheckReport,
  result: RunResult,
): ReportFiles {
  const stem = uniqueStem(outDir, `${report.date}-check-${report.model ?? 'production'}`)
  const markdownPath = join(outDir, `${stem}.md`)
  const jsonPath = join(outDir, `${stem}.json`)
  writeFileSync(markdownPath, renderCheckMarkdown(report))
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        mode: 'check',
        model: report.model,
        models: Object.fromEntries(report.tasks.map((t) => [t.task, t.model])),
        date: report.date,
        runs: report.runs,
        tasks: report.tasks.map((t) => t.task),
        passed: report.passed,
        partial: report.partial,
        plannedCalls: report.plannedCalls,
        spendUsd: result.spendUsd,
        maxUsd: report.maxUsd,
        gates: report.gates,
        calls: result.calls,
      },
      null,
      2,
    )}\n`,
  )
  return { markdownPath, jsonPath }
}
