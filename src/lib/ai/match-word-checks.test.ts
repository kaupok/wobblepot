import { describe, expect, it } from 'vitest'

import { isBareLastWord, primaryNounsDiffer } from './match-word-checks'

describe('primaryNounsDiffer', () => {
  it('reads a word and its plural as one noun when the plural never singularizes', () => {
    expect(primaryNounsDiffer('dried chive', 'dried chives')).toBe(false)
  })

  it('flags names where each side has a word the other lacks', () => {
    expect(primaryNounsDiffer('trout fillet', 'cod fillet')).toBe(true)
  })

  it('does not flag a bare row, which has no word of its own', () => {
    expect(primaryNounsDiffer('walnut butter', 'butter')).toBe(false)
  })

  it('does not flag a plural of the same name', () => {
    expect(primaryNounsDiffer('bay leaf', 'Bay Leaves')).toBe(false)
  })

  it('reads a hyphen as a word break on both sides', () => {
    expect(primaryNounsDiffer('chia seemned', 'chia-seemned')).toBe(false)
    expect(primaryNounsDiffer('black eyed beans', 'Black-eyed beans')).toBe(false)
    expect(primaryNounsDiffer('self-raising flour', 'self raising flour')).toBe(false)
  })
})

describe('isBareLastWord', () => {
  it('flags a qualified name matched to its bare last word', () => {
    expect(isBareLastWord('walnut butter', 'Butter')).toBe(true)
    expect(isBareLastWord('kašu või', 'või')).toBe(true)
  })

  it('flags a bare row with a plural name against the singular normalized name', () => {
    expect(isBareLastWord('wasabi pea', 'peas')).toBe(true)
    expect(isBareLastWord('shirataki noodle', 'Noodles')).toBe(true)
  })

  it('does not flag a one-word name or a longer matched name', () => {
    expect(isBareLastWord('bread', 'bread')).toBe(false)
    expect(isBareLastWord('dark soy sauce', 'soy sauce')).toBe(false)
  })
})
