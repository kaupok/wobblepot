import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AlternativeCard } from './AlternativeCard'
import type { AlternativeMeal } from './types'

const mockMeal: AlternativeMeal = {
  id: 'meal-1',
  name: 'Chicken Rice Bowl',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'poultry',
  reason: 'Similar prep time',
  components: [
    {
      ingredientId: 'ingredient-1',
      quantityPerServing: 150,
      ingredient: {
        id: 'ingredient-1',
        name: 'Chicken Breast',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
    {
      ingredientId: 'ingredient-2',
      quantityPerServing: 100,
      ingredient: {
        id: 'ingredient-2',
        name: 'Rice',
        category: 'grain',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
  ],
  nutrition: {
    calories: 450,
    protein: 35,
    carbs: 40,
    fat: 12,
  },
}

describe('AlternativeCard', () => {
  describe('rendering', () => {
    it('renders meal name', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('Chicken Rice Bowl')).toBeInTheDocument()
    })

    it('renders time when provided', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('30 min')).toBeInTheDocument()
    })

    it('renders full nutrition summary', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('450 kcal · 35g protein · 40g carbs · 12g fat')).toBeInTheDocument()
    })

    it('renders kid-friendly badge when true', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('Kid-friendly')).toBeInTheDocument()
    })

    it('does not render kid-friendly badge when false', () => {
      const meal = { ...mockMeal, kidFriendly: false }
      render(
        <AlternativeCard meal={meal} householdSize={3} onSelect={vi.fn()} isSelecting={false} />,
      )

      expect(screen.queryByText('Kid-friendly')).not.toBeInTheDocument()
    })

    it('renders protein type', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('Poultry')).toBeInTheDocument()
    })

    it('renders Select button', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
    })
  })

  describe('ingredients display', () => {
    it('shows all ingredient names', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={vi.fn()}
          isSelecting={false}
        />,
      )

      expect(screen.getByText('Chicken Breast')).toBeInTheDocument()
      expect(screen.getByText('Rice')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('calls onSelect with meal id when Select is clicked', async () => {
      const onSelect = vi.fn()
      render(
        <AlternativeCard
          meal={mockMeal}
          householdSize={3}
          onSelect={onSelect}
          isSelecting={false}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onSelect).toHaveBeenCalledWith('meal-1')
    })

    it('shows Selecting... when isSelecting is true', () => {
      render(
        <AlternativeCard meal={mockMeal} householdSize={3} onSelect={vi.fn()} isSelecting={true} />,
      )

      expect(screen.getByRole('button', { name: 'Selecting...' })).toBeInTheDocument()
    })

    it('disables Select button when isSelecting is true', () => {
      render(
        <AlternativeCard meal={mockMeal} householdSize={3} onSelect={vi.fn()} isSelecting={true} />,
      )

      expect(screen.getByRole('button', { name: 'Selecting...' })).toBeDisabled()
    })
  })
})
