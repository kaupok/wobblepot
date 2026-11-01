import { describe, expect, it } from 'vitest'

import { isBareLastWord, primaryNounsDiffer } from './match-word-checks'

describe('primaryNounsDiffer', () => {
  it('flags names where each side has a word the other lacks', () => {
    expect(primaryNounsDiffer('trout fillet', 'cod fillet')).toBe(true)
  })

  it('does not flag a bare row, which has no word of its own', () => {
    expect(primaryNounsDiffer('walnut butter', 'butter')).toBe(false)
  })

  it('does not flag a plural of the same name', () => {
    expect(primaryNounsDiffer('bay leaf', 'Bay Leaves')).toBe(false)
  })
})

describe('isBareLastWord', () => {
  it('flags a qualified name matched to its bare last word', () => {
    expect(isBareLastWord('walnut butter', 'Butter')).toBe(true)
    expect(isBareLastWord('kašu või', 'või')).toBe(true)
  })

  it('does not flag a one-word name or a longer matched name', () => {
    expect(isBareLastWord('bread', 'bread')).toBe(false)
    expect(isBareLastWord('dark soy sauce', 'soy sauce')).toBe(false)
  })
})
