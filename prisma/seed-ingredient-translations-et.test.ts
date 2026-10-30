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
