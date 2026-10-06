import { describe, it, expect } from 'vitest'
import { findSynonymMatches } from './ingredient-synonym-match'

describe('findSynonymMatches', () => {
  it('matches a key that starts with the term', () => {
    expect(findSynonymMatches('plain fl')).toEqual([
      { target: 'all-purpose flour', synonym: 'plain flour', strong: true },
    ])
  })

  it('matches a later word of the key', () => {
    expect(findSynonymMatches('artich')).toEqual([
      { target: 'sunchoke', synonym: 'jerusalem artichoke', strong: false },
    ])
  })

  it('ignores case and surrounding whitespace', () => {
    expect(findSynonymMatches('  ICING ')).toEqual([
      { target: 'powdered sugar', synonym: 'icing sugar', strong: false },
    ])
  })

  it('returns nothing for a term under three characters', () => {
    expect(findSynonymMatches('sw')).toEqual([])
    expect(findSynonymMatches('swe').map((m) => m.synonym)).toEqual(['swede', 'sweet pepper'])
    expect(findSynonymMatches('swed')).toEqual([
      { target: 'rutabaga', synonym: 'swede', strong: true },
    ])
  })

  it('does not match the middle of a word', () => {
    expect(findSynonymMatches('lour')).toEqual([])
  })

  // HON-1100 review: a generic first word must not outrank the rows named by it.
  it('is strong only when the term picks out the synonym', () => {
    const strongOf = (term: string) =>
      Object.fromEntries(findSynonymMatches(term).map((m) => [m.synonym, m.strong]))

    expect(strongOf('zucc')).toEqual({})
    expect(strongOf('swed')).toEqual({ swede: true })
    expect(strongOf('plain')).toEqual({ 'plain flour': false })
    expect(strongOf('pla')).toEqual({ 'plain flour': false })
    expect(strongOf('plain f')).toEqual({ 'plain flour': true })
    expect(strongOf('sweet')).toEqual({ 'sweet pepper': false })
    expect(strongOf('red pep')).toEqual({ 'red pepper': true })
    expect(strongOf('pepper')['red pepper']).toBe(false)
  })

  it('returns one match per target, preferring a strong match', () => {
    // "scallion" and "green onion" both point at spring onion; "bicarbonate of
    // soda" and "bicarb" both point at baking soda.
    expect(findSynonymMatches('bicarb')).toEqual([
      { target: 'baking soda', synonym: 'bicarb', strong: true },
    ])
    const onion = findSynonymMatches('onion')
    expect(onion).toEqual([{ target: 'spring onion', synonym: 'green onion', strong: false }])
  })

  it('returns every distinct target a term matches', () => {
    const targets = findSynonymMatches('pepper').map((m) => m.target)
    expect(targets).toEqual(
      expect.arrayContaining([
        'red bell pepper',
        'green bell pepper',
        'yellow bell pepper',
        'bell pepper',
      ]),
    )
    expect(new Set(targets).size).toBe(targets.length)
  })
})
