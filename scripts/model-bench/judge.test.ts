// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BenchCase } from './case-schema'
import {
  JUDGE_MODEL,
  JUDGED_TASKS,
  combineVerdicts,
  runJudge,
  summarizeJudge,
  type JudgedPair,
  type Winner,
} from './judge'
import { loadCases } from './load-cases'
import type { CallRecord, Role, RunResult } from './runner'
import { loadStarterCases, mockModelFactory, type MockCall, type MockResponse } from './test-utils'

const MODEL: Record<Role, string> = {
  baseline: 'claude-sonnet-5',
  candidate: 'claude-sonnet-5-5',
}
/** Text only one role's output carries, so a mock judge can tell A from B. */
const MARK: Record<Role, string> = { baseline: 'answer-one', candidate: 'answer-two' }

const starter = loadStarterCases(JUDGED_TASKS)
const imagineCase = starter.find((c) => c.id === 'imagine/en-chicken-rice-weeknight')!
const etCase = starter.find((c) => c.id === 'imagine/et-vegetarian-lentils')!

function outputFor(c: BenchCase, role: Role): unknown {
  if (c.task === 'imagine') {
    return {
      meals: [
        {
          name: MARK[role],
          description: 'd',
          timeMinutes: 30,
          servings: 4,
          mealTypes: ['dinner'],
          kidFriendly: true,
          ingredients: [{ name: 'rice', originalText: '300 g rice' }],
        },
      ],
    }
  }
  return { pitfalls: [MARK[role], 'p'], tip: 't' }
}

function record(c: BenchCase, role: Role, run = 1, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    caseId: c.id,
    task: c.task,
    run,
    role,
    model: MODEL[role],
    position: role === 'baseline' ? 1 : 2,
    latencyMs: 1_000,
    finishReason: 'stop',
    usage: null,
    reasoningTokens: null,
    costUsd: 0.01,
    errorName: null,
    errorMessage: null,
    output: outputFor(c, role),
    scores: {},
    ...extra,
  }
}

function benchResult(calls: CallRecord[], spendUsd = 0): RunResult {
  return { calls, plannedCalls: calls.length, spendUsd, partial: false }
}

const pairOf = (c: BenchCase, run = 1) => [record(c, 'baseline', run), record(c, 'candidate', run)]

function between(text: string, tag: string): string {
  return text.split(`<${tag}>`)[1]!.split(`</${tag}>`)[0]!
}

/** Which role's answer the judge was shown as A. */
function roleAsA(call: MockCall): Role {
  return between(call.promptText, 'answer_a').includes(MARK.baseline) ? 'baseline' : 'candidate'
}

/** A mock judge whose verdict depends on which role sits in A, and on the call's index. */
function judge(decide: (asA: Role, index: number) => Winner) {
  let index = 0
  return mockModelFactory((call) => ({
    object: { winner: decide(roleAsA(call), index++), reason: 'Because.' },
  }))
}

/** Picks `role`'s answer whichever label it carries. */
const prefer = (role: Role) => (asA: Role) => (asA === role ? 'A' : 'B')

async function judgeOne(decide: (asA: Role, index: number) => Winner) {
  const { factory, calls } = judge(decide)
  const result = await runJudge({
    result: benchResult(pairOf(imagineCase)),
    cases: starter,
    maxUsd: 10,
    modelFactory: factory,
  })
  return { pair: result.pairs[0]!, calls, result }
}

describe('buildJudgePrompt via runJudge', () => {
  it('never shows the judge a model ID, or the words "baseline" and "candidate"', async () => {
    // Every committed imagine and tips case, not only the starter set: a
    // case's own text is part of the prompt.
    const cases = loadCases(JUDGED_TASKS)
    const { factory, calls } = judge(() => 'tie')
    await runJudge({
      result: benchResult(cases.flatMap((c) => pairOf(c))),
      cases,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls).toHaveLength(cases.length * 2)
    for (const call of calls) {
      expect(call.modelId).toBe(JUDGE_MODEL)
      expect(call.promptText).not.toContain(MODEL.baseline)
      expect(call.promptText).not.toContain(MODEL.candidate)
      expect(call.promptText).not.toMatch(/baseline|candidate/i)
      // The scorer's keyword lists are not what the app sent.
      expect(call.promptText).not.toContain('forbiddenKeywords')
      expect(call.promptText).not.toContain('allowedQualifiers')
    }
  })

  it('adds the Estonian voice reference for an et case only', async () => {
    const { factory, calls } = judge(() => 'tie')
    await runJudge({
      result: benchResult([...pairOf(imagineCase), ...pairOf(etCase)]),
      cases: starter,
      maxUsd: 10,
      modelFactory: factory,
    })

    const [en, , et] = calls
    expect(en!.promptText).not.toContain('<voice_reference>')
    expect(et!.promptText).toContain('<voice_reference>')
    expect(et!.promptText).toContain('# Estonian AI voice reference')
  })

  it('shows imagine meals as what the user reads: name, description, time, servings, ingredients', async () => {
    const { calls } = await judgeOne(() => 'tie')
    const answerA = JSON.parse(between(calls[0]!.promptText, 'answer_a'))
    expect(answerA).toEqual({
      meals: [
        {
          name: MARK.baseline,
          description: 'd',
          timeMinutes: 30,
          servings: 4,
          ingredients: ['300 g rice'],
        },
      ],
    })
    // The scorer's forbidden list is not what the app sent.
    expect(between(calls[0]!.promptText, 'input')).not.toContain('forbiddenKeywords')
  })
})

describe('runJudge', () => {
  it('judges each pair twice, with A and B swapped', async () => {
    const { pair, calls } = await judgeOne(() => 'tie')

    expect(calls).toHaveLength(2)
    expect(between(calls[0]!.promptText, 'answer_a')).toContain(MARK.baseline)
    expect(between(calls[0]!.promptText, 'answer_b')).toContain(MARK.candidate)
    expect(between(calls[1]!.promptText, 'answer_a')).toContain(MARK.candidate)
    expect(between(calls[1]!.promptText, 'answer_b')).toContain(MARK.baseline)
    expect(pair.calls.map((c) => c.roleAsA)).toEqual(['baseline', 'candidate'])
  })

  it('scores a win when both orders pick the candidate', async () => {
    const { pair } = await judgeOne(prefer('candidate'))
    expect(pair.outcome).toBe('win')
    expect(pair.calls.map((c) => [c.winner, c.pick])).toEqual([
      ['B', 'candidate'],
      ['A', 'candidate'],
    ])
  })

  it('scores a loss when both orders pick the baseline', async () => {
    const { pair } = await judgeOne(prefer('baseline'))
    expect(pair.outcome).toBe('loss')
  })

  it('scores a tie when the two orders disagree', async () => {
    // Always "A": position bias, which the second order cancels.
    const { pair } = await judgeOne(() => 'A')
    expect(pair.outcome).toBe('tie')
    expect(pair.calls.map((c) => c.pick)).toEqual(['baseline', 'candidate'])
  })

  it('scores a tie when either order says tie', async () => {
    const { pair } = await judgeOne((asA, index) =>
      index === 0 ? 'tie' : prefer('candidate')(asA),
    )
    expect(pair.outcome).toBe('tie')
    expect(pair.calls.map((c) => c.pick)).toEqual(['tie', 'candidate'])
  })

  it('keeps both verdicts and both reasons on the pair', async () => {
    const { pair } = await judgeOne(prefer('candidate'))
    expect(pair.calls.map((c) => c.reason)).toEqual(['Because.', 'Because.'])
  })

  it('skips a pair, without a judge call, when one side errored', async () => {
    const { factory, calls } = judge(() => 'tie')
    const result = await runJudge({
      result: benchResult([
        record(imagineCase, 'baseline'),
        record(imagineCase, 'candidate', 1, { errorName: 'NoObjectGeneratedError', output: null }),
      ]),
      cases: starter,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls).toHaveLength(0)
    expect(result.pairs).toEqual([
      expect.objectContaining({
        outcome: 'skipped',
        skipReason: 'candidate errored',
        calls: [],
      }),
    ])
  })

  it('pairs by case and run, and leaves unjudged tasks alone', async () => {
    const recipe = loadStarterCases(['recipe'])[0]!
    const { factory, calls } = judge(() => 'tie')
    const result = await runJudge({
      result: benchResult([
        ...pairOf(imagineCase, 1),
        ...pairOf(recipe),
        ...pairOf(imagineCase, 2),
      ]),
      cases: [...starter, recipe],
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls).toHaveLength(4)
    expect(result.pairs.map((p) => [p.caseId, p.run])).toEqual([
      [imagineCase.id, 1],
      [imagineCase.id, 2],
    ])
  })

  it('records a failed judge call as a judge error, and still counts its cost', async () => {
    const { factory } = mockModelFactory((): MockResponse => ({
      text: '{"winner": "maybe"}',
      outputTokens: 1_000,
    }))
    const result = await runJudge({
      result: benchResult(pairOf(imagineCase)),
      cases: starter,
      maxUsd: 10,
      modelFactory: factory,
    })

    const pair = result.pairs[0]!
    expect(pair.outcome).toBe('judge-error')
    expect(pair.calls[0]!.errorName).toBe('AI_NoObjectGeneratedError')
    expect(result.spendUsd).toBeGreaterThan(0)
  })

  it('counts judge calls toward --max-usd and stops, partial, once past it', async () => {
    // 100k output tokens at $20 / MTok: $2 a judge call, $4 a pair. The
    // benchmark already spent $5 of the $10 cap, so the second pair takes
    // spend past it and the third is never judged.
    const { factory, calls } = mockModelFactory(() => ({
      object: { winner: 'tie', reason: 'r' },
      outputTokens: 100_000,
    }))
    const result = await runJudge({
      result: benchResult(
        starter.flatMap((c) => pairOf(c)),
        5,
      ),
      cases: starter,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls).toHaveLength(4)
    expect(result.pairs).toHaveLength(2)
    expect(result.plannedPairs).toBe(4)
    expect(result.partial).toBe(true)
    // Four calls at 1k input ($4 / MTok) and 100k output ($20 / MTok).
    expect(result.spendUsd).toBeCloseTo(4 * (0.004 + 2), 6)
  })

  it('makes no judge call when the benchmark already passed --max-usd', async () => {
    const { factory, calls } = judge(() => 'tie')
    const result = await runJudge({
      result: benchResult(pairOf(imagineCase), 10.5),
      cases: starter,
      maxUsd: 10,
      modelFactory: factory,
    })
    expect(calls).toHaveLength(0)
    expect(result.partial).toBe(true)
  })
})

describe('combineVerdicts', () => {
  it.each([
    ['candidate', 'candidate', 'win'],
    ['baseline', 'baseline', 'loss'],
    ['baseline', 'candidate', 'tie'],
    ['candidate', 'baseline', 'tie'],
    ['tie', 'candidate', 'tie'],
    ['baseline', 'tie', 'tie'],
    ['tie', 'tie', 'tie'],
  ] as const)('%s + %s → %s', (first, second, outcome) => {
    expect(combineVerdicts(first, second)).toBe(outcome)
  })
})

describe('summarizeJudge', () => {
  const pairs = (outcomes: JudgedPair['outcome'][]): JudgedPair[] =>
    outcomes.map((outcome, i) => ({
      caseId: 'tips/case',
      task: 'tips',
      run: i + 1,
      outcome,
      skipReason: null,
      calls: [],
    }))

  it('reports too few decided pairs, and flags nothing, below 5', () => {
    const [s] = summarizeJudge(pairs(['loss', 'loss', 'loss', 'loss', 'tie', 'skipped']), ['tips'])
    expect(s).toMatchObject({ wins: 0, losses: 4, ties: 1, skipped: 1, decided: 4, winRate: 0 })
    expect(s!.status).toBe('too-few')
  })

  it('flags a win rate under 40% from 5 decided pairs', () => {
    const [s] = summarizeJudge(pairs(['win', 'loss', 'loss', 'loss', 'loss', 'tie']), ['tips'])
    expect(s).toMatchObject({ decided: 5, winRate: 0.2, status: 'regression' })
  })

  it('does not flag a win rate of exactly 40%', () => {
    const [s] = summarizeJudge(pairs(['win', 'win', 'loss', 'loss', 'loss']), ['tips'])
    expect(s).toMatchObject({ winRate: 0.4, status: 'ok' })
  })

  it('leaves ties, skips and judge errors out of the win rate', () => {
    const [s] = summarizeJudge(
      pairs(['win', 'win', 'win', 'win', 'loss', 'tie', 'tie', 'skipped', 'judge-error']),
      ['tips'],
    )
    expect(s).toMatchObject({
      wins: 4,
      losses: 1,
      ties: 2,
      skipped: 1,
      judgeErrors: 1,
      winRate: 0.8,
    })
  })
})
