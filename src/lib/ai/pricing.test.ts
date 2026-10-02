import { describe, it, expect } from 'vitest'
import { estimateCostUsd, MODEL_PRICES } from './pricing'
import {
  PLANNING_MODEL,
  RECIPE_MODEL,
  TIPS_MODEL,
  IMAGINE_MODEL,
  REVIEW_MODEL,
  COOK_QUESTION_MODEL,
} from './models'

describe('estimateCostUsd', () => {
  it('charges 1M input tokens at the table rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(cost).toBe(MODEL_PRICES['claude-sonnet-5-5']!.inputPerMTok)
  })

  it('charges 1M output tokens at the table rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      outputTokens: 1_000_000,
    })
    expect(cost).toBe(MODEL_PRICES['claude-sonnet-5-5']!.outputPerMTok)
  })

  it('sums input + output for combined token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBe(
      MODEL_PRICES['claude-sonnet-5-5']!.inputPerMTok +
        MODEL_PRICES['claude-sonnet-5-5']!.outputPerMTok,
    )
  })

  it('scales linearly for partial token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 1000,
      outputTokens: 200,
    })
    // 1000 * 2/1M + 200 * 10/1M = 0.002 + 0.002 = 0.004
    expect(cost).toBeCloseTo(0.004, 6)
  })

  it('returns 0 for an unknown model', () => {
    expect(estimateCostUsd({ model: 'made-up-model', inputTokens: 1000, outputTokens: 1000 })).toBe(
      0,
    )
  })

  it('returns 0 when token counts are 0', () => {
    expect(estimateCostUsd({ model: 'claude-sonnet-5-5', inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  // The guard that matters for *live* traffic. `estimateCostUsd` returns 0 for
  // a model it doesn't know, and that zero is not an error anywhere: it lands
  // in `AiUsage.estimatedCostUsd`, which `assertUnderCap` sums, so a model
  // constant with no price entry silently disables the monthly spend cap. The
  // next upgrade will edit `models.ts`; this fails the build if it forgets
  // `MODEL_PRICES`.
  it.each([
    ['PLANNING_MODEL', PLANNING_MODEL],
    ['RECIPE_MODEL', RECIPE_MODEL],
    ['TIPS_MODEL', TIPS_MODEL],
    ['IMAGINE_MODEL', IMAGINE_MODEL],
    ['REVIEW_MODEL', REVIEW_MODEL],
    ['COOK_QUESTION_MODEL', COOK_QUESTION_MODEL],
  ])('prices %s, so the spend cap cannot be zeroed by an unpriced model', (_name, model) => {
    expect(MODEL_PRICES[model]).toBeDefined()
    expect(estimateCostUsd({ model, inputTokens: 1000, outputTokens: 1000 })).toBeGreaterThan(0)
  })

  // The app moved to Sonnet 5 in HON-693 and to Sonnet 5.5 in HON-794, but
  // usage rows written before each upgrade still name the older model.
  // Dropping an entry would silently reprice its model to $0 via the
  // unknown-model path, so the retention is a requirement, not leftover cruft.
  it.each([
    ['claude-sonnet-5', 12],
    ['claude-sonnet-4-6', 18],
  ])('still prices the superseded %s for historical usage rows', (model, expected) => {
    const cost = estimateCostUsd({
      model,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBe(expected)
  })
})

describe('estimateCostUsd › prompt-cache tiers', () => {
  const price = MODEL_PRICES['claude-sonnet-5-5']!

  it('carries both cache rates for every Claude model in the table', () => {
    // The OpenAI image model is excluded: it uses no prompt caching.
    const claude = Object.entries(MODEL_PRICES).filter(([model]) => model.startsWith('claude-'))
    expect(claude.length).toBeGreaterThan(0)
    for (const [model, entry] of claude) {
      expect(entry.cacheReadPerMTok, model).toBeGreaterThan(0)
      expect(entry.cacheWritePerMTok, model).toBeGreaterThan(0)
      // Anthropic prices cache reads below, and cache writes above, base input.
      expect(entry.cacheReadPerMTok, model).toBeLessThan(entry.inputPerMTok)
      expect(entry.cacheWritePerMTok, model).toBeGreaterThan(entry.inputPerMTok)
    }
  })

  it('prices the meal-image model at the OpenAI image rates (HON-735)', () => {
    expect(
      estimateCostUsd({ model: 'gpt-image-2.5-flare', inputTokens: 110, outputTokens: 1_372 }),
    ).toBeCloseTo(0.04171, 5)
  })

  // The model benchmark's judge (HON-798). Without an entry `--judge` exits at
  // startup, and a $0 price would let judge calls slip past `--max-usd`.
  it('prices the benchmark judge claude-opus-5-5 at its own cache-read rate', () => {
    // 1M each of input, output, 5m cache write and cache read: $4 + $20 + $5 + $0.20.
    expect(
      estimateCostUsd({
        model: 'claude-opus-5-5',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(29.2, 10)
  })

  it('bills cache-read tokens below the all-at-base-rate figure by the rate difference', () => {
    const inputTokens = 1031
    const cacheReadTokens = 500
    const outputTokens = 787

    const tiered = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens,
      cacheReadTokens,
      outputTokens,
    })
    const allAtBaseRate = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: inputTokens + cacheReadTokens,
      outputTokens,
    })

    // 500 × ($2.00 − $0.20) / 1M = $0.0009 cheaper.
    expect(allAtBaseRate - tiered).toBeCloseTo(
      (cacheReadTokens * (price.inputPerMTok - price.cacheReadPerMTok)) / 1_000_000,
      12,
    )
    expect(allAtBaseRate - tiered).toBeCloseTo(0.0009, 12)
  })

  it('charges 1M cache-read tokens at the cache-read rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      cacheReadTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(cost).toBeCloseTo(price.cacheReadPerMTok, 12)
  })

  it('charges 1M cache-write tokens at the cache-write rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 0,
      cacheWriteTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(cost).toBe(price.cacheWritePerMTok)
  })

  it('sums every tier for a mixed call', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    // $2 + $0.20 + $2.50 + $10
    expect(cost).toBeCloseTo(14.7, 9)
  })

  it('matches the uncached figure when cache counts are explicitly 0', () => {
    const withZeros = estimateCostUsd({
      model: 'claude-sonnet-5-5',
      inputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 200,
    })
    expect(withZeros).toBe(
      estimateCostUsd({ model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 200 }),
    )
  })

  it('returns 0 for an unknown model even with cache tokens', () => {
    expect(
      estimateCostUsd({
        model: 'made-up-model',
        inputTokens: 1000,
        cacheReadTokens: 1000,
        cacheWriteTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBe(0)
  })
})
