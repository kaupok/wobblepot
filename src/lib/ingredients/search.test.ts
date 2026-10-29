import { describe, expect, it } from 'vitest'

import { findSynonymMatches } from '@/lib/ingredient-synonym-match'
import {
  type IngredientSearchResult,
  rankSearchHits,
  SYNONYM_SCORE,
  type SynonymRow,
} from '@/lib/ingredients/search'

// The merge of name hits and synonym rows (HON-1100, HON-1104), with fixed
// scores so each tie-break is exact. `search.db.test.ts` runs the real queries.

function hit(id: string, name: string, similarity: number): IngredientSearchResult {
  return {
    id,
    name,
    category: 'carb',
    defaultUnit: 'g',
    gramsPerPiece: null,
    measuredByVolume: false,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    proteinType: null,
    similarity,
  }
}

function synonymRow(id: string, poolName: string, similarity: number, name = poolName): SynonymRow {
  return { ...hit(id, name, similarity), poolName }
}

const rank = (
  term: string,
  nameHits: IngredientSearchResult[],
  synonymRows: SynonymRow[],
  limit = 10,
) => rankSearchHits(nameHits, synonymRows, findSynonymMatches(term), limit)

const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

describe('rankSearchHits', () => {
  it('keeps the name hits as the database ordered them when no synonym matched', () => {
    const nameHits = [hit('ing-b', 'b', 0.5), hit('ing-a', 'a', 0.5)]

    expect(rank('plain fl', nameHits, [])).toBe(nameHits)
  })

  it('returns a strong synonym hit with matchedAs and the synonym score', () => {
    const rows = rank('all-purpose fl', [], [synonymRow('ing-flour', 'plain flour', 0.1)])

    expect(rows).toEqual([
      { ...hit('ing-flour', 'plain flour', SYNONYM_SCORE), matchedAs: 'all-purpose flour' },
    ])
  })

  it('lists a row found both ways once, by its name hit, when that scores higher', () => {
    // "flour" is only part of the first word of no synonym, so the hit is weak
    // and keeps its own similarity.
    const rows = rank(
      'flour',
      [hit('ing-flour', 'plain flour', 0.35)],
      [synonymRow('ing-flour', 'plain flour', 0.35)],
    )

    expect(rows).toEqual([hit('ing-flour', 'plain flour', 0.35)])
  })

  // The whole synonym scores the row low by name, below the other flours, so
  // the synonym hit must win.
  it('ranks the row first with matchedAs when the whole synonym is typed', () => {
    const rows = rank(
      'all-purpose flour',
      [
        hit('ing-rice', 'rice flour', 0.5),
        hit('ing-00', '00 flour', 0.4),
        hit('ing-flour', 'plain flour', 0.304),
      ],
      [synonymRow('ing-flour', 'plain flour', 0.304)],
    )

    expect(ids(rows)).toEqual(['ing-flour', 'ing-rice', 'ing-00'])
    expect(rows[0]).toMatchObject({ similarity: SYNONYM_SCORE, matchedAs: 'all-purpose flour' })
  })

  it('ranks a synonym that starts with the term above partial name hits and holds the limit', () => {
    const rows = rank(
      'red bell p',
      [hit('ing-a', 'pepper a', 0.5), hit('ing-b', 'pepper b', 0.4)],
      [synonymRow('ing-red', 'red pepper', 0.2)],
      2,
    )

    expect(ids(rows)).toEqual(['ing-red', 'ing-a'])
    expect(rows[0]).toMatchObject({ similarity: SYNONYM_SCORE, matchedAs: 'red bell pepper' })
  })

  // "pepper" only starts a later word of "red bell pepper": a generic word, so
  // the row keeps its own name score rather than jumping to the top.
  it('keeps the name score for a synonym whose later word starts with the term', () => {
    const rows = rank(
      'pepper',
      [hit('ing-bell', 'bell pepper', 0.58), hit('ing-black', 'black pepper', 0.54)],
      [synonymRow('ing-red', 'red pepper', 0.44), synonymRow('ing-bell', 'bell pepper', 0.58)],
      3,
    )

    expect(rows).toEqual([
      hit('ing-bell', 'bell pepper', 0.58),
      hit('ing-black', 'black pepper', 0.54),
      { ...hit('ing-red', 'red pepper', 0.44), matchedAs: 'red bell pepper' },
    ])
  })

  // HON-1104: "egg" only starts "eggplant", a weak hit under four characters,
  // so aubergine keeps its own name score below the egg rows.
  it('ranks the name hits above a one-word synonym a short term starts', () => {
    const rows = rank(
      'egg',
      [hit('ing-egg', 'egg', 1), hit('ing-noodles', 'egg noodles', 0.33)],
      [synonymRow('ing-aubergine', 'aubergine', 0)],
    )

    expect(ids(rows)).toEqual(['ing-egg', 'ing-noodles', 'ing-aubergine'])
    expect(rows[2]).toMatchObject({ similarity: 0, matchedAs: 'eggplant' })
  })

  it('ranks a one-word synonym first from four characters', () => {
    const rows = rank('zucc', [], [synonymRow('ing-courgette', 'courgette', 0)])

    expect(rows[0]).toMatchObject({
      id: 'ing-courgette',
      similarity: SYNONYM_SCORE,
      matchedAs: 'zucchini',
    })
  })

  it('breaks a tie in score by name', () => {
    const rows = rank(
      'zucc',
      [hit('ing-b', 'b row', SYNONYM_SCORE), hit('ing-a', 'a row', SYNONYM_SCORE)],
      [synonymRow('ing-courgette', 'courgette', 0)],
    )

    expect(ids(rows)).toEqual(['ing-a', 'ing-b', 'ing-courgette'])
  })

  it('returns the display name the query gave, with the English synonym', () => {
    const rows = rank(
      'all-purpose flour',
      [],
      [synonymRow('ing-flour', 'plain flour', 0.3, 'nisujahu')],
    )

    expect(rows[0]).toMatchObject({ name: 'nisujahu', matchedAs: 'all-purpose flour' })
  })
})
