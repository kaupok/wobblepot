// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Task } from './case-schema'
import {
  buildReport,
  compareMetric,
  perRunValues,
  renderMarkdown,
  renderSummary,
  writeReport,
} from './report'
import type { CallRecord, Role, RunResult } from './runner'
import { TASK_SPECS } from './tasks'
import type { JudgedPair, JudgeResult } from './judge'

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

// Seeded-error correction drops 30 points with no run-to-run variation, and the
// metric has no threshold.
const seededDrop = () =>
  report(series('review', 'seededCorrected', [0.9, 0.9, 0.9], [0.6, 0.6, 0.6]), ['review'])

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

describe('a single run', () => {
  it('measures no range, so a threshold-crossing drop is noise, not a regression', () => {
    const calls = series('recipe', 'recall', [1], [0.929])
    const cmp = compareMetric(
      recall,
      calls.filter((c) => c.role === 'baseline'),
      calls.filter((c) => c.role === 'candidate'),
    )
    expect(cmp).toMatchObject({ rangeMeasured: false, noise: true, thresholdBreached: true })

    const r = report(calls, ['recipe'])
    expect(r.regressions).toEqual([])
    expect(r.withinNoise.map((f) => f.text)).toEqual([
      expect.stringMatching(/Ingredient recall.*only one run, so no run-to-run range was measured/),
    ])
    expect(renderMarkdown(r)).toContain('| noise (1 run) |')
  })

  it('applies per side: one model with a single run still counts as unmeasured', () => {
    const calls = series('recipe', 'recall', [1, 1, 1], [0.8])
    const cmp = compareMetric(
      recall,
      calls.filter((c) => c.role === 'baseline'),
      calls.filter((c) => c.role === 'candidate'),
    )
    expect(cmp.noise).toBe(true)
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

  describe('other changes outside noise', () => {
    it('lists a drop on a metric without a threshold, in the markdown, the JSON and the summary', () => {
      const r = seededDrop()
      expect(r.regressions).toEqual([])
      expect(r.withinNoise).toEqual([])
      expect(r.otherChanges.map((f) => f.text)).toEqual([
        '**review · Seeded errors corrected (±25%):** 90.0% → 60.0% (−30.0 pp)',
      ])

      const md = renderMarkdown(r)
      const regressions = md.indexOf('## Regressions')
      const other = md.indexOf('## Other changes outside noise')
      const noise = md.indexOf('## Within noise')
      expect(regressions).toBeLessThan(other)
      expect(other).toBeLessThan(noise)
      expect(md.slice(other, noise)).toContain('Seeded errors corrected')
      expect(md.slice(regressions, other)).toContain('None.')

      expect(renderSummary(r)).toContain(
        '- **review · Seeded errors corrected (±25%):** 90.0% → 60.0% (−30.0 pp)',
      )

      const outDir = mkdtempSync(join(tmpdir(), 'model-bench-report-'))
      try {
        const { jsonPath } = writeReport(outDir, r, result([]))
        const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
        expect(json.otherChanges).toEqual([
          {
            task: 'review',
            text: '**review · Seeded errors corrected (±25%):** 90.0% → 60.0% (−30.0 pp)',
          },
        ])
        expect(json).toMatchObject({ regressions: [], withinNoise: [] })
      } finally {
        rmSync(outDir, { recursive: true, force: true })
      }
    })

    it('lists an improvement too', () => {
      const r = report(series('tips', 'countsInRange', [0.5, 0.5, 0.5], [1, 1, 1]), ['tips'])
      expect(r.otherChanges.map((f) => f.text)).toEqual([
        expect.stringMatching(/tips · Item counts in range.*\(\+50\.0 pp\)/),
      ])
      expect(r.regressions).toEqual([])
    })

    it('lists a noise-flagged difference only under "Within noise"', () => {
      const r = report(series('review', 'seededCorrected', [0.6, 0.9, 1], [0.7, 0.75, 0.8]), [
        'review',
      ])
      expect(r.withinNoise.map((f) => f.text)).toEqual([
        expect.stringMatching(/review · Seeded errors corrected/),
      ])
      expect(r.otherChanges).toEqual([])
      expect(renderMarkdown(r)).toMatch(/## Other changes outside noise\n\n.*\n\nNone\./)
    })
  })

  it('flags any drop outside noise on the forbidden-ingredient check as a regression', () => {
    const r = report(series('imagine', 'noForbiddenIngredients', [1, 1, 1], [0.95, 0.95, 0.95]), [
      'imagine',
    ])
    expect(r.regressions.map((f) => f.text)).toEqual([
      expect.stringMatching(/imagine · No forbidden ingredient.*100\.0% → 95\.0% \(−5\.0 pp\)/),
    ])
    expect(r.otherChanges).toEqual([])
  })

  it('treats float residue between equal constant runs as no change', () => {
    // A `--max-usd` stop left the candidate with two runs: 0.7 averaged over
    // three runs and over two differs in the last bit.
    const r = report(series('imagine', 'noForbiddenIngredients', [0.7, 0.7, 0.7], [0.7, 0.7]), [
      'imagine',
    ])
    expect(r.tasks[0]!.metrics.find((m) => m.metric.key === 'noForbiddenIngredients')!.delta).toBe(
      0,
    )
    expect([...r.regressions, ...r.otherChanges, ...r.withinNoise]).toEqual([])
  })

  it('echoes everything above the first per-task table, the Judge section included', () => {
    const r = seededDrop()
    const summary = renderSummary(r)
    expect(summary).toMatch(/^# Model benchmark/)
    expect(summary).toContain('## Within noise')
    expect(summary).not.toContain('## review')
    expect(summary).not.toContain('**Total cost:**')

    const withJudge = renderSummary({
      ...r,
      judge: {
        model: 'claude-opus-5-5',
        tasks: [],
        partial: false,
        judgedPairs: 0,
        plannedPairs: 0,
        calls: 0,
      },
    })
    expect(withJudge).toContain('## Judge')
    expect(withJudge).not.toContain('## review')
  })

  it('holds a drop of exactly the threshold to "more than", despite float residue', () => {
    // 0.85 − 0.9 is −0.050000000000000044 in floating point.
    const r = report(series('recipe', 'recall', [0.9, 0.9, 0.9], [0.85, 0.85, 0.85]), ['recipe'])
    expect(r.regressions).toEqual([])
    expect(r.otherChanges.map((f) => f.text)).toEqual([
      expect.stringMatching(/recipe · Ingredient recall.*\(−5\.0 pp\)/),
    ])
  })

  it('counts a gap equal to the range as noise, despite float residue', () => {
    // Exactly, both the drop and the baseline's range are 1/7; in floating
    // point the drop comes out a hair larger.
    const r = report(
      series('imagine', 'noForbiddenIngredients', [6 / 7, 1, 1], [5 / 7, 6 / 7, 6 / 7]),
      ['imagine'],
    )
    expect(r.regressions).toEqual([])
    expect(r.withinNoise.map((f) => f.text)).toEqual([
      expect.stringMatching(/imagine · No forbidden ingredient/),
    ])
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
    expect(r.cost).toEqual({ baseline: 0.007, candidate: 0.02, judge: 0 })

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

  describe('with --judge', () => {
    const judged = (outcomes: JudgedPair['outcome'][], partial = false): JudgeResult => ({
      pairs: outcomes.map((outcome, i) => ({
        caseId: 'imagine/case',
        task: 'imagine',
        run: i + 1,
        outcome,
        skipReason: outcome === 'skipped' ? 'baseline errored' : null,
        calls: [],
      })),
      plannedPairs: outcomes.length + (partial ? 3 : 0),
      spendUsd: 0.5,
      partial,
    })

    const judgeReport = (judge: JudgeResult, tasks: Task[] = ['imagine', 'tips']) =>
      buildReport({
        result: result([call('imagine', 'baseline', 1, {}), call('imagine', 'candidate', 1, {})]),
        judge,
        baseline: 'claude-sonnet-5',
        candidate: 'claude-sonnet-5-5',
        runs: 3,
        maxUsd: 10,
        tasks,
        date: '2026-10-01',
      })

    it('lists a win rate under 40% over 5 decided pairs as a regression', () => {
      const r = judgeReport(judged(['win', 'loss', 'loss', 'loss', 'loss', 'tie']))
      expect(r.regressions.map((f) => f.text)).toEqual([
        '**imagine · Judge win rate:** 20.0% (1 won of 5 decided) is under 40%',
      ])
      const md = renderMarkdown(r)
      expect(md).toContain('## Judge')
      expect(md).toContain('| imagine | 1 | 1 | 4 | 0 | 0 | 20.0% (1 won of 5 decided) |')
    })

    it('flags nothing and says so below 5 decided pairs', () => {
      const r = judgeReport(judged(['loss', 'loss', 'loss', 'loss', 'skipped']))
      expect(r.regressions).toEqual([])
      expect(renderMarkdown(r)).toContain(
        '| imagine | 0 | 0 | 4 | 1 | 0 | too few decided pairs (4 of 5) |',
      )
    })

    it('only covers the judged tasks the run included', () => {
      const r = judgeReport(judged([]), ['imagine', 'recipe'])
      expect(r.judge!.tasks.map((t) => t.task)).toEqual(['imagine'])
      expect(renderMarkdown(judgeReport(judged([]), ['recipe']))).toContain('No judged task')
    })

    it('adds the judge to the total cost', () => {
      const md = renderMarkdown(judgeReport(judged(['win'])))
      expect(md).toMatch(/Total cost:\*\* \$0\.51 .*judge claude-opus-5-5 \$0\.50 over 0 calls/)
    })

    it('says the judge never ran when the benchmark had already passed --max-usd', () => {
      const md = renderMarkdown(
        judgeReport({ pairs: [], plannedPairs: 4, spendUsd: 0, partial: true }),
      )
      expect(md).toContain(
        '**Not judged:** spend had already passed `--max-usd` before the first of 4 pairs',
      )
      expect(md).not.toContain('too few decided pairs')
    })

    it('marks a run the judge stopped as partial', () => {
      const r = judgeReport(judged(['win'], true))
      expect(r.partial).toBe(false)
      const md = renderMarkdown(r)
      expect(md).toContain('while judging, after 1 of 4 pairs')
      expect(md).toMatch(/Total cost:.*partial run/)
    })
  })
})
