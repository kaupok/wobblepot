import { describe, expect, it } from 'vitest'

import { COOKING_MODIFIERS } from '@/lib/normalize-ingredient'

import { FORM_WORDS } from './form-modifier-guard'
import { matchIngredients } from './match-ingredients'
import { seedCatalogue } from './match-ingredients.catalogue.fixtures'
import { extracted } from './match-ingredients.fixtures'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks.
// HON-1571: normalization strips a cooking modifier, so the line saves sure as the
// bare row. One line per word, so a misspelt or dropped word fails here. The form
// words are in both lists; their lines are in match-ingredients.form-words.db.test.ts.

async function matchOne(name: string) {
  const [result] = await matchIngredients([extracted(name)], 4, { locale: 'et' })
  return result!
}

const MODIFIER_LINES: [word: string, recipeName: string, rowName: string, sure: boolean][] = [
  ['fresh', 'fresh onion', 'onion', true],
  ['dry', 'dry onion', 'onion', true],
  ['raw', 'raw onion', 'onion', true],
  ['cooked', 'cooked onion', 'onion', true],
  ['ripe', 'ripe onion', 'onion', true],
  ['unripe', 'unripe onion', 'onion', true],
  ['sliced', 'sliced onion', 'onion', true],
  ['chopped', 'chopped onion', 'onion', true],
  ['minced', 'minced onion', 'onion', true],
  ['diced', 'diced onion', 'onion', true],
  ['crushed', 'crushed onion', 'onion', true],
  ['grated', 'grated onion', 'onion', true],
  ['shredded', 'shredded onion', 'onion', true],
  ['julienned', 'julienned onion', 'onion', true],
  ['cubed', 'cubed onion', 'onion', true],
  ['mashed', 'mashed onion', 'onion', true],
  ['peeled', 'peeled onion', 'onion', true],
  ['deseeded', 'deseeded onion', 'onion', true],
  ['pitted', 'pitted onion', 'onion', true],
  ['trimmed', 'trimmed onion', 'onion', true],
  ['halved', 'halved onion', 'onion', true],
  ['quartered', 'quartered onion', 'onion', true],
  ['torn', 'torn onion', 'onion', true],
  ['thin', 'thin onion', 'onion', true],
  ['thick', 'thick onion', 'onion', true],
  ['fine', 'fine onion', 'onion', true],
  ['coarse', 'coarse onion', 'onion', true],
  ['large', 'large onion', 'onion', true],
  ['small', 'small onion', 'onion', true],
  ['medium', 'medium onion', 'onion', true],
  ['baby', 'baby onion', 'onion', true],
  ['toasted', 'toasted onion', 'onion', true],
  ['roasted', 'roasted onion', 'onion', true],
  ['grilled', 'grilled onion', 'onion', true],
  ['fried', 'fried onion', 'onion', true],
  ['boiled', 'boiled onion', 'onion', true],
  ['steamed', 'steamed onion', 'onion', true],
  ['blanched', 'blanched onion', 'onion', true],
  ['sauteed', 'sauteed onion', 'onion', true],
  ['sautéed', 'sautéed onion', 'onion', true],
  ['baked', 'baked onion', 'onion', true],
  ['braised', 'braised onion', 'onion', true],
  ['poached', 'poached onion', 'onion', true],
  ['marinated', 'marinated onion', 'onion', true],
  ['fermented', 'fermented onion', 'onion', true],
  ['caramelized', 'caramelized onion', 'onion', true],
  ['warm', 'warm onion', 'onion', true],
  ['cold', 'cold onion', 'onion', true],
  // An exception keeps "hot" (hot sauce), so "hot onion" is not the bare row for sure
  ['hot', 'hot onion', 'onion', false],
  ['chilled', 'chilled onion', 'onion', true],
  ['room-temperature', 'room-temperature onion', 'onion', true],
  ['powdered', 'powdered onion', 'onion', true],
  ['whole', 'whole onion', 'onion', true],
  ['flaked', 'flaked onion', 'onion', true],
  ['crumbled', 'crumbled onion', 'onion', true],
  ['organic', 'organic onion', 'onion', true],
  ['unbleached', 'unbleached onion', 'onion', true],
  ['skinless', 'skinless onion', 'onion', true],
  ['bone-in', 'bone-in onion', 'onion', true],
  ['skin-on', 'skin-on onion', 'onion', true],
  ['seedless', 'seedless onion', 'onion', true],
  ['unsalted', 'unsalted onion', 'onion', true],
  ['salted', 'salted onion', 'onion', true],
  ['sweetened', 'sweetened onion', 'onion', true],
  ['unsweetened', 'unsweetened onion', 'onion', true],
  ['extra-virgin', 'extra-virgin onion', 'onion', true],
  ['virgin', 'virgin onion', 'onion', true],
  ['värske', 'värske sibul', 'onion', true],
  ['hakitud', 'hakitud sibul', 'onion', true],
  ['riivitud', 'riivitud sibul', 'onion', true],
  ['viilutatud', 'viilutatud sibul', 'onion', true],
  ['tükeldatud', 'tükeldatud sibul', 'onion', true],
  ['purustatud', 'purustatud sibul', 'onion', true],
  ['keedetud', 'keedetud sibul', 'onion', true],
  ['röstitud', 'röstitud kartul', 'potato', true],
  ['praetud', 'praetud sibul', 'onion', true],
]

describe('matchIngredients on each cooking modifier', () => {
  it('has a recipe line for every cooking modifier that is not a form word', () => {
    const formWords = new Set(Object.values(FORM_WORDS).flatMap((form) => [...form.en, ...form.et]))
    const modifiers = [...COOKING_MODIFIERS].filter((word) => !formWords.has(word))

    expect(MODIFIER_LINES.map(([word]) => word).sort()).toEqual(modifiers.sort())
  })

  it.each(MODIFIER_LINES)(
    '%s: matches "%s" to %s, sure: %s',
    async (_, recipeName, rowName, sure) => {
      await seedCatalogue()

      expect(await matchOne(recipeName)).toMatchObject({
        type: 'matched',
        ingredient: { name: rowName },
        lowConfidence: !sure,
      })
    },
  )
})
