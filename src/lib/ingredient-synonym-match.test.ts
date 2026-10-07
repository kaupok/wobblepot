import { describe, it, expect } from 'vitest'
import { findSynonymMatches } from './ingredient-synonym-match'

describe('findSynonymMatches', () => {
  it('matches a key that starts with the term', () => {
    expect(findSynonymMatches('all-purpose fl')).toEqual([
      { target: 'plain flour', synonym: 'all-purpose flour', strong: true },
    ])
  })

  // HON-1099: the pantry quick-add offers "plain flour (all-purpose flour)" for
  // "all-purpose", and "plain flour" with no bracket for "plain fl", because
  // plain flour is the pool's own name now.
  it('finds a renamed pool row by its American name, and not by its own', () => {
    expect(findSynonymMatches('all-purpose')).toEqual([
      { target: 'plain flour', synonym: 'all-purpose flour', strong: false },
    ])
    expect(findSynonymMatches('plain fl')).toEqual([])
    expect(findSynonymMatches('cornst')).toEqual([
      { target: 'cornflour', synonym: 'cornstarch', strong: true },
    ])
  })

  it('matches a later word of the key', () => {
    expect(findSynonymMatches('cabb')).toEqual([
      { target: 'chinese leaf', synonym: 'napa cabbage', strong: false },
    ])
  })

  it('ignores case and surrounding whitespace', () => {
    expect(findSynonymMatches('  POWDERED ')).toEqual([
      { target: 'icing sugar', synonym: 'powdered sugar', strong: false },
    ])
  })

  it('returns nothing for a term under three characters', () => {
    expect(findSynonymMatches('ru')).toEqual([])
    expect(findSynonymMatches('rut')).toEqual([
      { target: 'swede', synonym: 'rutabaga', strong: true },
    ])
  })

  // HON-1083: the pantry quick-add offers "courgette (zucchini)" for "zucc".
  it('finds a renamed seeded row by its American name', () => {
    expect(findSynonymMatches('zucc')).toEqual([
      { target: 'courgette', synonym: 'zucchini', strong: true },
    ])
    expect(findSynonymMatches('eggpl')).toEqual([
      { target: 'aubergine', synonym: 'eggplant', strong: true },
    ])
  })

  // HON-1097: the pantry quick-add offers "prawns (shrimp)" for "shrimp".
  it('finds a merged row by its American name', () => {
    expect(findSynonymMatches('shrimp')).toEqual([
      { target: 'prawns', synonym: 'shrimp', strong: true },
      { target: 'peeled prawns', synonym: 'shrimp peeled', strong: false },
      { target: 'small prawns', synonym: 'baby shrimp', strong: false },
      { target: 'cooked prawns', synonym: 'cooked shrimp', strong: false },
    ])
    expect(findSynonymMatches('heavy cr')).toEqual([
      { target: 'double cream', synonym: 'heavy cream', strong: true },
    ])
  })

  it('does not match the middle of a word', () => {
    expect(findSynonymMatches('lour')).toEqual([])
  })

  // HON-1100 review: a generic first word must not outrank the rows named by it.
  it('is strong only when the term picks out the synonym', () => {
    const strongOf = (term: string) =>
      Object.fromEntries(findSynonymMatches(term).map((m) => [m.synonym, m.strong]))

    expect(strongOf('zucc')).toEqual({ zucchini: true })
    expect(strongOf('ruta')).toEqual({ rutabaga: true })
    expect(strongOf('all-purpose')).toEqual({ 'all-purpose flour': false })
    expect(strongOf('all')).toEqual({ 'all-purpose flour': false })
    expect(strongOf('all-purpose f')).toEqual({ 'all-purpose flour': true })
    expect(strongOf('sweet')).toEqual({ 'sweet pepper': false, 'sweet chili sauce': false })
    expect(strongOf('red bell p')).toEqual({ 'red bell pepper': true })
    expect(strongOf('pepper')['red bell pepper']).toBe(false)
  })

  it('returns one match per target, preferring a strong match', () => {
    // "scallion" and "green onion" both point at spring onion; "powdered
    // sugar" and "confectioners sugar" both point at icing sugar.
    expect(findSynonymMatches('bicarb')).toEqual([
      { target: 'bicarbonate of soda', synonym: 'bicarb', strong: true },
    ])
    expect(findSynonymMatches('sugar')).toEqual([
      { target: 'icing sugar', synonym: 'powdered sugar', strong: false },
      { target: 'caster sugar', synonym: 'superfine sugar', strong: false },
    ])
    const onion = findSynonymMatches('onion')
    expect(onion).toEqual([{ target: 'spring onion', synonym: 'green onion', strong: false }])
  })

  it('returns every distinct target a term matches', () => {
    const targets = findSynonymMatches('pepper').map((m) => m.target)
    expect(targets).toEqual(
      expect.arrayContaining(['red pepper', 'green pepper', 'yellow pepper', 'bell pepper']),
    )
    expect(new Set(targets).size).toBe(targets.length)
  })
})
