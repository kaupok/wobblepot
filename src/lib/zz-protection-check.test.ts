import { describe, it, expect } from 'vitest'

// Throwaway, for HON-584: this test fails on purpose so the PR's
// `Lint, Type Check & Test` check is red, which must block `gh pr merge`.
// The PR is closed and the branch deleted once that is confirmed.
describe('branch protection check (HON-584)', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2)
  })
})
