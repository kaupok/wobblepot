import { describe, it, expect } from 'vitest'
import { comparePantryItems } from './pantry-order'

// Names whose order differs between English and Estonian collation: Estonian
// puts `š` after `s` and `õ` near the end of the alphabet.
const NAMES = ['šokolaad', 'suhkur', 'sibul', 'õun', 'oder']

function item(name: string, isStaple = false) {
  return { isStaple, ingredient: { name } }
}

function sortedNames(locale: string, items = NAMES.map((name) => item(name))) {
  return [...items].sort(comparePantryItems(locale)).map((i) => i.ingredient.name)
}

describe('comparePantryItems', () => {
  it('sorts in Estonian alphabetical order for et', () => {
    expect(sortedNames('et')).toEqual(['oder', 'sibul', 'suhkur', 'šokolaad', 'õun'])
  })

  it('sorts in English alphabetical order for en', () => {
    expect(sortedNames('en')).toEqual(['oder', 'õun', 'sibul', 'šokolaad', 'suhkur'])
  })

  it('puts staples first, each group in name order', () => {
    const items = [item('õun', true), item('suhkur'), item('oder', true), item('sibul')]
    expect(sortedNames('et', items)).toEqual(['oder', 'õun', 'sibul', 'suhkur'])
  })
})
