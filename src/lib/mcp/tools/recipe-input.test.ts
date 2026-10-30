import { describe, expect, it } from 'vitest'

import { ingredientsInput } from './recipe-input'

describe('ingredientsInput', () => {
  // Ingredient nutrition is for the form you buy it in (HON-1473)
  it('tells create_meal and update_meal to give quantities as bought', () => {
    expect(ingredientsInput.element.shape.quantity.description).toContain(
      'as bought: dry pasta, rice and lentils, drained canned beans',
    )
  })
})
