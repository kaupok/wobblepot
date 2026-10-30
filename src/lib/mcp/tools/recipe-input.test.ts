import { describe, expect, it } from 'vitest'

import { ingredientsInput } from './recipe-input'

describe('ingredientsInput', () => {
  // Ingredient nutrition is for the form you buy it in (HON-1473)
  it('tells create_meal and update_meal to give quantities as bought', () => {
    expect(ingredientsInput.element.shape.quantity.description).toContain(
      'as bought: dry pasta, rice and lentils, drained canned beans',
    )
  })

  // A bare meat or fish row counts the bone (HON-1480)
  it('tells create_meal and update_meal to weigh bone-in cuts with the bone', () => {
    expect(ingredientsInput.element.shape.quantity.description).toContain(
      'bone-in cuts and whole fish by weight with the bone',
    )
  })
})
