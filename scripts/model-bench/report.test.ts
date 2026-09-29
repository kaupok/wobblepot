// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Task } from './case-schema'
import { buildReport, compareMetric, perRunValues, renderMarkdown } from './report'
import type { CallRecord, Role, RunResult } from './runner'
import { TASK_SPECS } from './tasks'

function call(
  task: Task,
  role: Role,
  run: number,
  scores: CallRecord['scores'],
  extra: Partial<CallRecord> = {},
): CallRecord {
  return {
    caseId: `${task}/case`,
    task,
    run,
    role,
    model: role === 'baseline' ? 'claude-sonnet-5' : 'claude-sonnet-5-5',
    position: 1,
    latencyMs: 5_000,
    finishReason: 'stop',
    usage: {
      model: 'm',
      inputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500,
      usageMissing: false,
    },
    reasoningTokens: 100,
    costUsd: 0.007,
    errorName: null,
    errorMessage: null,
    output: null,
    scores,
    ...extra,
  }
}

/** One call per run for each role, with the given per-run values of one metric. */
function series(task: Task, key: string, baseline: number[], candidate: number[]): CallRecord[] {
  return [
    ...baseline.map((v, i) => call(task, 'baseline', i + 1, { [key]: v })),
    ...candidate.map((v, i) => call(task, 'candidate', i + 1, { [key]: v })),
  ]
}

function result(calls: CallRecord[], partial = false): RunResult {
  return { calls, plannedCalls: partial ? calls.length * 2 : calls.length, spendUsd: 0, partial }
}

const report = (calls: CallRecord[], tasks: Task[], partial = false) =>
  buildReport({
    result: result(calls, partial),
    baseline: 'claude-sonnet-5',
    candidate: 'claude-sonnet-5-5',
    runs: 3,
    maxUsd: 10,
    tasks,
    date: '2026-10-01',
  })

const recall = TASK_SPECS.recipe.metrics.find((m) => m.key === 'recall')!

describe('perRunValues', () => {
  it('averages each run over its cases and skips null scores', () => {
    const calls = [
      call('recipe', 'baseline', 1, { recall: 1 }),
      call('recipe', 'baseline', 1, { recall: 0.5 }),
      call('recipe', 'baseline', 2, { recall: null }),
      call('recipe', 'baseline', 2, { recall: 0.25 }),
    ]
    expect(perRunValues(calls, 'recall')).toEqual([0.75, 0.25])
  })
})

describe('the noise rule', () => {
  it('flags a gap no larger than the wider run-to-run range as noise', () => {
    // Means 0.80 and 0.75: a 5-point gap inside the baseline's 20-point range.
    const calls = series('recipe', 'recall', [0.7, 0.8, 0.9], [0.74, 0.75, 0.76])
    const cmp = compareMetric(
      recall,
      calls.filter((c) => c.role === 'baseline'),
      calls.filter((c) => c.role === 'candidate'),
    )
    expect(cmp.delta).toBeCloseTo(-0.05)
    expect(cmp.noise).toBe(true)
  })

  it('does not flag a gap wider than both ranges', () => {
    const calls = series('recipe', 'recall', [0.9, 0.9, 0.91], [0.7, 0.71, 0.7])
    const cmp = compareMetric(
      recall,
      calls.filter((c) => c.role === 'baseline'),
      calls.filter((c) => c.role === 'candidate'),
    )
    expect(cmp.noise).toBe(false)
    expect(cmp.thresholdBreached).toBe(true)
  })
})

describe('buildReport', () => {
  it('lists a threshold-crossing drop inside the range under "Within noise", and one outside it under "Regressions"', () => {
    const calls = [
      // Recall drops 8 points, past the 5-point threshold, but the baseline
      // swings 20 points between runs: noise.
      ...series('recipe', 'recall', [0.7, 0.8, 0.9], [0.7, 0.72, 0.74]).map((c) => ({
        ...c,
        scores: { ...c.scores, precision: c.role === 'baseline' ? 1 : 0.8 },
      })),
    ]
    // Precision drops 20 points with no run-to-run variation at all: a regression.
    const r = report(calls, ['recipe'])

    expect(r.withinNoise.map((f) => f.text)).toEqual([
      expect.stringMatching(/recipe · Ingredient recall.*past the regression threshold/),
    ])
    expect(r.regressions.map((f) => f.text)).toEqual([
      expect.stringMatching(/recipe · Ingredient precision.*100\.0% → 80\.0% \(−20\.0 pp\)/),
    ])

    const md = renderMarkdown(r)
    const regressions = md.indexOf('## Regressions')
    const noise = md.indexOf('## Within noise')
    const table = md.indexOf('## recipe')
    const total = md.indexOf('**Total cost:**')
    expect(regressions).toBeGreaterThan(-1)
    expect(regressions).toBeLessThan(noise)
    expect(noise).toBeLessThan(table)
    expect(table).toBeLessThan(total)
    expect(md.slice(regressions, noise)).toContain('Ingredient precision')
    expect(md.slice(regressions, noise)).not.toContain('Ingredient recall')
  })

  it('flags a first-try plan validity drop of more than 10 points outside the range', () => {
    const r = report(series('plan', 'firstTryValid', [1, 1, 1], [0.5, 0.5, 0.5]), ['plan'])
    expect(r.regressions.map((f) => f.text)).toEqual([
      expect.stringMatching(/plan · First-try valid/),
    ])
  })

  it('does not flag a drop inside the threshold even outside the range', () => {
    const r = report(series('plan', 'firstTryValid', [1, 1, 1], [0.95, 0.95, 0.95]), ['plan'])
    expect(r.regressions).toEqual([])
  })

  it('flags candidate max latency above 80% of the route budget, whatever the baseline did', () => {
    const budget = TASK_SPECS.review.budgetMs
    const calls = [
      call('review', 'baseline', 1, {}, { latencyMs: 0.9 * budget }),
      call('review', 'candidate', 1, {}, { latencyMs: 0.85 * budget }),
      call('review', 'candidate', 2, {}, { latencyMs: 1_000 }),
    ]
    const r = report(calls, ['review'])
    expect(r.regressions.map((f) => f.text)).toEqual([
      expect.stringMatching(/review · Max latency.*38\.3s is above 80% of the 45\.0s route budget/),
    ])
  })

  it('reports errors by name, truncations, over-budget calls and cost', () => {
    const budget = TASK_SPECS.tips.budgetMs
    const calls = [
      call('tips', 'baseline', 1, { countsInRange: 1 }),
      call(
        'tips',
        'candidate',
        1,
        { countsInRange: 0 },
        {
          errorName: 'AI_NoObjectGeneratedError',
          finishReason: 'length',
          latencyMs: budget + 1,
          costUsd: 0.02,
        },
      ),
    ]
    const r = report(calls, ['tips'])
    const ops = r.tasks[0]!.operational.candidate
    expect(ops).toMatchObject({
      overBudget: 1,
      truncated: 1,
      errorsByName: { AI_NoObjectGeneratedError: 1 },
      totalCostUsd: 0.02,
    })
    expect(r.cost).toEqual({ baseline: 0.007, candidate: 0.02 })

    const md = renderMarkdown(r)
    expect(md).toContain('| Errors | none | AI_NoObjectGeneratedError × 1 |')
    expect(md).toContain('| Truncated (`finishReason: length`) | 0 | 1 |')
    expect(md).toContain('Latency max (budget 45.0s, `TIPS_AI_BUDGET_MS`)')
  })

  it('marks a partial run', () => {
    const r = report([call('tips', 'baseline', 1, { countsInRange: 1 })], ['tips'], true)
    const md = renderMarkdown(r)
    expect(md).toContain('**Partial run.**')
    expect(md).toMatch(/Total cost:.*partial run/)
  })
})
