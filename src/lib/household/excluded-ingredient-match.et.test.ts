import { describe, expect, it } from 'vitest'

import { type ExclusionPoolRow, matchTag } from './excluded-ingredient-match'

// The Estonian part-of-word rule (HON-1477), on a small literal pool.

function row(name: string, et?: string): ExclusionPoolRow {
  return { id: name, name, householdId: null, translations: et ? [{ locale: 'et', name: et }] : [] }
}

function own(name: string): ExclusionPoolRow {
  return { id: name, name, householdId: 'household-1', translations: [] }
}

const POOL = [
  row('chicken breast', 'kanafilee'),
  row('chicken stock', 'kanapuljong'),
  row('peas', 'herned'),
  row('sugar snap peas', 'suhkruherned'),
  row('chickpeas', 'kikerherned'),
  row('pasta', 'pasta'),
  row('tomato paste', 'tomatipasta'),
  row('mole paste', 'mole pasta'),
  row('guinea fowl', 'pärlkana'),
  row('cod', 'tursk'),
  row('kalamata olives', 'kalamata oliiv'),
  row('mixed nuts'),
  row('nutmeg', 'muskaatpähkel'),
  row('cauliflower', 'lillkapsas'),
  own('lillkapsapüree'),
  own('brokoli-lillkapsasegu'),
]

const names = (tag: string, locale = 'et') => matchTag(tag, POOL, locale).map((r) => r.name)

describe('matchTag, Estonian part-of-word rule', () => {
  it('matches a tag inside an Estonian compound', () => {
    expect(names('kana')).toEqual(['chicken breast', 'chicken stock'])
  })

  it.each(['kana', 'kanad'])('keeps a false friend out of "%s", singular or plural', (tag) => {
    expect(names(tag)).not.toContain('guinea fowl')
  })

  it.each(['hernes', 'herned'])('reads "%s" in compounds, and not in chickpeas', (tag) => {
    expect(names(tag)).toEqual(['peas', 'sugar snap peas'])
  })

  it('matches "pasta" as a whole word only, and not a paste', () => {
    expect(names('pasta')).toEqual(['pasta'])
  })

  it('matches a group word by its group, and not inside a longer word', () => {
    expect(names('kala')).toEqual(['cod'])
  })

  it("matches an Estonian household's own rows by part, but not an English household's", () => {
    expect(names('lillkapsas', 'et')).toEqual([
      'cauliflower',
      'lillkapsapüree',
      'brokoli-lillkapsasegu',
    ])
    expect(names('lillkapsas', 'en')).toEqual(['cauliflower'])
  })

  it('does not use an own row as a term for English names', () => {
    const pool = [own('kanasupp'), row('kanasupp bowl')]
    expect(matchTag('kana', pool, 'et').map((r) => r.name)).toEqual(['kanasupp'])
  })

  it('keeps the part-of-word rule for the own rows of a keepParts group word', () => {
    const pool = [
      row('clotted cream', 'clotted cream'),
      row('jaggery', 'jaggery'),
      own('kohvikoor'),
      own('vanillisuhkur'),
    ]
    const found = (tag: string) => matchTag(tag, pool, 'et').map((r) => r.name)
    expect(found('koor')).toEqual(['kohvikoor', 'clotted cream'])
    expect(found('suhkur')).toEqual(['vanillisuhkur', 'jaggery'])
  })

  it('keeps English names on the whole-word rule', () => {
    expect(names('nut', 'en')).toEqual(['mixed nuts'])
  })
})
