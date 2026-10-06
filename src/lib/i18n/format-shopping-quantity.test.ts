import { describe, it, expect } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import {
  displayUnit,
  formatMeasure,
  formatShoppingQuantity as format,
  formatVolume,
  formatWeight,
  withPieceUnit,
  type DisplayUnit,
} from './format-shopping-quantity'
import type { Locale } from './locales'
import type { VaguePhraseKey } from './vague-phrase'

const vagueLabels = { en: enMessages.enums.VaguePhrase, et: etMessages.enums.VaguePhrase }
const pieceLabels = { en: enMessages.enums.Unit.piece, et: etMessages.enums.Unit.piece }

// The no-break space the piece label hangs on (HON-956).
const NBSP = '\u00a0'

/** Formats with the locale's own `enums.VaguePhrase` and `enums.Unit` labels, as the server callers do. */
function formatShoppingQuantity(
  quantity: number,
  unit: DisplayUnit,
  locale: Locale,
  isVague = false,
  originalPhrase: string | null = null,
) {
  const tVague = (key: VaguePhraseKey) => vagueLabels[locale][key]
  return format(quantity, unit, locale, isVague, originalPhrase, tVague, pieceLabels[locale])
}

describe('formatShoppingQuantity', () => {
  describe('grams', () => {
    it('renders sub-kilogram quantities as integer grams', () => {
      expect(formatShoppingQuantity(600, 'g', 'en')).toBe('600g')
      expect(formatShoppingQuantity(600, 'g', 'et')).toBe('600g')
    })

    it('rounds non-integer gram quantities', () => {
      expect(formatShoppingQuantity(123.7, 'g', 'en')).toBe('124g')
    })

    it('renders zero grams', () => {
      expect(formatShoppingQuantity(0, 'g', 'en')).toBe('0g')
    })
  })

  // A flagged liquid: the stored grams read as millilitres, 1:1 (HON-1054).
  describe('millilitres', () => {
    it('renders a flagged ingredient in ml', () => {
      expect(formatShoppingQuantity(120, 'ml', 'en')).toBe('120ml')
      expect(formatShoppingQuantity(120, 'ml', 'et')).toBe('120ml')
    })

    it('switches to litres with the locale decimal separator', () => {
      expect(formatShoppingQuantity(1500, 'ml', 'en')).toBe('1.5l')
      expect(formatShoppingQuantity(1500, 'ml', 'et')).toBe('1,5l')
    })

    it('still shows the phrase for a vague quantity', () => {
      expect(formatShoppingQuantity(0, 'ml', 'en', true, 'splash')).toBe('a splash')
    })
  })

  describe('kilograms', () => {
    it('switches to kg at 1000g', () => {
      expect(formatShoppingQuantity(1000, 'g', 'en')).toBe('1kg')
      expect(formatShoppingQuantity(1000, 'g', 'et')).toBe('1kg')
    })

    it('uses period decimal in en', () => {
      expect(formatShoppingQuantity(1500, 'g', 'en')).toBe('1.5kg')
    })

    it('uses comma decimal in et', () => {
      expect(formatShoppingQuantity(1500, 'g', 'et')).toBe('1,5kg')
    })

    it('drops trailing zeros for whole kg amounts', () => {
      expect(formatShoppingQuantity(2000, 'g', 'en')).toBe('2kg')
      expect(formatShoppingQuantity(2000, 'g', 'et')).toBe('2kg')
    })

    it('rounds beyond one fraction digit', () => {
      // 1550g → 1.55kg → 1.6kg / 1,6kg
      expect(formatShoppingQuantity(1550, 'g', 'en')).toBe('1.6kg')
      expect(formatShoppingQuantity(1550, 'g', 'et')).toBe('1,6kg')
    })

    it('uses locale-aware grouping for very large kg amounts', () => {
      // 1234kg → en uses comma grouping, et uses non-breaking space
      expect(formatShoppingQuantity(1_234_000, 'g', 'en')).toBe('1,234kg')
      const et = formatShoppingQuantity(1_234_000, 'g', 'et')
      expect(et.replace(/[\s  ]/g, '')).toBe('1234kg')
      expect(et).not.toBe('1,234kg')
    })
  })

  describe('pieces', () => {
    // Piece quantities are already piece counts (HON-713), never grams.
    it('renders a whole piece count with the locale piece label', () => {
      // 2 eggs per serving x 4 servings
      expect(formatShoppingQuantity(8, 'piece', 'en')).toBe(`8${NBSP}pc`)
      expect(formatShoppingQuantity(8, 'piece', 'et')).toBe(`8${NBSP}tk`)
      expect(formatShoppingQuantity(1, 'piece', 'en')).toBe(`1${NBSP}pc`)
      expect(formatShoppingQuantity(1, 'piece', 'et')).toBe(`1${NBSP}tk`)
      expect(formatShoppingQuantity(3, 'piece', 'en')).toBe(`3${NBSP}pc`)
    })

    it('rounds up partial pieces (always enough for shopping)', () => {
      // half a lemon per serving x 3 servings
      expect(formatShoppingQuantity(1.5, 'piece', 'en')).toBe(`2${NBSP}pc`)
    })

    it('does not round up float residue from total / servings * servings', () => {
      expect(formatShoppingQuantity((8 / 3) * 3, 'piece', 'en')).toBe(`8${NBSP}pc`)
    })

    it('never switches to kg, however large the count', () => {
      expect(formatShoppingQuantity(1500, 'piece', 'en')).toBe(`1,500${NBSP}pc`)
    })
  })

  describe('vague quantities', () => {
    it('renders a known phrase in the locale (HON-917)', () => {
      expect(formatShoppingQuantity(5, 'g', 'en', true, 'to taste')).toBe('to taste')
      expect(formatShoppingQuantity(5, 'g', 'et', true, 'to taste')).toBe('maitse järgi')
      expect(formatShoppingQuantity(5, 'g', 'et', true, 'some')).toBe('veidi')
    })

    it('renders a phrase outside the vocabulary verbatim', () => {
      expect(formatShoppingQuantity(5, 'g', 'et', true, 'maitse järgi')).toBe('maitse järgi')
      expect(formatShoppingQuantity(5, 'g', 'en', true, 'a smidgen')).toBe('a smidgen')
    })

    it('formats normally when isVague is true but originalPhrase is missing', () => {
      expect(formatShoppingQuantity(5, 'g', 'en', true, null)).toBe('5g')
    })
  })
})

describe('formatWeight', () => {
  it('renders grams below 1000g', () => {
    expect(formatWeight(999, 'en')).toBe('999g')
  })

  it('switches to kg at 1000g', () => {
    expect(formatWeight(1000, 'en')).toBe('1kg')
    expect(formatWeight(3000, 'en')).toBe('3kg')
  })

  it('renders kg when the grams would round up to 1000', () => {
    expect(formatWeight(999.6, 'en')).toBe('1kg')
    expect(formatWeight(999.4, 'en')).toBe('999g')
  })

  it('rounds to one fraction digit with the locale decimal separator', () => {
    expect(formatWeight(1250, 'en')).toBe('1.3kg')
    expect(formatWeight(1250, 'et')).toBe('1,3kg')
  })
})

describe('formatVolume', () => {
  it('renders whole millilitres below 1000ml', () => {
    expect(formatVolume(120, 'en')).toBe('120ml')
    expect(formatVolume(999, 'et')).toBe('999ml')
    expect(formatVolume(62.4, 'en')).toBe('62ml')
  })

  it('renders litres when the millilitres would round up to 1000', () => {
    expect(formatVolume(999.4, 'en')).toBe('999ml')
    expect(formatVolume(999.5, 'en')).toBe('1l')
  })

  it('collapses whole litres', () => {
    expect(formatVolume(1000, 'en')).toBe('1l')
    expect(formatVolume(2000, 'et')).toBe('2l')
  })

  it('renders fractional litres with the locale decimal separator', () => {
    expect(formatVolume(1500, 'en')).toBe('1.5l')
    expect(formatVolume(1500, 'et')).toBe('1,5l')
    expect(formatVolume(1250, 'en')).toBe('1.3l')
  })
})

describe('formatMeasure', () => {
  it('formats grams as weight and millilitres as volume', () => {
    expect(formatMeasure(120, 'g', 'en')).toBe('120g')
    expect(formatMeasure(120, 'ml', 'en')).toBe('120ml')
  })
})

describe('displayUnit', () => {
  it('shows a flagged gram ingredient in ml', () => {
    expect(displayUnit({ defaultUnit: 'g', measuredByVolume: true })).toBe('ml')
  })

  it('keeps grams for an unflagged ingredient', () => {
    expect(displayUnit({ defaultUnit: 'g', measuredByVolume: false })).toBe('g')
  })

  it('reads an absent flag as grams', () => {
    expect(displayUnit({ defaultUnit: 'g' })).toBe('g')
  })

  it('keeps pieces whatever the flag says', () => {
    expect(displayUnit({ defaultUnit: 'piece', measuredByVolume: true })).toBe('piece')
    expect(displayUnit({ defaultUnit: 'piece' })).toBe('piece')
  })
})

describe('withPieceUnit', () => {
  // A regular space would let the unit wrap onto its own line (HON-956).
  it('joins the amount and the label with a no-break space', () => {
    expect(withPieceUnit('1,5', 'tk')).toBe('1,5\u00a0tk')
    expect(withPieceUnit('1,5', 'tk')).not.toContain(' ')
  })
})
