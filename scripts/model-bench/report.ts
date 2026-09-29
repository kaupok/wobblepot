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
 * "Regressions". The latency rule is the exception — it compares the
 * candidate's max against the route budget, not against the baseline.
 *
 * A side with a single per-run value (`--runs 1`, or a task a `--max-usd` stop
 * reached only once) has measured no range at all, so nothing it shows can be
 * "outside the range": every such difference counts as noise.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASKS, type Task } from './case-schema'
import { TASK_SPECS, type MetricDef } from './tasks'
import type { CallRecord, Role, RunResult } from './runner'

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

export interface BenchReport {
  baseline: string
  candidate: string
  date: string
  runs: number
  tasks: TaskReport[]
  regressions: Finding[]
  withinNoise: Finding[]
  partial: boolean
  plannedCalls: number
  madeCalls: number
  maxUsd: number
  cost: Record<Role, number>
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

  const delta = candidate.mean - baseline.mean
  const widerRange = Math.max(baseline.max - baseline.min, candidate.max - candidate.min)
  // One per-run value measures no range, so it cannot show a difference lies
  // outside one.
  const noise = !rangeMeasured || Math.abs(delta) <= widerRange
  const thresholdBreached = metric.regressionDrop !== undefined && delta < -metric.regressionDrop

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

  return {
    calls: calls.length,
    latencyP50Ms: p50(latencies),
    latencyMaxMs: latencies.length === 0 ? null : Math.max(...latencies),
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
  baseline: string
  candidate: string
  runs: number
  maxUsd: number
  tasks: readonly Task[]
  date: string
}): BenchReport {
  const { result, baseline, candidate, runs, maxUsd, date } = args
  const regressions: Finding[] = []
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
      }
    }

    const ops = {
      baseline: operational(byRole('baseline'), spec.budgetMs),
      candidate: operational(byRole('candidate'), spec.budgetMs),
    }

    const candidateMax = ops.candidate.latencyMaxMs
    if (candidateMax !== null && candidateMax > LATENCY_BUDGET_SHARE * spec.budgetMs) {
      regressions.push({
        task,
        text: `**${task} · Max latency:** the candidate's ${seconds(candidateMax)} is above ${LATENCY_BUDGET_SHARE * 100}% of the ${seconds(spec.budgetMs)} route budget (${spec.budgetLabel})`,
      })
    }

    return {
      task,
      budgetMs: spec.budgetMs,
      budgetLabel: spec.budgetLabel,
      metrics,
      operational: ops,
    }
  })

  return {
    baseline,
    candidate,
    date,
    runs,
    tasks,
    regressions,
    withinNoise,
    partial: result.partial,
    plannedCalls: result.plannedCalls,
    madeCalls: result.calls.length,
    maxUsd,
    cost: {
      baseline: sumCost(result.calls, 'baseline'),
      candidate: sumCost(result.calls, 'candidate'),
    },
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

  if (report.partial) {
    lines.push(
      `> **Partial run.** Measured spend passed \`--max-usd ${report.maxUsd}\` after ${report.madeCalls} of ${report.plannedCalls} planned calls, so the run stopped. Later runs and cases are missing; read every number below with that in mind.`,
      '',
    )
  }

  lines.push('## Regressions', '')
  if (report.regressions.length === 0) lines.push('None.')
  for (const f of report.regressions) lines.push(`- ${f.text}`)
  lines.push('')

  lines.push('## Within noise', '')
  lines.push(
    'The gap between the means is no larger than the wider of the two models’ run-to-run ranges, so these differences are not evidence either way.',
    '',
  )
  if (report.withinNoise.length === 0) lines.push('None.')
  for (const f of report.withinNoise) lines.push(`- ${f.text}`)
  lines.push('')

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

    const b = t.operational.baseline
    const c = t.operational.candidate
    const ms = (v: number | null) => (v === null ? '—' : seconds(v))
    lines.push(`| Operational | ${baseline} | ${candidate} |`)
    lines.push('| --- | --- | --- |')
    lines.push(`| Calls | ${b.calls} | ${c.calls} |`)
    lines.push(`| Latency p50 | ${ms(b.latencyP50Ms)} | ${ms(c.latencyP50Ms)} |`)
    // Fewer than 30 samples per task: a p95 would be the maximum, so call it that.
    lines.push(
      `| Latency max (budget ${seconds(t.budgetMs)}, \`${t.budgetLabel}\`) | ${ms(b.latencyMaxMs)} | ${ms(c.latencyMaxMs)} |`,
    )
    lines.push(`| Calls over budget | ${b.overBudget} | ${c.overBudget} |`)
    lines.push(`| Errors | ${formatErrors(b.errorsByName)} | ${formatErrors(c.errorsByName)} |`)
    lines.push(`| Truncated (\`finishReason: length\`) | ${b.truncated} | ${c.truncated} |`)
    lines.push(
      `| Tokens / call (input · output · reasoning · cache read · cache write) | ${formatTokens(b)} | ${formatTokens(c)} |`,
    )
    lines.push(
      `| Cost / call | ${b.mean ? usd(b.mean.costUsd) : '—'} | ${c.mean ? usd(c.mean.costUsd) : '—'} |`,
    )
    lines.push('')
  }

  const total = report.cost.baseline + report.cost.candidate
  lines.push(
    `**Total cost:** ${usd(total)} (${baseline} ${usd(report.cost.baseline)}, ${candidate} ${usd(report.cost.candidate)}) over ${report.madeCalls} calls${report.partial ? ' — partial run' : ''}.`,
    '',
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Local `YYYY-MM-DD`, the date the report is filed under. */
export function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Write `<date>-<baseline>-vs-<candidate>.md` (committed) and the matching
 * `.json` with every raw output (gitignored). Returns both paths.
 *
 * A second run of the same pair on the same day gets a `-2`, `-3`, … suffix
 * rather than overwriting the first: each run cost money, and the earlier
 * report may already be committed or attached to a PR.
 */
export function writeReport(
  outDir: string,
  report: BenchReport,
  result: RunResult,
): { markdownPath: string; jsonPath: string } {
  mkdirSync(outDir, { recursive: true })
  const base = `${report.date}-${report.baseline}-vs-${report.candidate}`
  let stem = base
  for (
    let n = 2;
    existsSync(join(outDir, `${stem}.md`)) || existsSync(join(outDir, `${stem}.json`));
    n++
  ) {
    stem = `${base}-${n}`
  }
  const markdownPath = join(outDir, `${stem}.md`)
  const jsonPath = join(outDir, `${stem}.json`)

  writeFileSync(markdownPath, renderMarkdown(report))
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        baseline: report.baseline,
        candidate: report.candidate,
        date: report.date,
        runs: report.runs,
        partial: report.partial,
        plannedCalls: report.plannedCalls,
        spendUsd: result.spendUsd,
        maxUsd: report.maxUsd,
        calls: result.calls,
      },
      null,
      2,
    )}\n`,
  )

  return { markdownPath, jsonPath }
}
