import { describe, expect, it } from 'vitest'
import { matchTag, matchTags, wordKey, type ExclusionPoolRow } from './excluded-ingredient-match'

function row(name: string, et?: string): ExclusionPoolRow {
  return { id: name, name, translations: et ? [{ locale: 'et', name: et }] : [] }
}

const POOL = [
  row('mushroom', 'seen'),
  row('shiitake mushroom', 'šiitake'),
  row('chestnut mushroom', 'pruun šampinjon'),
  row('oyster mushroom', 'austriseen'),
  row('pork mince', 'seahakkliha'),
  row('pork belly', 'seakõht'),
  row('egg', 'muna'),
  row('egg noodles', 'munanuudlid'),
  row('aubergine', 'baklažaan'),
  row('eggplant chutney'),
  row('nutmeg', 'muskaatpähkel'),
  row('mixed nuts'),
  row('blueberries'),
  row('cherry tomatoes'),
  row('hummus'),
  row('paprika', 'paprikapulber'),
  row('bell pepper', 'paprika'),
  row('mole paste', 'mole pasta'),
  row('pasta', 'pasta'),
]

const names = (tag: string, locale = 'en') => matchTag(tag, POOL, locale).map((r) => r.name)

describe('wordKey', () => {
  it.each([
    ['mushrooms', 'mushroom'],
    ['berries', 'berry'],
    ['tomatoes', 'tomato'],
    ['peaches', 'peach'],
    ['cookies', 'cookie'],
    ['Eggs', 'egg'],
  ])('gives "%s" the key of "%s"', (plural, singular) => {
    expect(wordKey(plural)).toBe(wordKey(singular))
  })

  it.each(['hummus', 'asparagus', 'swiss'])('keeps the "s" of "%s"', (word) => {
    expect(wordKey(word)).toBe(word)
  })
})

describe('matchTag', () => {
  it('reads a plural tag as its singular', () => {
    expect(names('mushrooms')).toEqual([
      'mushroom',
      'shiitake mushroom',
      'chestnut mushroom',
      'oyster mushroom',
    ])
  })

  it('matches every row the tag names as a whole word', () => {
    expect(names('pork')).toEqual(['pork mince', 'pork belly'])
    expect(names('tomato')).toEqual(['cherry tomatoes'])
    expect(names('blueberry')).toEqual(['blueberries'])
  })

  it('does not match a word inside a longer word', () => {
    expect(names('egg')).toEqual(['egg', 'egg noodles'])
    expect(names('nut')).toEqual(['mixed nuts'])
  })

  it('matches the pool name a synonym gives', () => {
    expect(names('eggplants')).toEqual(['aubergine', 'eggplant chutney'])
  })

  it('matches an Estonian name, singular or plural, to the rows of its English name', () => {
    const mushrooms = ['mushroom', 'shiitake mushroom', 'chestnut mushroom', 'oyster mushroom']
    expect(names('seen')).toEqual(mushrooms)
    expect(names('Seened')).toEqual(mushrooms)
    expect(names('munad')).toEqual(['egg', 'egg noodles'])
  })

  // "paprika" is bell pepper in Estonian and the spice in English.
  it('reads the translated names only when no English name matches, for an English household', () => {
    expect(names('paprika')).toEqual(['paprika'])
    expect(names('pasta')).toEqual(['pasta'])
  })

  it('reads the translated names too for an Estonian household', () => {
    expect(names('paprika', 'et')).toEqual(['paprika', 'bell pepper'])
    expect(names('pasta', 'et')).toEqual(['pasta', 'mole paste'])
    expect(names('pork', 'et')).toEqual(['pork mince', 'pork belly'])
  })

  it('matches nothing for a name no row carries', () => {
    expect(names('dragonfruit')).toEqual([])
    expect(names('hummu')).toEqual([])
  })
})

describe('matchTags', () => {
  it('names each match in the locale, sorted, and keeps every tag in order', () => {
    expect(matchTags(['pork', 'dragonfruit'], POOL, 'et')).toEqual([
      {
        tag: 'pork',
        ingredients: [
          { id: 'pork mince', name: 'seahakkliha' },
          { id: 'pork belly', name: 'seakõht' },
        ],
      },
      { tag: 'dragonfruit', ingredients: [] },
    ])
  })
})
