import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MealCardBase } from './MealCardBase'
import type { MealCardBaseData } from './MealCardBase'
import type { PantryIngredient } from './types'

const mockMeal: MealCardBaseData = {
  name: 'Salmon Rice Bowl',
  kidFriendly: true,
  primaryProteinType: 'fish',
  components: [
    {
      ingredientId: 'ing-salmon',
      quantityPerServing: 150,
      ingredient: {
        id: 'ing-salmon',
        name: 'Salmon',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
    {
      ingredientId: 'ing-rice',
      quantityPerServing: 100,
      ingredient: {
        id: 'ing-rice',
        name: 'Sushi rice',
        category: 'grain',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
    {
      ingredientId: 'ing-avocado',
      quantityPerServing: 1,
      ingredient: {
        id: 'ing-avocado',
        name: 'Avocado',
        category: 'produce',
        defaultUnit: 'piece',
        gramsPerPiece: 200,
      },
    },
    {
      ingredientId: 'ing-soy',
      quantityPerServing: 15,
      ingredient: {
        id: 'ing-soy',
        name: 'Soy sauce',
        category: 'condiment',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
  ],
  nutrition: {
    calories: 500,
    protein: 35,
    carbs: 50,
    fat: 15,
  },
}

describe('MealCardBase', () => {
  describe('ingredient availability color-coding', () => {
    it('renders ingredients without color-coding when no pantry data', () => {
      render(<MealCardBase meal={mockMeal} />)

      const salmon = screen.getByText('Salmon')
      expect(salmon.closest('li')).not.toHaveClass('text-green-700')
      expect(salmon.closest('li')).not.toHaveClass('text-amber-600')
    })

    it('renders available ingredients in green', () => {
      const pantry: PantryIngredient[] = [
        { ingredientId: 'ing-salmon', isStaple: false },
        { ingredientId: 'ing-rice', isStaple: false },
      ]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const salmon = screen.getByText('Salmon').closest('li')
      expect(salmon).toHaveClass('text-green-700')
    })

    it('renders missing ingredients in amber', () => {
      const pantry: PantryIngredient[] = [{ ingredientId: 'ing-salmon', isStaple: false }]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const avocado = screen.getByText('Avocado').closest('li')
      expect(avocado).toHaveClass('text-amber-600')
    })

    it('renders staples as available (green)', () => {
      const pantry: PantryIngredient[] = [{ ingredientId: 'ing-soy', isStaple: true }]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const soy = screen.getByText('Soy sauce').closest('li')
      expect(soy).toHaveClass('text-green-700')
    })

    it('colors all ingredients correctly with mixed availability', () => {
      const pantry: PantryIngredient[] = [
        { ingredientId: 'ing-salmon', isStaple: false },
        { ingredientId: 'ing-rice', isStaple: false },
        { ingredientId: 'ing-soy', isStaple: true },
        // avocado not in pantry
      ]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      expect(screen.getByText('Salmon').closest('li')).toHaveClass('text-green-700')
      expect(screen.getByText('Sushi rice').closest('li')).toHaveClass('text-green-700')
      expect(screen.getByText('Soy sauce').closest('li')).toHaveClass('text-green-700')
      expect(screen.getByText('Avocado').closest('li')).toHaveClass('text-amber-600')
    })
  })
})
