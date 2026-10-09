import { afterEach, describe, expect, it, vi } from 'vitest'
import { markFirstPlanGenerated, takeFirstPlanGenerated } from './first-plan-focus'

describe('first-plan focus flag', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('is false when nothing marked it', () => {
    expect(takeFirstPlanGenerated()).toBe(false)
  })

  it('is true once after a mark, then false', () => {
    markFirstPlanGenerated()
    expect(takeFirstPlanGenerated()).toBe(true)
    expect(takeFirstPlanGenerated()).toBe(false)
  })

  it('does not throw when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => markFirstPlanGenerated()).not.toThrow()
    expect(takeFirstPlanGenerated()).toBe(false)
  })
})
