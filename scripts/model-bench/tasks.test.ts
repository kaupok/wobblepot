import { describe, expect, it } from 'vitest'

import { evaluateGate } from './report'
import { TASK_SPECS } from './tasks'

describe('the cook-question "No unbacked claim" gate', () => {
  const metric = TASK_SPECS['cook-question'].metrics.find((m) => m.key === 'avoidsClaims')!
  const over15 = (passed: number) => ({ mean: passed / 15, min: passed / 15, max: passed / 15 })

  it('passes two slips in the 15 scores of five cases and 3 runs', () => {
    expect(evaluateGate(metric, over15(14))).toBe('pass')
    expect(evaluateGate(metric, over15(13))).toBe('pass')
  })

  it('fails a case that slips on every run, as the pre-HON-1372 golden did', () => {
    // The golden wrote "the household has" in 3 of 3 runs of one case.
    expect(evaluateGate(metric, over15(12))).toBe('fail')
  })
})

describe('the cook-question "No draft or note to itself" gate', () => {
  const metric = TASK_SPECS['cook-question'].metrics.find((m) => m.key === 'noMetaText')!

  it('fails one leaked draft in a run (HON-1506)', () => {
    expect(evaluateGate(metric, { mean: 62 / 63, min: 20 / 21, max: 1 })).toBe('fail')
    expect(evaluateGate(metric, { mean: 1, min: 1, max: 1 })).toBe('pass')
  })
})
