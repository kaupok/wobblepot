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
  // HON-1551: the shelf name. "tomatikaste" is a seasoned sauce.
  passata: 'passeeritud tomatid',
  // HON-1568: the vinegar jar. "hapukurk" is the brine-fermented cucumber.
  'pickled gherkins': 'marineeritud kurgid',
}

describe('Estonian names that two rows share', () => {
  it.each(Object.entries(RENAMED))('names %s as %s', (en, et) => {
    expect(estonianName(en)).toBe(et)
  })

  // HON-1500 merged the rows that were one food under two English names, so no
  // Estonian name is left on two rows.
  it('gives each Estonian name to one row', () => {
    const counts = new Map<string, number>()
    for (const { et } of ingredientTranslationsEt) {
      counts.set(et, (counts.get(et) ?? 0) + 1)
    }
    const shared = [...counts].filter(([, count]) => count > 1).map(([et]) => et)

    expect(shared).toEqual([])
  })
})
