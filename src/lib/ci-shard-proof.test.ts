import { describe, expect, it } from 'vitest'

// Temporary (HON-1203): proves a failing test in a shard fails CI. Reverted next.
describe('ci shard proof', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2)
  })
})
