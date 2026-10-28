import { describe, expect, it } from 'vitest'
import { evaluateGate } from './report'
import { TASK_SPECS } from './tasks'

describe('the cook-question "No unbacked claim" gate', () => {
  const metric = TASK_SPECS['cook-question'].metrics.find((m) => m.key === 'avoidsClaims')!
  const over12 = (passed: number) => ({ mean: passed / 12, min: passed / 12, max: passed / 12 })

  it('passes one slip in the 12 scores of four cases and 3 runs', () => {
    expect(evaluateGate(metric, over12(11))).toBe('pass')
  })

  it('fails a case that slips on every run, as the pre-HON-1372 golden did', () => {
    // The golden wrote "the household has" in 3 of 3 runs of one case.
    expect(evaluateGate(metric, over12(9))).toBe('fail')
    expect(evaluateGate(metric, over12(10))).toBe('fail')
  })
})
