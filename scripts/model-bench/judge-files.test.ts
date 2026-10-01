// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BenchCase } from './case-schema'
import { JUDGED_TASKS, type JudgedPair } from './judge'
import { exportJudgePairs, importJudgeVerdicts, type JudgeKey } from './judge-files'
import type { CallRecord, Role, RunResult } from './runner'
import { loadStarterCases } from './test-utils'

const MODEL: Record<Role, string> = {
  baseline: 'claude-sonnet-5',
  candidate: 'claude-sonnet-5-5',
}
/** Text only one role's output carries, so a test can tell A from B. */
const MARK: Record<Role, string> = { baseline: 'answer-one', candidate: 'answer-two' }

const starter = loadStarterCases(JUDGED_TASKS)
const imagineCase = starter.find((c) => c.id === 'imagine/en-chicken-rice-weeknight')!
const tipsCase = starter.find((c) => c.id === 'tips/en-full-bolognese')!

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
    output:
      c.task === 'imagine'
        ? {
            meals: [
              {
                name: MARK[role],
                ingredients: [{ name: 'rice', quantity: null, unit: null, vaguePhrase: null }],
              },
            ],
          }
        : { pitfalls: [MARK[role]], tip: 't' },
    scores: {},
    ...extra,
  }
}

const result = (calls: CallRecord[]): RunResult => ({
  calls,
  plannedCalls: calls.length,
  spendUsd: 0,
  partial: false,
})

const pairOf = (c: BenchCase, run = 1) => [record(c, 'baseline', run), record(c, 'candidate', run)]

function between(text: string, tag: string): string {
  return text.split(`<${tag}>`)[1]!.split(`</${tag}>`)[0]!
}

describe('exportJudgePairs', () => {
  const { items, key } = exportJudgePairs(
    result([...pairOf(imagineCase), ...pairOf(tipsCase), ...pairOf(imagineCase, 2)]),
    starter,
  )

  it('exports two prompts per pair, with A and B swapped between them', () => {
    expect(items).toHaveLength(6)
    expect(key.pairs).toHaveLength(3)
    const [first, second] = items as [(typeof items)[0], (typeof items)[0]]
    expect(between(first.prompt, 'answer_a')).toContain(MARK.baseline)
    expect(between(first.prompt, 'answer_b')).toContain(MARK.candidate)
    expect(between(second.prompt, 'answer_a')).toContain(MARK.candidate)
    expect(between(second.prompt, 'answer_b')).toContain(MARK.baseline)
  })

  it('keeps every model ID and role word out of the pairs file', () => {
    const text = JSON.stringify(items)
    for (const secret of [MODEL.baseline, MODEL.candidate, 'baseline', 'candidate']) {
      expect(text).not.toContain(secret)
    }
  })

  it('keys each prompt by case, run and a letter that alternates with the pair', () => {
    expect(key.pairs[0]).toMatchObject({
      caseId: imagineCase.id,
      task: 'imagine',
      run: 1,
      skipReason: null,
      items: [
        { id: `${imagineCase.id}#1#a`, roleAsA: 'baseline' },
        { id: `${imagineCase.id}#1#b`, roleAsA: 'candidate' },
      ],
    })
    // The second pair flips the letters, so "a" is not "baseline as A".
    expect(key.pairs[1]!.items).toEqual([
      { id: `${tipsCase.id}#1#b`, roleAsA: 'baseline' },
      { id: `${tipsCase.id}#1#a`, roleAsA: 'candidate' },
    ])
    expect(key.pairs[2]!.items.map((i) => i.id)).toEqual([
      `${imagineCase.id}#2#a`,
      `${imagineCase.id}#2#b`,
    ])
    expect(items.map((i) => i.id)).toEqual(key.pairs.flatMap((p) => p.items.map((i) => i.id)))
  })

  it('exports nothing for a pair with an errored side, and records why', () => {
    const errored = exportJudgePairs(
      result([
        record(imagineCase, 'baseline', 1, { errorName: 'APICallError' }),
        record(imagineCase, 'candidate'),
      ]),
      starter,
    )
    expect(errored.items).toEqual([])
    expect(errored.key.pairs).toEqual([
      {
        caseId: imagineCase.id,
        task: 'imagine',
        run: 1,
        skipReason: 'baseline errored',
        items: [],
      },
    ])
  })
})

describe('importJudgeVerdicts', () => {
  const key: JudgeKey = {
    pairsFile: 'run.judge-pairs.json',
    verdictsFile: 'run.judge-verdicts.json',
    pairs: [
      {
        caseId: imagineCase.id,
        task: 'imagine',
        run: 1,
        skipReason: null,
        items: [
          { id: 'p1#a', roleAsA: 'baseline' },
          { id: 'p1#b', roleAsA: 'candidate' },
        ],
      },
      {
        caseId: tipsCase.id,
        task: 'tips',
        run: 1,
        skipReason: 'candidate errored',
        items: [],
      },
    ],
  }
  const verdict = (id: string, winner: 'A' | 'B' | 'tie') => ({
    id,
    winner,
    reason: `${id}: ${winner}`,
  })

  const outcome = (asBaselineA: 'A' | 'B' | 'tie', asCandidateA: 'A' | 'B' | 'tie') =>
    importJudgeVerdicts(key, {
      judge: 'claude-code/opus',
      verdicts: [verdict('p1#a', asBaselineA), verdict('p1#b', asCandidateA)],
    }).pairs[0]!

  it.each<[['A' | 'B' | 'tie', 'A' | 'B' | 'tie'], JudgedPair['outcome']]>([
    [['B', 'A'], 'win'],
    [['A', 'B'], 'loss'],
    [['A', 'A'], 'tie'],
    [['tie', 'A'], 'tie'],
  ])('maps verdicts %j back through the roles to %s', ([first, second], expected) => {
    expect(outcome(first, second).outcome).toBe(expected)
  })

  it('keeps both verdicts and reasons, in baseline-as-A order, and labels the judge', () => {
    const imported = importJudgeVerdicts(key, {
      judge: 'claude-code/opus',
      verdicts: [verdict('p1#b', 'A'), verdict('p1#a', 'B')],
    })
    expect(imported).toMatchObject({
      judge: 'claude-code/opus',
      plannedPairs: 2,
      spendUsd: 0,
      partial: false,
    })
    expect(imported.pairs[0]!.calls).toMatchObject([
      { roleAsA: 'baseline', winner: 'B', pick: 'candidate', reason: 'p1#a: B', costUsd: 0 },
      { roleAsA: 'candidate', winner: 'A', pick: 'candidate', reason: 'p1#b: A', costUsd: 0 },
    ])
  })

  it('keeps a skipped pair skipped', () => {
    expect(outcome('A', 'B')).toBeDefined()
    const skipped = importJudgeVerdicts(key, { judge: 'j', verdicts: [] }).pairs[1]!
    expect(skipped).toMatchObject({
      outcome: 'skipped',
      skipReason: 'candidate errored',
      calls: [],
    })
  })

  it('counts a pair with a verdict missing as a judge error', () => {
    const pair = importJudgeVerdicts(key, {
      judge: 'j',
      verdicts: [verdict('p1#a', 'A')],
    }).pairs[0]!
    expect(pair.outcome).toBe('judge-error')
    expect(pair.calls[1]).toMatchObject({
      roleAsA: 'candidate',
      winner: null,
      pick: null,
      errorName: 'MissingVerdict',
      errorMessage: 'No verdict for p1#b in run.judge-verdicts.json',
    })
  })

  it('refuses a verdict for an id the run never exported', () => {
    expect(() =>
      importJudgeVerdicts(key, { judge: 'j', verdicts: [verdict('p9#a', 'A')] }),
    ).toThrow(/never exported: p9#a/)
  })
})
