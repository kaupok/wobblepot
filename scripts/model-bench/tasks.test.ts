import { describe, expect, it } from 'vitest'
import { evaluateGate } from './report'
import { TASK_SPECS } from './tasks'

describe('the cook-question "No unbacked claim" gate', () => {
  const metric = TASK_SPECS['cook-question'].metrics.find((m) => m.key === 'avoidsClaims')!
  const over9 = (passed: number) => ({ mean: passed / 9, min: passed / 9, max: passed / 9 })

  it('passes one slip in the 9 scores of three cases and 3 runs', () => {
    expect(evaluateGate(metric, over9(8))).toBe('pass')
  })

  it('fails a case that slips on every run, as the pre-HON-1372 golden did', () => {
    // The golden wrote "the household has" in 3 of 3 runs and scored 6 of 9.
    expect(evaluateGate(metric, over9(6))).toBe('fail')
    expect(evaluateGate(metric, over9(7))).toBe('fail')
  })
})
