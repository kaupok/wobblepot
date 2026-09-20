import { describe, it, expect } from 'vitest'
import { isAiBudgetTimeout } from './timeout'

describe('isAiBudgetTimeout', () => {
  it('matches the TimeoutError an aborted HTTP request surfaces', () => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'

    expect(isAiBudgetTimeout(error)).toBe(true)
  })

  it('matches the AbortError a budget fired during a retry sleep surfaces', () => {
    // `retryWithExponentialBackoffInternal` awaits `delay(ms, { abortSignal })`
    // from inside its catch, and that rejects with exactly this. Missing it is
    // silent: the route falls through to its generic 500 and the user never
    // sees the timeout copy.
    expect(isAiBudgetTimeout(new DOMException('Delay was aborted', 'AbortError'))).toBe(true)
  })

  it('does not match an ordinary AI failure', () => {
    expect(isAiBudgetTimeout(new Error('upstream exploded'))).toBe(false)
  })

  it('does not match a non-Error value', () => {
    expect(isAiBudgetTimeout('TimeoutError')).toBe(false)
    expect(isAiBudgetTimeout(null)).toBe(false)
    expect(isAiBudgetTimeout(undefined)).toBe(false)
  })

  it('matches the reason an AbortSignal.timeout actually aborts with', async () => {
    // Guards the realm trap: this reason is a `DOMException`, which only
    // inherits from its own realm's `Error` — true in Node, false under jsdom.
    const signal = AbortSignal.timeout(1)
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))

    expect(isAiBudgetTimeout(signal.reason)).toBe(true)
  })
})
