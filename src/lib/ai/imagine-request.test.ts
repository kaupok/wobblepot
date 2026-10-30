import { describe, expect, it } from 'vitest'

import { buildImagineRequest, imaginedIngredientText, ImaginedMealsSchema } from './imagine-request'

// A bare meat or fish row is on the bone or whole, and its nutrition counts the bone (HON-1480)
describe('buildImagineRequest on meat and fish cuts', () => {
  const household = {
    allergens: [],
    dietaryType: null,
    excludedIngredients: [],
    restrictions: [],
    householdSize: 4,
  }
  const system = buildImagineRequest({ prompt: 'chicken', household, locale: 'en' }).system

  it('names a boneless cut "<cut> fillet" and a bone-in cut by its bare name', () => {
    expect(system).toContain(
      'A boneless cut is "<cut> fillet": "chicken thigh fillet", "trout fillet"',
    )
    expect(system).toContain('A bone-in cut or a whole fish is the bare name')
  })

  it('weighs a bone-in cut and a whole fish with the bone', () => {
    expect(system).toContain(
      'Bone-in cuts and whole fish, weighed as bought with the bone: 250-350g per serving for chicken legs and thighs, 300-400g for a whole fish',
    )
  })
})

describe('imaginedIngredientText', () => {
  const base = { name: 'chicken breast', quantity: null, unit: null, vaguePhrase: null }

  it('puts the vague phrase before the name in English', () => {
    expect(imaginedIngredientText({ ...base, name: 'salt', vaguePhrase: 'to taste' }, 'en')).toBe(
      'to taste salt',
    )
  })

  it('ignores a blank vague phrase', () => {
    const ing = { ...base, quantity: 500, unit: 'g' as const, vaguePhrase: ' ' }
    expect(imaginedIngredientText(ing, 'en')).toBe('500 g chicken breast')
  })

  it('keeps a quantity the model wrote beside a vague phrase', () => {
    const ing = {
      ...base,
      name: 'cream',
      quantity: 200,
      unit: 'ml' as const,
      vaguePhrase: 'optional',
    }
    expect(imaginedIngredientText(ing, 'en')).toBe('200 ml cream')
  })

  it('writes quantity, unit and name', () => {
    expect(imaginedIngredientText({ ...base, quantity: 500, unit: 'g' }, 'en')).toBe(
      '500 g chicken breast',
    )
  })

  it('leaves out a null unit and an English piece', () => {
    expect(imaginedIngredientText({ ...base, name: 'egg', quantity: 2 }, 'en')).toBe('2 egg')
    expect(imaginedIngredientText({ ...base, name: 'egg', quantity: 2, unit: 'piece' }, 'en')).toBe(
      '2 egg',
    )
  })

  it('rounds a long fraction to two digits', () => {
    expect(
      imaginedIngredientText({ ...base, name: 'cumin', quantity: 1 / 3, unit: 'tsp' }, 'en'),
    ).toBe('0.33 tsp cumin')
  })

  it('falls back to the name', () => {
    expect(imaginedIngredientText(base, 'en')).toBe('chicken breast')
  })

  it('falls back to English for an unknown locale', () => {
    expect(imaginedIngredientText({ ...base, quantity: 1.5, unit: 'g' }, 'xx')).toBe(
      '1.5 g chicken breast',
    )
  })

  // PR #987 review: the line used to be the model's own Estonian prose.
  describe('for an Estonian household', () => {
    it('uses the decimal comma and the Estonian unit abbreviations', () => {
      expect(
        imaginedIngredientText({ ...base, name: 'kartul', quantity: 1.5, unit: 'g' }, 'et'),
      ).toBe('1,5 g kartul')
      expect(
        imaginedIngredientText({ ...base, name: 'hapukoor', quantity: 2, unit: 'tbsp' }, 'et'),
      ).toBe('2 spl hapukoor')
      expect(
        imaginedIngredientText({ ...base, name: 'köömned', quantity: 1, unit: 'tsp' }, 'et'),
      ).toBe('1 tl köömned')
      expect(
        imaginedIngredientText({ ...base, name: 'sibul', quantity: 2, unit: 'piece' }, 'et'),
      ).toBe('2 tk sibul')
    })

    it('leaves the English vague phrase out', () => {
      expect(imaginedIngredientText({ ...base, name: 'sool', vaguePhrase: 'to taste' }, 'et')).toBe(
        'sool',
      )
    })
  })
})

describe('ImaginedMealsSchema', () => {
  // HON-897: the route rebuilds both, and every field the model writes costs latency.
  it('does not ask the model for originalText or isVague', () => {
    const ingredient = ImaginedMealsSchema.shape.meals.element.shape.ingredients.element
    expect(Object.keys(ingredient.shape).sort()).toEqual([
      'isDried',
      'name',
      'quantity',
      'unit',
      'vaguePhrase',
    ])
  })
})
