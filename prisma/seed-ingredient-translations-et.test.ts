import { describe, expect, it } from 'vitest'

import { ingredientTranslationsEt } from './seed-ingredient-translations-et'

// HON-1478: shops sell kints as the thigh, poolkoib as the drumstick and koib as
// the whole leg, so each cut needs its own Estonian name.
const CUTS: Record<string, string> = {
  'chicken drumstick': 'kanapoolkoib',
  'chicken thigh': 'kanakints',
  'chicken leg': 'kanakoib',
  'turkey drumstick': 'kalkunipoolkoib',
  'turkey thigh': 'kalkunikints',
  'turkey leg': 'kalkunikoib',
}

function estonianName(en: string): string | undefined {
  return ingredientTranslationsEt.find((row) => row.en === en)?.et
}

describe('Estonian names of the chicken and turkey leg cuts', () => {
  it.each(Object.entries(CUTS))('names %s as %s', (en, et) => {
    expect(estonianName(en)).toBe(et)
  })

  it('gives no two cuts the same Estonian name', () => {
    const names = Object.keys(CUTS).map(estonianName)

    expect(new Set(names).size).toBe(Object.keys(CUTS).length)
  })
})

// HON-1481: two different foods got their own Estonian names, so a household can
// tell them apart in the picker and on the shopping list.
const RENAMED: Record<string, string> = {
  'lamb leg': 'lambakints',
  plaice: 'merilest',
  'plaice fillet': 'merilestafilee',
  'pinto beans': 'pinto oad',
  'borlotti beans': 'borlotti oad',
  'cannellini beans': 'cannellini oad',
  'beef steak': 'veisesteik',
  'french green lentils': 'Puy läätsed',
  gim: 'maitsestatud nori',
  jaggery: 'jaggery',
  'carne seca': 'carne seca',
  'key lime': 'Key laim',
  'collard greens': 'collard-lehtkapsas',
  'double cream': 'topeltkoor',
  'whipped cream': 'vahustatud koor',
  'clotted cream': 'clotted cream',
}

// Each of these names is one food under two English rows. They stay shared
// until HON-1500 merges the rows; remove a name here when its rows merge.
const SHARED_UNTIL_MERGE = [
  'hiina brokoli',
  'hiina viievürtsisegu',
  'jalapeño',
  'kaerahelbed',
  'kalmaar',
  'kanafilee',
  'kitsejuust',
  'kombu',
  'kookoshelbed',
  'mandlilaastud',
  'merikeel',
  'merikeelefilee',
  'punane kapsas',
  'suhkruherned',
  'tai basiilik',
  'valged oad',
  'vähk',
]

describe('Estonian names that two rows share', () => {
  it.each(Object.entries(RENAMED))('names %s as %s', (en, et) => {
    expect(estonianName(en)).toBe(et)
  })

  it('shares only the names that wait for a row merge', () => {
    const counts = new Map<string, number>()
    for (const { et } of ingredientTranslationsEt) {
      counts.set(et, (counts.get(et) ?? 0) + 1)
    }
    const shared = [...counts].filter(([, count]) => count > 1).map(([et]) => et)

    expect(shared.sort()).toEqual([...SHARED_UNTIL_MERGE].sort())
  })
})
