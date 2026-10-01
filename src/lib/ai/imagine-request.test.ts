import { describe, it, expect } from 'vitest'
import { ImaginedMealsSchema, imaginedIngredientText } from './imagine-request'

describe('imaginedIngredientText', () => {
  const base = { name: 'chicken breast', quantity: null, unit: null, vaguePhrase: null }

  it('puts the vague phrase before the name when the quantity is vague', () => {
    expect(imaginedIngredientText({ ...base, name: 'salt', vaguePhrase: 'to taste' })).toBe(
      'to taste salt',
    )
  })

  it('ignores a blank vague phrase', () => {
    expect(imaginedIngredientText({ ...base, quantity: 500, unit: 'g', vaguePhrase: ' ' })).toBe(
      '500 g chicken breast',
    )
  })

  it('writes quantity, unit and name', () => {
    expect(imaginedIngredientText({ ...base, quantity: 500, unit: 'g' })).toBe(
      '500 g chicken breast',
    )
  })

  it('leaves out a null unit', () => {
    expect(imaginedIngredientText({ ...base, name: 'egg', quantity: 2 })).toBe('2 egg')
  })

  it('falls back to the name', () => {
    expect(imaginedIngredientText(base)).toBe('chicken breast')
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
