import { describe, expect, it } from 'vitest'

import {
  formatPieceFraction,
  type PieceDisplayIngredient,
  recipePieceCount,
  shoppingPieceCount,
} from './format-piece-quantity'

const onion: PieceDisplayIngredient = {
  defaultUnit: 'g',
  gramsPerPiece: 110,
  pieceDisplay: 'recipe_and_shopping',
}
const garlic: PieceDisplayIngredient = {
  defaultUnit: 'g',
  gramsPerPiece: 5,
  pieceDisplay: 'recipe_and_shopping',
}
const potato: PieceDisplayIngredient = {
  defaultUnit: 'g',
  gramsPerPiece: 150,
  pieceDisplay: 'recipe',
}

describe('recipePieceCount', () => {
  it('rounds to the nearest quarter: 83 g onion is ¾', () => {
    expect(recipePieceCount(83, onion)).toBe(0.75)
  })

  it('shows 8 g garlic as 1½ cloves', () => {
    expect(recipePieceCount(8, garlic)).toBe(1.5)
  })

  it('shows 450 g potato as 3 pieces', () => {
    expect(recipePieceCount(450, potato)).toBe(3)
  })

  it('never shows less than ¼', () => {
    expect(recipePieceCount(5, onion)).toBe(0.25)
  })

  it.each<[string, PieceDisplayIngredient]>([
    ['no flag', { defaultUnit: 'g', gramsPerPiece: 110 }],
    ['the none flag', { defaultUnit: 'g', gramsPerPiece: 110, pieceDisplay: 'none' }],
    ['no gramsPerPiece', { defaultUnit: 'g', gramsPerPiece: null, pieceDisplay: 'recipe' }],
    [
      'a volume ingredient',
      { defaultUnit: 'g', gramsPerPiece: 10, measuredByVolume: true, pieceDisplay: 'recipe' },
    ],
    [
      'a piece-stored ingredient',
      { defaultUnit: 'piece', gramsPerPiece: 150, pieceDisplay: 'recipe' },
    ],
  ])('falls back to the unit display with %s', (_, ingredient) => {
    expect(recipePieceCount(83, ingredient)).toBeNull()
  })
})

describe('shoppingPieceCount', () => {
  it('rounds 83 g onion up to 1', () => {
    expect(shoppingPieceCount(83, onion)).toBe(1)
  })

  it('rounds 8 g garlic up to 2 cloves', () => {
    expect(shoppingPieceCount(8, garlic)).toBe(2)
  })

  it('rounds the summed 165 g onion up to 2', () => {
    expect(shoppingPieceCount(165, onion)).toBe(2)
  })

  it('keeps potato in grams: it is sold by weight', () => {
    expect(shoppingPieceCount(450, potato)).toBeNull()
  })

  it('does not round float residue up to an extra piece', () => {
    expect(shoppingPieceCount((220 / 3) * 3, onion)).toBe(2)
  })
})

describe('formatPieceFraction', () => {
  it.each([
    [0.25, 'en', '¼'],
    [0.5, 'en', '½'],
    [0.75, 'en', '¾'],
    [1.5, 'en', '1½'],
    [3, 'en', '3'],
    [0.75, 'et', '¾'],
    [2.25, 'et', '2¼'],
  ] as const)('formats %d in %s as %j', (pieces, locale, expected) => {
    expect(formatPieceFraction(pieces, locale)).toBe(expected)
  })
})
