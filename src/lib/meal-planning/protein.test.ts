import { describe, expect, it } from 'vitest'

import {
  type ComponentForProtein,
  deriveProteinType,
  distinctProteinTypes,
  isProteinOverrideValid,
  resolveProteinType,
} from './protein'

describe('deriveProteinType', () => {
  it('returns "none" for empty components', () => {
    expect(deriveProteinType([])).toBe('none')
  })

  it('returns "none" when no ingredients have proteinType', () => {
    const components: ComponentForProtein[] = [
      { quantityPerServing: 200, ingredient: { defaultUnit: 'g', proteinType: null, protein: 1 } },
      {
        quantityPerServing: 100,
        ingredient: { defaultUnit: 'g', proteinType: undefined, protein: 2 },
      },
    ]
    expect(deriveProteinType(components)).toBe('none')
  })

  it('returns the protein type of the only protein ingredient', () => {
    const components: ComponentForProtein[] = [
      {
        quantityPerServing: 200,
        ingredient: { defaultUnit: 'g', proteinType: 'poultry', protein: 25 },
      },
      { quantityPerServing: 300, ingredient: { defaultUnit: 'g', proteinType: null, protein: 2 } },
    ]
    expect(deriveProteinType(components)).toBe('poultry')
  })

  it('returns the protein type with the highest protein contribution', () => {
    const components: ComponentForProtein[] = [
      // Chicken: 200g * 25/100 = 50g protein
      {
        quantityPerServing: 200,
        ingredient: { defaultUnit: 'g', proteinType: 'poultry', protein: 25 },
      },
      // Salmon: 150g * 20/100 = 30g protein
      {
        quantityPerServing: 150,
        ingredient: { defaultUnit: 'g', proteinType: 'fish', protein: 20 },
      },
    ]
    expect(deriveProteinType(components)).toBe('poultry')
  })

  it('handles ties by returning the first encountered', () => {
    const components: ComponentForProtein[] = [
      // Both contribute 50g protein
      {
        quantityPerServing: 200,
        ingredient: { defaultUnit: 'g', proteinType: 'beef', protein: 25 },
      },
      {
        quantityPerServing: 200,
        ingredient: { defaultUnit: 'g', proteinType: 'pork', protein: 25 },
      },
    ]
    // First one wins since it's strictly greater-than
    expect(deriveProteinType(components)).toBe('beef')
  })

  it('correctly calculates with small quantities', () => {
    const components: ComponentForProtein[] = [
      // Egg: 60g * 13/100 = 7.8g protein
      {
        quantityPerServing: 60,
        ingredient: { defaultUnit: 'g', proteinType: 'eggs', protein: 13 },
      },
      // Tofu: 150g * 8/100 = 12g protein (higher)
      {
        quantityPerServing: 150,
        ingredient: { defaultUnit: 'g', proteinType: 'legume', protein: 8 },
      },
    ]
    expect(deriveProteinType(components)).toBe('legume')
  })

  it('ignores components with zero quantity', () => {
    const components: ComponentForProtein[] = [
      { quantityPerServing: 0, ingredient: { defaultUnit: 'g', proteinType: 'beef', protein: 25 } },
      {
        quantityPerServing: 100,
        ingredient: { defaultUnit: 'g', proteinType: 'fish', protein: 20 },
      },
    ]
    expect(deriveProteinType(components)).toBe('fish')
  })

  it('handles all protein types', () => {
    const types = [
      'poultry',
      'beef',
      'pork',
      'lamb',
      'fish',
      'eggs',
      'legume',
      'dairy',
      'none',
    ] as const
    for (const type of types) {
      const components: ComponentForProtein[] = [
        {
          quantityPerServing: 100,
          ingredient: { defaultUnit: 'g', proteinType: type, protein: 20 },
        },
      ]
      expect(deriveProteinType(components)).toBe(type)
    }
  })

  it('converts piece-unit quantities to grams before comparing (HON-713)', () => {
    const components: ComponentForProtein[] = [
      // 3 eggs x 50g = 150g * 13/100 = 19.5g protein — not 3 * 13/100 = 0.39g
      {
        quantityPerServing: 3,
        ingredient: { defaultUnit: 'piece', gramsPerPiece: 50, proteinType: 'eggs', protein: 13 },
      },
      // Bacon: 20g * 37/100 = 7.4g protein
      {
        quantityPerServing: 20,
        ingredient: { defaultUnit: 'g', proteinType: 'pork', protein: 37 },
      },
    ]
    expect(deriveProteinType(components)).toBe('eggs')
  })

  it('skips vague components, whose quantity is a gram default rather than a piece count', () => {
    const components: ComponentForProtein[] = [
      // "some egg for brushing": a 10g default that must not read as 10 eggs
      {
        quantityPerServing: 10,
        isVague: true,
        ingredient: { defaultUnit: 'piece', gramsPerPiece: 50, proteinType: 'eggs', protein: 13 },
      },
      {
        quantityPerServing: 150,
        ingredient: { defaultUnit: 'g', proteinType: 'poultry', protein: 31 },
      },
    ]
    expect(deriveProteinType(components)).toBe('poultry')
  })
})

// Beef mince with kidney beans, per serving: 25 g mince (26 g protein / 100 g)
// gives 6.5 g, 133 g beans (8.7 g / 100 g) gives 11.6 g, so beans win.
const mince: ComponentForProtein = {
  quantityPerServing: 25,
  ingredient: { defaultUnit: 'g', proteinType: 'beef', protein: 26 },
}
const beans: ComponentForProtein = {
  quantityPerServing: 133,
  ingredient: { defaultUnit: 'g', proteinType: 'legume', protein: 8.7 },
}
const buckwheat: ComponentForProtein = {
  quantityPerServing: 60,
  ingredient: { defaultUnit: 'g', proteinType: null, protein: 13 },
}

describe('resolveProteinType', () => {
  it('lets a valid override win over the derived value', () => {
    expect(resolveProteinType([mince, beans, buckwheat], 'beef')).toEqual({
      primaryProteinType: 'beef',
      proteinTypeOverride: 'beef',
    })
  })

  it('clears an override no component carries and stores the derived value', () => {
    expect(resolveProteinType([mince, beans], 'fish')).toEqual({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })

  it('does not count a vague component as carrying the override', () => {
    const vagueMince = { ...mince, isVague: true }
    expect(resolveProteinType([vagueMince, beans], 'beef')).toEqual({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })

  it('gives the derived value with no override', () => {
    expect(resolveProteinType([mince, beans], null)).toEqual({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })
})

describe('isProteinOverrideValid', () => {
  it('rejects none even when an ingredient has no protein type', () => {
    expect(isProteinOverrideValid([buckwheat], 'none')).toBe(false)
  })

  it('accepts a type a non-vague component carries', () => {
    expect(isProteinOverrideValid([mince, beans], 'beef')).toBe(true)
  })
})

describe('distinctProteinTypes', () => {
  it('lists each non-vague protein type once, in recipe order', () => {
    expect(distinctProteinTypes([mince, buckwheat, beans, { ...mince }])).toEqual([
      'beef',
      'legume',
    ])
  })

  it('skips vague components', () => {
    expect(distinctProteinTypes([{ ...mince, isVague: true }, beans])).toEqual(['legume'])
  })
})
