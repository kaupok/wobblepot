import { describe, it, expect } from 'vitest'
import { findSynonymMatches } from './ingredient-synonym-match'

describe('findSynonymMatches', () => {
  it('matches a key that starts with the term', () => {
    expect(findSynonymMatches('plain fl')).toEqual([
      { target: 'all-purpose flour', synonym: 'plain flour' },
    ])
  })

  it('matches a later word of the key', () => {
    expect(findSynonymMatches('artich')).toEqual([
      { target: 'sunchoke', synonym: 'jerusalem artichoke' },
    ])
  })

  it('ignores case and surrounding whitespace', () => {
    expect(findSynonymMatches('  ICING ')).toEqual([
      { target: 'powdered sugar', synonym: 'icing sugar' },
    ])
  })

  it('returns nothing for a term under three characters', () => {
    expect(findSynonymMatches('sw')).toEqual([])
    expect(findSynonymMatches('swe').map((m) => m.synonym)).toEqual(['swede', 'sweet pepper'])
    expect(findSynonymMatches('swed')).toEqual([{ target: 'rutabaga', synonym: 'swede' }])
  })

  it('does not match the middle of a word', () => {
    expect(findSynonymMatches('lour')).toEqual([])
  })

  it('returns one match per target, preferring a key that starts with the term', () => {
    // "scallion" and "green onion" both point at spring onion; "bicarbonate of
    // soda" and "bicarb" both point at baking soda.
    expect(findSynonymMatches('bicarb')).toEqual([
      { target: 'baking soda', synonym: 'bicarbonate of soda' },
    ])
    const onion = findSynonymMatches('onion')
    expect(onion).toEqual([{ target: 'spring onion', synonym: 'green onion' }])
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
