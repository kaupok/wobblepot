// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Task } from './case-schema'
import {
  buildCheckReport,
  buildReport,
  callsToBound,
  compareMetric,
  perRunValues,
  renderCheckMarkdown,
  renderMarkdown,
  renderSummary,
  writeCheckReport,
  writeReport,
  zeroFailureBound,
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

  describe('max latency (HON-898)', () => {
    const budget = TASK_SPECS.review.budgetMs
    /** One review call per run for each role, at these shares of the budget. */
    const latencies = (baseline: number[], candidate: number[]) => [
      ...baseline.map((share, i) =>
        call('review', 'baseline', i + 1, {}, { latencyMs: share * budget }),
      ),
      ...candidate.map((share, i) =>
        call('review', 'candidate', i + 1, {}, { latencyMs: share * budget }),
      ),
    ]

    it('flags a candidate over 80% of the budget, with the baseline under it and outside the range, as a regression', () => {
      const r = report(latencies([0.5, 0.52], [0.85, 0.84]), ['review'])
      expect(r.regressions.map((f) => f.text)).toEqual([
        expect.stringMatching(
          /review · Max latency.*candidate's 38\.3s is above 80% of the 45\.0s route budget.*baseline's 23\.4s is not/,
        ),
      ])
    })

    it('lists both models over the line under "Other changes", naming both values', () => {
      const r = report(latencies([0.9, 0.5], [0.85, 0.5]), ['review'])
      expect(r.regressions).toEqual([])
      expect(r.otherChanges.map((f) => f.text)).toEqual([
        expect.stringMatching(
          /review · Max latency:\*\* both models are above 80% .*\(baseline 40\.5s, candidate 38\.3s\): the budget, not the model change/,
        ),
      ])
    })

    it("lists a candidate just over the line as noise when the gap is inside the baseline's range of per-run maxes", () => {
      // Baseline per-run maxes 0.6–0.78, candidate 0.65–0.81: gap 0.03, range 0.18.
      const r = report(latencies([0.78, 0.6], [0.81, 0.65]), ['review'])
      expect(r.regressions).toEqual([])
      expect(r.withinNoise.map((f) => f.text)).toEqual([
        expect.stringMatching(
          /review · Max latency.*36\.5s is above 80%.*baseline's 35\.1s is not, but the gap is inside the baseline's run-to-run range/,
        ),
      ])
    })

    it("does not let the candidate's own outlier widen the range it is judged against", () => {
      // Candidate per-run maxes 15s and 50s (over the 45s budget), baseline 22s and 20s.
      const r = report(latencies([0.49, 0.45], [0.33, 1.11]), ['review'])
      expect(r.withinNoise).toEqual([])
      expect(r.regressions.map((f) => f.text)).toEqual([
        expect.stringMatching(/Max latency.*50\.0s/),
      ])
    })

    it('never calls a candidate over the full route budget noise', () => {
      // The baseline's spread (0.4–0.79) covers the 0.22 gap, but 1.01 is past the budget itself.
      const r = report(latencies([0.79, 0.4], [1.01, 0.5]), ['review'])
      expect(r.regressions.map((f) => f.text)).toEqual([expect.stringMatching(/Max latency/)])
    })

    it('flags a candidate past the full budget as a regression even when the baseline is over the line', () => {
      // Baseline 36.5s (just over the 36.0s line), candidate 67.5s against the 45.0s budget.
      const r = report(latencies([0.81, 0.7], [1.5, 0.7]), ['review'])
      expect(r.otherChanges).toEqual([])
      expect(r.regressions.map((f) => f.text)).toEqual([
        expect.stringMatching(
          /candidate's 67\.5s is over the full 45\.0s route budget.*baseline's 36\.5s is not/,
        ),
      ])
    })

    it('keeps the crossing a regression when one run measured no range', () => {
      const r = report(latencies([0.78], [0.81]), ['review'])
      expect(r.regressions.map((f) => f.text)).toEqual([expect.stringMatching(/Max latency/)])
    })

    it('notes retried calls on the finding, since latency includes the retries', () => {
      const calls = latencies([0.5, 0.52], [0.85, 0.84]).map((c, i) => ({
        ...c,
        attempts: i === 2 ? 2 : 1,
      }))
      const r = report(calls, ['review'])
      expect(r.regressions[0]!.text).toContain(
        '1 call(s) retried, and latency includes the retries',
      )
      expect(renderMarkdown(r)).toContain('| Calls retried (latency includes retries) | 0 | 1 |')
    })

    it('says retries were not recorded for a run file that predates the count', () => {
      expect(renderMarkdown(report(latencies([0.5], [0.5]), ['review']))).toContain(
        '| Calls retried (latency includes retries) | not recorded | not recorded |',
      )
    })
  })

  describe('reasoning asymmetry (HON-899)', () => {
    it('lists a task where only one model reports reasoning tokens', () => {
      const calls = [
        call('plan', 'baseline', 1, {}, { reasoningTokens: 0 }),
        call('plan', 'candidate', 1, {}, { reasoningTokens: 476 }),
        call('tips', 'baseline', 1, {}, { reasoningTokens: null }),
        call('tips', 'candidate', 1, {}, { reasoningTokens: 120 }),
      ]
      const r = report(calls, ['plan', 'tips'])
      expect(r.otherChanges.map((f) => f.text)).toEqual([
        '**plan · Reasoning:** the candidate reasons (476 tokens/call), the baseline does not; latency and cost deltas on this task include that',
        '**tips · Reasoning:** the candidate reasons (120 tokens/call), the baseline does not; latency and cost deltas on this task include that',
      ])
    })

    it('says nothing when both or neither reason', () => {
      const calls = [
        call('plan', 'baseline', 1, {}, { reasoningTokens: 100 }),
        call('plan', 'candidate', 1, {}, { reasoningTokens: 476 }),
        call('tips', 'baseline', 1, {}, { reasoningTokens: 0 }),
        call('tips', 'candidate', 1, {}, { reasoningTokens: 0 }),
      ]
      expect(report(calls, ['plan', 'tips']).otherChanges).toEqual([])
    })
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
    expect(md).toContain('Latency max (budget 45.0s, `STEPS_AI_BUDGET_MS`)')
  })

  it('marks a partial run', () => {
    const r = report([call('tips', 'baseline', 1, { countsInRange: 1 })], ['tips'], true)
    const md = renderMarkdown(r)
    expect(md).toContain('**Partial run.**')
    expect(md).toMatch(/Total cost:.*partial run/)
  })

  describe('with --judge', () => {
    const judged = (outcomes: JudgedPair['outcome'][], partial = false): JudgeResult => ({
      judge: 'claude-opus-5-5',
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

    const judgeReport = (judge: JudgeResult | undefined, tasks: Task[] = ['imagine', 'tips']) =>
      buildReport({
        result: result([call('imagine', 'baseline', 1, {}), call('imagine', 'candidate', 1, {})]),
        judge,
        judgePending: judge ? undefined : { pairs: 4, prompts: 8 },
        baseline: 'claude-sonnet-5',
        candidate: 'claude-sonnet-5-5',
        runs: 3,
        maxUsd: 10,
        tasks,
        date: '2026-10-01',
      })

    it('says the pairs are out for judging in Claude Code until the verdicts are imported', () => {
      const r = judgeReport(undefined)
      expect(r.judge).toBeNull()
      expect(r.judgePending).toEqual({ pairs: 4, prompts: 8 })
      const md = renderMarkdown(r)
      expect(md).toContain('## Judge')
      expect(md).toContain('**Pending.** 4 pair(s), 8 prompt(s), are exported')
      expect(md).toContain('/bench-judge')
      expect(renderSummary(r)).toContain('**Pending.**')
    })

    it('names the judge the verdicts file gave', () => {
      const md = renderMarkdown(judgeReport({ ...judged(['win']), judge: 'claude-code/opus' }))
      expect(md).toContain('claude-code/opus compared the two models')
      expect(md).toMatch(/judge claude-code\/opus \$0\.50 over 0 calls/)
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
        judgeReport({
          judge: 'claude-opus-5-5',
          pairs: [],
          plannedPairs: 4,
          spendUsd: 0,
          partial: true,
        }),
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

describe('buildCheckReport', () => {
  /** Candidate-only calls, one per run, as `runCheck` records them. */
  const checked = (task: Task, runs: CallRecord['scores'][], extra: Partial<CallRecord> = {}) =>
    runs.map((scores, i) => call(task, 'candidate', i + 1, scores, extra))

  const check = (calls: CallRecord[], tasks: Task[], partial = false) =>
    buildCheckReport({
      result: result(calls, partial),
      model: null,
      modelFor: (t) => TASK_SPECS[t].productionModel,
      runs: 3,
      maxUsd: 10,
      tasks,
      date: '2026-10-01',
    })

  const gate = (r: ReturnType<typeof check>, label: string) =>
    r.gates.find((g) => g.label === label)

  it('passes when every gated mean meets its threshold', () => {
    const r = check(
      checked('review', [
        { allIdsOnce: 1, seededCorrected: 0.8, unchangedKept: 0.9 },
        { allIdsOnce: 1, seededCorrected: 0.7, unchangedKept: 0.95 },
      ]),
      ['review'],
    )
    expect(r.gates.map((g) => [g.label, g.status])).toEqual([
      ['Every ID exactly once', 'pass'],
      ['Seeded errors corrected (±25%)', 'pass'],
      ['Correct quantities kept', 'pass'],
      ['Max latency', 'pass'],
    ])
    expect(r.passed).toBe(true)
  })

  it('fails a min gate on the mean over all runs, and names the value and threshold', () => {
    const r = check(
      checked('review', [
        { allIdsOnce: 1, seededCorrected: 0.8, unchangedKept: 0.9 },
        { allIdsOnce: 0.5, seededCorrected: 0.8, unchangedKept: 0.9 },
      ]),
      ['review'],
    )
    expect(gate(r, 'Every ID exactly once')).toMatchObject({
      status: 'fail',
      observed: '75.0% (50.0%–100.0%)',
      threshold: '≥ 100.0%',
    })
    expect(r.passed).toBe(false)
    const md = renderCheckMarkdown(r)
    expect(md).toContain('**Fail.** 1 of 4 gates failed:')
    expect(md).toContain(
      '| review | Every ID exactly once | 75.0% (50.0%–100.0%) | ≥ 100.0% | **fail** |',
    )
  })

  it('fails a max gate above its threshold', () => {
    const r = check(
      checked('plan', [
        { firstTryValid: 1, validAfterRepair: 1, structureValid: 1, outOfPoolIds: 0.5 },
      ]),
      ['plan'],
    )
    expect(gate(r, 'Out-of-pool meal IDs')).toMatchObject({ status: 'fail', threshold: '≤ 0.00' })
  })

  it('passes a metric no call measured as "not measured"', () => {
    const r = check(
      checked('recipe', [
        { recall: null, precision: null, quantityUnitMatch: null, confidenceAgrees: 1 },
      ]),
      ['recipe'],
    )
    expect(gate(r, 'Ingredient recall')).toMatchObject({ status: 'not measured', observed: '—' })
    expect(r.passed).toBe(true)
    expect(renderCheckMarkdown(r)).toContain(
      '| recipe | Ingredient recall | — | ≥ 95.0% | not measured |',
    )
  })

  it('fails the latency gate when the slowest call is over 80% of the route budget', () => {
    const budget = TASK_SPECS.tips.budgetMs
    const r = check(
      checked('tips', [{ answered: 1, countsInRange: 1 }], { latencyMs: 0.85 * budget }),
      ['tips'],
    )
    expect(gate(r, 'Max latency')).toMatchObject({ status: 'fail', observed: '38.3s' })
    expect(gate(r, 'Max latency')!.threshold).toContain('≤ 36.0s (80% of `STEPS_AI_BUDGET_MS`)')
  })

  it('fails a partial run even when every measured gate holds', () => {
    const r = check(checked('tips', [{ answered: 1, countsInRange: 1 }]), ['tips'], true)
    expect(r.gates.every((g) => g.status === 'pass')).toBe(true)
    expect(r.passed).toBe(false)
    expect(renderCheckMarkdown(r)).toContain('**Partial run.**')
  })

  it('echoes the result and the Gates table, but no per-task table', () => {
    const summary = renderSummary(
      check(checked('tips', [{ answered: 1, countsInRange: 1 }]), ['tips']),
    )
    expect(summary).toContain('# AI eval check: production configuration')
    expect(summary).toContain('**Pass.** All 3 gates hold.')
    expect(summary).toContain('## Gates')
    expect(summary).not.toContain('## tips')
  })

  it('writes <date>-check-production, then a -2 rather than overwriting it', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'model-bench-check-'))
    try {
      const calls = checked('tips', [{ answered: 1, countsInRange: 1 }])
      const r = check(calls, ['tips'])
      const first = writeCheckReport(outDir, r, result(calls))
      const second = writeCheckReport(outDir, r, result(calls))
      expect(first.markdownPath).toBe(join(outDir, '2026-10-01-check-production.md'))
      expect(second.jsonPath).toBe(join(outDir, '2026-10-01-check-production-2.json'))
      const json = JSON.parse(readFileSync(first.jsonPath, 'utf8'))
      expect(json).toMatchObject({ mode: 'check', model: null, passed: true })
      expect(json.models).toEqual({ tips: TASK_SPECS.tips.productionModel })
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})

/**
 * `perRun[i]` lists one entry per call in run i + 1: `true` for a call that
 * completed, `false` for one that errored.
 */
function batch(
  task: Task,
  role: Role,
  perRun: boolean[][],
  scores: CallRecord['scores'] = {},
): CallRecord[] {
  return perRun.flatMap((calls, i) =>
    calls.map((ok, j) =>
      call(task, role, i + 1, ok ? scores : {}, {
        caseId: `${task}/case-${j}`,
        ...(ok ? {} : { errorName: 'AI_NoObjectGeneratedError', finishReason: 'length' }),
      }),
    ),
  )
}

const clean = (n: number) => Array<boolean>(n).fill(true)
const failing = (n: number, failures: number) => [
  ...Array<boolean>(failures).fill(false),
  ...clean(n - failures),
]

describe('completed calls', () => {
  it('lists failed calls outside noise as a regression on every task', () => {
    // The 2026-10-07 tips result: 5 of 24 candidate calls cut off at
    // maxOutputTokens, which the report listed as no regression at all.
    const r = report(
      [
        ...batch('tips', 'baseline', [clean(8), clean(8), clean(8)]),
        ...batch('tips', 'candidate', [failing(8, 2), failing(8, 1), failing(8, 2)]),
      ],
      ['tips'],
    )
    expect(r.regressions.map((f) => f.text)).toContainEqual(
      expect.stringMatching(/tips · Completed \(no error, not cut off\).*100\.0% → 79\.2%/),
    )
  })

  it('keeps a single failed call inside the run-to-run range', () => {
    const r = report(
      [
        ...batch('plan', 'baseline', [clean(8), clean(8), clean(8)]),
        ...batch('plan', 'candidate', [clean(8), failing(8, 1), clean(8)]),
      ],
      ['plan'],
    )
    expect(r.regressions.map((f) => f.text).join('\n')).not.toContain('Completed')
    expect(r.withinNoise.map((f) => f.text)).toContainEqual(
      expect.stringMatching(/plan · Completed/),
    )
  })

  it('counts an answer cut off at maxOutputTokens that still parsed as not completed', () => {
    const cutOff = (run: number) =>
      call('recipe', 'candidate', run, { recall: 1 }, { finishReason: 'length' })
    const r = report(
      [
        ...[1, 2, 3].map((run) => call('recipe', 'baseline', run, { recall: 1 })),
        ...[1, 2, 3].map(cutOff),
      ],
      ['recipe'],
    )
    const completed = r.tasks[0]!.metrics[0]!
    expect(completed.metric.key).toBe('completed')
    expect(completed.candidate?.mean).toBe(0)
    expect(r.regressions.map((f) => f.text)).toContainEqual(
      expect.stringMatching(/recipe · Completed/),
    )
  })

  it('puts the Completed row first in each task table', () => {
    const md = renderMarkdown(report(series('recipe', 'recall', [1, 1, 1], [1, 1, 1]), ['recipe']))
    const table = md.split('## recipe')[1]!
    // Header, separator, then the first metric row.
    expect(table.split('\n').filter((l) => l.startsWith('| '))[2]).toMatch(
      /^\| Completed \(no error, not cut off\) \| 100\.0% \| 100\.0% \|/,
    )
  })
})

describe('safety checks', () => {
  it('bounds a clean result and names a failure, per call', () => {
    const pass = { noForbiddenIngredients: 1 }
    const r = report(
      [
        ...batch('imagine', 'baseline', [clean(8), clean(8), clean(8)], pass),
        ...batch('imagine', 'candidate', [clean(8), clean(8), clean(8)], pass).map((c, i) =>
          i === 0 ? { ...c, scores: { noForbiddenIngredients: 0 } } : c,
        ),
      ],
      ['imagine'],
    )
    expect(r.tasks[0]!.safety).toEqual([
      expect.objectContaining({
        baseline: { scored: 24, failed: 0 },
        candidate: { scored: 24, failed: 1 },
      }),
    ])
    const md = renderMarkdown(r)
    expect(md).toContain('## Safety checks')
    expect(md).toContain(
      '| imagine · No forbidden ingredient | 0 of 24 failed (rate up to 11.7%) | **1 of 24 failed** |',
    )
    expect(md).toContain('under 5% takes 59 clean calls, and under 1% takes 299')
  })

  it('leaves an errored call out of the count, as the metric does', () => {
    const r = report(
      [
        ...batch('cook-question', 'baseline', [clean(4)], { avoidsForbidden: 1 }),
        ...batch('cook-question', 'candidate', [failing(4, 1)], { avoidsForbidden: 1 }),
      ],
      ['cook-question'],
    )
    expect(r.tasks[0]!.safety[0]!.candidate).toEqual({ scored: 3, failed: 0 })
  })

  it('adds no section when no task in the run has a safety check', () => {
    const md = renderMarkdown(report(series('recipe', 'recall', [1, 1, 1], [1, 1, 1]), ['recipe']))
    expect(md).not.toContain('## Safety checks')
  })

  it('computes the exact zero-failure bound', () => {
    expect(zeroFailureBound(24)).toBeCloseTo(0.1173, 4)
    expect(zeroFailureBound(59)).toBeLessThan(0.05)
    expect(zeroFailureBound(58)).toBeGreaterThan(0.05)
    expect(callsToBound(0.05)).toBe(59)
    expect(callsToBound(0.01)).toBe(299)
  })
})
