import { describe, it, expect } from 'vitest'
import { estimateCostUsd, MODEL_PRICES } from './pricing'

describe('estimateCostUsd', () => {
  it('charges 1M input tokens at the table rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(cost).toBe(MODEL_PRICES['claude-sonnet-4-6']!.inputPerMTok)
  })

  it('charges 1M output tokens at the table rate', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 1_000_000,
    })
    expect(cost).toBe(MODEL_PRICES['claude-sonnet-4-6']!.outputPerMTok)
  })

  it('sums input + output for combined token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBe(
      MODEL_PRICES['claude-sonnet-4-6']!.inputPerMTok +
        MODEL_PRICES['claude-sonnet-4-6']!.outputPerMTok,
    )
  })

  it('scales linearly for partial token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 200,
    })
    // 1000 * 3/1M + 200 * 15/1M = 0.003 + 0.003 = 0.006
    expect(cost).toBeCloseTo(0.006, 6)
  })

  it('returns 0 for an unknown model', () => {
    expect(estimateCostUsd({ model: 'made-up-model', inputTokens: 1000, outputTokens: 1000 })).toBe(
      0,
    )
  })

  it('returns 0 when token counts are 0', () => {
    expect(estimateCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})
