import { describe, expect, it } from 'vitest'

import {
  formatPieceFraction,
  formatPieceStoredCount,
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
const carrot: PieceDisplayIngredient = {
  defaultUnit: 'g',
  gramsPerPiece: 60,
  pieceDisplay: 'recipe_and_shopping',
}
const tomato: PieceDisplayIngredient = {
  defaultUnit: 'g',
  gramsPerPiece: 120,
  pieceDisplay: 'recipe',
}

// The HON-1474 table: grams, ingredient, the recipe line's count.
const RECIPE_HINTS = [
  [500, 'potato', potato, '~3'],
  [300, 'potato', potato, '2'],
  [330, 'potato', potato, '~2'],
  [200, 'carrot', carrot, '~3'],
  [45, 'carrot', carrot, '~1'],
  [300, 'tomato', tomato, '~3'],
  [8, 'garlic', garlic, '~2'],
  [55, 'onion', onion, '½'],
  [30, 'onion', onion, '~½'],
  [165, 'onion', onion, '1½'],
  [190, 'onion', onion, '~2'],
] as const

describe('recipePieceCount', () => {
  it('rounds a big piece to the nearest half below 1¾: 165 g onion is 1½', () => {
    expect(recipePieceCount(165, onion)).toEqual({ pieces: 1.5, approximate: false })
  })

  it('rounds a big piece to the nearest whole from 1¾ up: 190 g onion is ~2', () => {
    expect(recipePieceCount(190, onion)).toEqual({ pieces: 2, approximate: true })
  })

  it('rounds a small piece to the nearest whole: 8 g garlic is ~2 cloves', () => {
    expect(recipePieceCount(8, garlic)).toEqual({ pieces: 2, approximate: true })
  })

  it('marks an exact count as not approximate: 300 g potato is 2', () => {
    expect(recipePieceCount(300, potato)).toEqual({ pieces: 2, approximate: false })
  })

  it('never shows less than ½ of a big piece', () => {
    expect(recipePieceCount(5, onion)).toEqual({ pieces: 0.5, approximate: true })
  })

  it('never shows less than 1 small piece', () => {
    expect(recipePieceCount(10, carrot)).toEqual({ pieces: 1, approximate: true })
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
    [{ pieces: 0.5, approximate: false }, 'en', '½'],
    [{ pieces: 0.5, approximate: true }, 'en', '~½'],
    [{ pieces: 1.5, approximate: false }, 'en', '1½'],
    [{ pieces: 3, approximate: true }, 'en', '~3'],
    [{ pieces: 2, approximate: false }, 'et', '2'],
    [{ pieces: 1.5, approximate: true }, 'et', '~1½'],
  ] as const)('formats %j in %s as %j', (count, locale, expected) => {
    expect(formatPieceFraction(count, locale)).toBe(expected)
  })
})

describe('formatPieceStoredCount', () => {
  it.each([
    [0.5, 'en', '½'],
    [0.5, 'et', '½'],
    [1.5, 'en', '1½'],
    [1.5, 'et', '1½'],
    [2, 'en', '2'],
    [0.3, 'en', '0.3'],
    [0.3, 'et', '0,3'],
    [1.5000000000000002, 'en', '1½'],
    [0.33 * 1.5, 'en', '½'],
    [0.33 * 4.5, 'et', '1½'],
    [0.7, 'en', '0.7'],
    [2.25, 'et', '2,3'],
  ] as const)('formats %d in %s as %j', (count, locale, expected) => {
    expect(formatPieceStoredCount(count, locale)).toBe(expected)
  })
})

describe('the recipe piece hint', () => {
  describe.each(['en', 'et'] as const)('in %s', (locale) => {
    it.each(RECIPE_HINTS)('shows %d g %s as %j', (grams, _, ingredient, expected) => {
      const count = recipePieceCount(grams, ingredient)
      expect(count && formatPieceFraction(count, locale)).toBe(expected)
    })
  })

  // The count, not the glyph: the formatter cannot write ¼ or ¾, so only the
  // count shows a return to quarter rounding.
  it('counts big pieces in halves and small pieces whole, from 1 g to 1 kg', () => {
    for (const ingredient of [onion, garlic, potato, carrot, tomato]) {
      const steps = ingredient.gramsPerPiece! >= 100 ? 2 : 1
      for (let grams = 1; grams <= 1000; grams++) {
        const count = recipePieceCount(grams, ingredient)!
        expect(Number.isInteger(count.pieces * steps), `${grams} g: ${count.pieces}`).toBe(true)
        expect(formatPieceFraction(count, 'en')).not.toMatch(/[¼¾]/)
      }
    }
  })
})
