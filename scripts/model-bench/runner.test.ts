// @vitest-environment node
import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { loadCases } from './load-cases'
import { runBenchmark, runCheck } from './runner'
import { errorScores } from './tasks'
import { loadStarterCases, mockModelFactory } from './test-utils'

const BASELINE = 'claude-sonnet-5'
const CANDIDATE = 'claude-sonnet-5-5'

const reviewCases = loadStarterCases(['review'])
const tipsCases = loadStarterCases(['tips'])

/** A clock that advances 1000 ms per reading, so every call measures 1000 ms. */
function steppingClock() {
  let t = 0
  return () => (t += 1000)
}

describe('runBenchmark', () => {
  it('alternates which model goes first across cases and across runs', async () => {
    const { factory, calls } = mockModelFactory(() => ({ object: { ingredients: [] } }))
    const result = await runBenchmark({
      cases: reviewCases,
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 2,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls.map((c) => c.modelId)).toEqual([
      BASELINE,
      CANDIDATE,
      CANDIDATE,
      BASELINE,
      CANDIDATE,
      BASELINE,
      BASELINE,
      CANDIDATE,
    ])
    expect(result.calls.map((c) => [c.caseId, c.run, c.role, c.position])).toEqual([
      ['review/en-chicken-stir-fry', 1, 'baseline', 1],
      ['review/en-chicken-stir-fry', 1, 'candidate', 2],
      ['review/et-kartulisalat', 1, 'candidate', 1],
      ['review/et-kartulisalat', 1, 'baseline', 2],
      ['review/en-chicken-stir-fry', 2, 'candidate', 1],
      ['review/en-chicken-stir-fry', 2, 'baseline', 2],
      ['review/et-kartulisalat', 2, 'baseline', 1],
      ['review/et-kartulisalat', 2, 'candidate', 2],
    ])
    expect(result.partial).toBe(false)
    expect(result.plannedCalls).toBe(8)
  })

  it('gives every case each model first equally often, even with an odd case count', async () => {
    const { factory } = mockModelFactory(() => ({ object: { ingredients: [] } }))
    const cases = [...reviewCases, { ...reviewCases[0]!, id: 'review/third' }]
    const result = await runBenchmark({
      cases,
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 2,
      maxUsd: 10,
      modelFactory: factory,
    })

    for (const c of cases) {
      const firsts = result.calls
        .filter((r) => r.caseId === c.id && r.position === 1)
        .map((r) => r.role)
        .sort()
      expect(firsts, c.id).toEqual(['baseline', 'candidate'])
    }
  })

  it('sends the production request with no abort signal', async () => {
    const { factory, calls } = mockModelFactory(({ promptText }) =>
      promptText.includes('supplementary')
        ? { object: { pitfalls: ['a', 'b'], tip: 't' } }
        : {
            object: {
              equipment: ['a', 'b', 'c'],
              steps: ['1', '2', '3', '4'],
              pitfalls: ['a', 'b'],
            },
          },
    )
    await runBenchmark({
      cases: tipsCases,
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })

    for (const call of calls) expect(call.options.abortSignal).toBeUndefined()
    // The token ceilings come from the builders (HON-796), not from the benchmark.
    expect(calls.map((c) => c.options.maxOutputTokens).sort()).toEqual([1200, 1200, 2000, 2000])
  })

  it('records latency, usage, reasoning tokens and cost for a successful call', async () => {
    const { factory } = mockModelFactory(() => ({
      object: { ingredients: [] },
      inputTokens: 2_000,
      outputTokens: 1_000,
      reasoningTokens: 400,
    }))
    const result = await runBenchmark({
      cases: reviewCases.slice(0, 1),
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
      now: steppingClock(),
    })

    const [first] = result.calls
    expect(first).toMatchObject({
      latencyMs: 1000,
      finishReason: 'stop',
      reasoningTokens: 400,
      errorName: null,
      usage: { model: BASELINE, inputTokens: 2_000, outputTokens: 1_000 },
    })
    // $2 / $10 per MTok.
    expect(first!.costUsd).toBeCloseTo(0.004 + 0.01)
    expect(result.spendUsd).toBeCloseTo(2 * 0.014)
  })

  it('counts a truncated call as an error and still counts its tokens toward spend', async () => {
    const { factory } = mockModelFactory(() => ({
      text: '{"ingredients": [{"ingredientId": "ing-chick',
      finishReason: 'length',
      outputTokens: 1_200,
    }))
    const result = await runBenchmark({
      cases: reviewCases.slice(0, 1),
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })

    const [first] = result.calls
    expect(first).toMatchObject({
      finishReason: 'length',
      errorName: 'AI_NoObjectGeneratedError',
      usage: { outputTokens: 1_200 },
      scores: errorScores(reviewCases[0]!),
    })
    expect(first!.costUsd).toBeGreaterThan(0)
    expect(result.spendUsd).toBeCloseTo(2 * first!.costUsd)
  })

  it('scores an error as a failure only on checks the case sets up', () => {
    const [c] = reviewCases
    expect(errorScores(c!)).toEqual({ allIdsOnce: 0, seededCorrected: 0, unchangedKept: 0 })
    const noSeeded = {
      ...c!,
      input: { ...c!.input, expected: { 'ing-chicken': { unchanged: true as const } } },
    } as typeof c & {}
    expect(errorScores(noSeeded)).toEqual({
      allIdsOnce: 0,
      seededCorrected: null,
      unchangedKept: 0,
    })
  })

  it('scores an error on a not-a-recipe case against the confidence tier only', () => {
    const recipeCases = loadCases(['recipe'])
    const notARecipe = recipeCases.find((c) => c.id === 'recipe/en-not-a-recipe-restaurant-review')
    expect(errorScores(notARecipe!)).toEqual({
      recall: null,
      precision: null,
      quantityUnitMatch: null,
      confidenceAgrees: 0,
      stepCountDelta: null,
    })
    const carbonara = recipeCases.find((c) => c.id === 'recipe/en-carbonara')
    expect(errorScores(carbonara!)).toMatchObject({ recall: 0, precision: 0 })
  })

  it('does not score an errored imagine call as a forbidden ingredient', () => {
    const [c] = loadCases(['imagine'])
    expect(errorScores(c!)).toMatchObject({ allChecksPass: 0, noForbiddenIngredients: null })
  })

  it('counts the usage a NoObjectGeneratedError carries toward spend', async () => {
    const { factory } = mockModelFactory(() => ({
      object: { notTheSchema: true },
      inputTokens: 500_000,
      outputTokens: 0,
    }))
    const result = await runBenchmark({
      cases: reviewCases.slice(0, 1),
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(result.calls.map((c) => c.errorName)).toEqual([
      'AI_NoObjectGeneratedError',
      'AI_NoObjectGeneratedError',
    ])
    // 500k input tokens at $2 / MTok, per call.
    expect(result.spendUsd).toBeCloseTo(2)
  })

  it('records an unbilled failure with no usage and no cost', async () => {
    const { factory } = mockModelFactory(() => {
      throw new TypeError('socket hang up')
    })
    const result = await runBenchmark({
      cases: reviewCases.slice(0, 1),
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(result.calls[0]).toMatchObject({
      errorName: 'TypeError',
      usage: null,
      costUsd: 0,
      finishReason: null,
    })
  })

  it('stops once measured spend passes --max-usd and marks the result partial', async () => {
    // 100k output tokens at $10 / MTok: about $1 a call.
    const { factory, calls } = mockModelFactory(() => ({
      object: { ingredients: [] },
      inputTokens: 1_000,
      outputTokens: 100_000,
    }))
    const result = await runBenchmark({
      cases: reviewCases,
      baseline: BASELINE,
      candidate: CANDIDATE,
      runs: 2,
      maxUsd: 2.5,
      modelFactory: factory,
    })

    expect(result.partial).toBe(true)
    expect(calls).toHaveLength(3)
    expect(result.calls).toHaveLength(3)
    expect(result.plannedCalls).toBe(8)
    expect(result.spendUsd).toBeGreaterThan(2.5)
  })
})

describe('runCheck', () => {
  it("calls each case once per run on its task's model, as the candidate in first position", async () => {
    const { factory, calls } = mockModelFactory(() => ({ object: { ingredients: [] } }))
    const result = await runCheck({
      cases: reviewCases,
      modelFor: () => CANDIDATE,
      runs: 2,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(result.plannedCalls).toBe(4)
    expect(calls.map((c) => c.modelId)).toEqual(Array(4).fill(CANDIDATE))
    expect(result.calls.map((c) => [c.caseId, c.run, c.role, c.position])).toEqual([
      [reviewCases[0]!.id, 1, 'candidate', 1],
      [reviewCases[1]!.id, 1, 'candidate', 1],
      [reviewCases[0]!.id, 2, 'candidate', 1],
      [reviewCases[1]!.id, 2, 'candidate', 1],
    ])
    expect(result.partial).toBe(false)
  })

  it('stops once measured spend passes --max-usd', async () => {
    const { factory } = mockModelFactory(() => ({
      object: { ingredients: [] },
      outputTokens: 100_000,
    }))
    const result = await runCheck({
      cases: reviewCases,
      modelFor: () => CANDIDATE,
      runs: 2,
      maxUsd: 1.5,
      modelFactory: factory,
    })
    expect(result.partial).toBe(true)
    expect(result.calls).toHaveLength(2)
  })
})

describe('attempts', () => {
  it('records one attempt for a call that succeeded first time', async () => {
    const { factory } = mockModelFactory(() => ({ object: { ingredients: [] } }))
    const result = await runCheck({
      cases: reviewCases.slice(0, 1),
      modelFor: () => CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })
    expect(result.calls[0]!.attempts).toBe(1)
  })

  it("counts the SDK's retries, which the latency includes", { timeout: 10_000 }, async () => {
    let failures = 1
    const { factory } = mockModelFactory(() => {
      if (failures-- > 0) {
        throw new APICallError({
          message: 'Overloaded',
          url: 'https://api.anthropic.com/v1/messages',
          requestBodyValues: {},
          statusCode: 529,
          isRetryable: true,
        })
      }
      return { object: { ingredients: [] } }
    })
    const result = await runCheck({
      cases: reviewCases.slice(0, 1),
      modelFor: () => CANDIDATE,
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })
    expect(result.calls[0]).toMatchObject({ attempts: 2, errorName: null })
  })
})
