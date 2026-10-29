import { describe, expect, it } from 'vitest'

import { type ExclusionPoolRow, matchTag, matchTags, wordKey } from './excluded-ingredient-match'

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

// The sausage rows of the seed, with their Estonian names (HON-1343).
const SAUSAGES = [
  row('Cumberland sausage', 'Cumberlandi vorst'),
  row('andouille sausage', 'andouille vorst'),
  row('breakfast sausage', 'hommikuvorst'),
  row('calabresa sausage', 'calabresa vorst'),
  row('italian sausage', 'itaalia vorst'),
  row('smoked sausage', 'suitsuvorst'),
  row('turkey sausage', 'kalkunivorst'),
  row('bratwurst', 'bratwurst'),
  row('chorizo', 'chorizo'),
  row('frankfurter', 'viiner'),
  row('hot dog', 'hot dog'),
  row('kielbasa', 'kielbasa'),
  row('pepperoni', 'pepperoni'),
  row('salami', 'salaami'),
]
const GROUP_POOL = [...SAUSAGES, row('hot dog bun', 'hot dogi kukkel'), row('pasta', 'pasta')]
const ALL_SAUSAGES = SAUSAGES.map((r) => r.name)

const groupNames = (tag: string, locale = 'en') =>
  matchTag(tag, GROUP_POOL, locale).map((r) => r.name)

describe('matchTag with an ingredient group', () => {
  it('excludes every sausage for "sausage", singular or plural', () => {
    expect(groupNames('sausage')).toHaveLength(14)
    expect(groupNames('sausage')).toEqual(expect.arrayContaining(ALL_SAUSAGES))
    expect(groupNames('Sausages')).toEqual(expect.arrayContaining(ALL_SAUSAGES))
    expect(groupNames('Sausages')).toHaveLength(14)
  })

  it('keeps a tag that only contains the group word narrow', () => {
    expect(groupNames('smoked sausage')).toEqual(['smoked sausage'])
    expect(groupNames('smoked')).toEqual(['smoked sausage'])
  })

  it('excludes frankfurter and hot dog for "wieners", by exact name', () => {
    expect(groupNames('wieners')).toEqual(['frankfurter', 'hot dog'])
  })

  it('excludes every sausage for an Estonian household\'s "vorst" or "vorstid"', () => {
    for (const tag of ['vorst', 'vorstid']) {
      const found = groupNames(tag, 'et')
      expect(found).toHaveLength(14)
      expect(found).toEqual(expect.arrayContaining(ALL_SAUSAGES))
    }
  })

  it('reads an Estonian group word for an English household when no English name matches', () => {
    expect(groupNames('vorst')).toHaveLength(14)
    expect(groupNames('viinerid')).toEqual(['frankfurter', 'hot dog'])
  })

  it('excludes the audited group members the name misses', () => {
    const pool = [
      row('parmesan', 'parmesan'),
      row('cod', 'tursk'),
      row('prawns', 'krevetid'),
      row('bacon', 'peekon'),
      row('oxtail', 'veisesaba'),
      row('walnuts', 'kreeka pähklid'),
      row('nutmeg', 'muskaatpähkel'),
      row('peanuts', 'maapähklid'),
    ]
    const found = (tag: string, locale = 'en') => matchTag(tag, pool, locale).map((r) => r.name)
    expect(found('cheese')).toEqual(['parmesan'])
    expect(found('juustud', 'et')).toEqual(['parmesan'])
    expect(found('fish')).toEqual(['cod'])
    expect(found('kala', 'et')).toEqual(['cod'])
    expect(found('shellfish')).toEqual(['prawns'])
    expect(found('pork')).toEqual(['bacon'])
    expect(found('sealiha', 'et')).toEqual(['bacon'])
    expect(found('beef')).toEqual(['oxtail'])
    expect(found('nuts')).toEqual(['walnuts'])
    expect(found('pähklid', 'et')).toEqual(['walnuts'])
  })

  it('leaves a tag that is no group word as it was', () => {
    expect(groupNames('pasta')).toEqual(['pasta'])
    expect(groupNames('salami')).toEqual(['salami'])
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
