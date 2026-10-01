import { describe, it, expect } from 'vitest'
import { ImaginedMealsSchema, imaginedIngredientText } from './imagine-request'

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
