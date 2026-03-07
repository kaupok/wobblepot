import { describe, it, expect } from 'vitest'
import { deriveProteinType, type ComponentForProtein } from './protein'

describe('deriveProteinType', () => {
  it('returns "none" for empty components', () => {
    expect(deriveProteinType([])).toBe('none')
  })

  it('returns "none" when no ingredients have proteinType', () => {
    const components: ComponentForProtein[] = [
      { quantityPerServing: 200, ingredient: { proteinType: null, protein: 1 } },
      { quantityPerServing: 100, ingredient: { proteinType: undefined, protein: 2 } },
    ]
    expect(deriveProteinType(components)).toBe('none')
  })

  it('returns the protein type of the only protein ingredient', () => {
    const components: ComponentForProtein[] = [
      { quantityPerServing: 200, ingredient: { proteinType: 'poultry', protein: 25 } },
      { quantityPerServing: 300, ingredient: { proteinType: null, protein: 2 } },
    ]
    expect(deriveProteinType(components)).toBe('poultry')
  })

  it('returns the protein type with the highest protein contribution', () => {
    const components: ComponentForProtein[] = [
      // Chicken: 200g * 25/100 = 50g protein
      { quantityPerServing: 200, ingredient: { proteinType: 'poultry', protein: 25 } },
      // Salmon: 150g * 20/100 = 30g protein
      { quantityPerServing: 150, ingredient: { proteinType: 'fish', protein: 20 } },
    ]
    expect(deriveProteinType(components)).toBe('poultry')
  })

  it('handles ties by returning the first encountered', () => {
    const components: ComponentForProtein[] = [
      // Both contribute 50g protein
      { quantityPerServing: 200, ingredient: { proteinType: 'beef', protein: 25 } },
      { quantityPerServing: 200, ingredient: { proteinType: 'pork', protein: 25 } },
    ]
    // First one wins since it's strictly greater-than
    expect(deriveProteinType(components)).toBe('beef')
  })

  it('correctly calculates with small quantities', () => {
    const components: ComponentForProtein[] = [
      // Egg: 60g * 13/100 = 7.8g protein
      { quantityPerServing: 60, ingredient: { proteinType: 'eggs', protein: 13 } },
      // Tofu: 150g * 8/100 = 12g protein (higher)
      { quantityPerServing: 150, ingredient: { proteinType: 'legume', protein: 8 } },
    ]
    expect(deriveProteinType(components)).toBe('legume')
  })

  it('ignores components with zero quantity', () => {
    const components: ComponentForProtein[] = [
      { quantityPerServing: 0, ingredient: { proteinType: 'beef', protein: 25 } },
      { quantityPerServing: 100, ingredient: { proteinType: 'fish', protein: 20 } },
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
        { quantityPerServing: 100, ingredient: { proteinType: type, protein: 20 } },
      ]
      expect(deriveProteinType(components)).toBe(type)
    }
  })
})
