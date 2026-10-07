import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AlternativeCard } from './AlternativeCard'
import type { AlternativeMeal, PantryIngredient } from './types'

const mockMeal: AlternativeMeal = {
  id: 'meal-1',
  name: 'Chicken Rice Bowl',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'poultry',
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
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('Chicken Rice Bowl')).toBeInTheDocument()
    })

    it('leaves out the meal-type badges: the dialog title names the slot (HON-945)', () => {
      render(
        <AlternativeCard
          meal={{ ...mockMeal, suitableFor: ['breakfast', 'dinner'] }}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.queryByText('Breakfast')).not.toBeInTheDocument()
      expect(screen.queryByText('Dinner')).not.toBeInTheDocument()
      expect(screen.getByText('Kid-friendly')).toBeInTheDocument()
    })

    it('renders time when provided', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('30 min')).toBeInTheDocument()
    })

    it('renders full nutrition summary', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('450 kcal')).toBeInTheDocument()
      expect(screen.getByText('35g')).toBeInTheDocument()
      expect(screen.getByText('40g')).toBeInTheDocument()
      expect(screen.getByText('12g')).toBeInTheDocument()
    })

    it('renders kid-friendly badge when true', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('Kid-friendly')).toBeInTheDocument()
    })

    it('does not render kid-friendly badge when false', () => {
      const meal = { ...mockMeal, kidFriendly: false }
      render(
        <AlternativeCard
          meal={meal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.queryByText('Kid-friendly')).not.toBeInTheDocument()
    })

    it('renders protein type', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('Poultry')).toBeInTheDocument()
    })

    it('renders Select button', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
    })
  })

  // HON-1115: the list sits closed behind one toggle that the grid owns.
  describe('ingredients toggle', () => {
    it('hides every ingredient name while closed', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.queryByText('Chicken Breast')).not.toBeInTheDocument()
      expect(screen.queryByText('Rice')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show ingredients' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('shows every ingredient name while open, and the toggle reads Hide', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={true}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByText('Chicken Breast')).toBeInTheDocument()
      expect(screen.getByText('Rice')).toBeInTheDocument()
      const toggle = screen.getByRole('button', { name: 'Hide ingredients' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveAttribute('aria-controls')
    })

    it('asks the grid to open the lists when the toggle is clicked', async () => {
      const onIngredientsOpenChange = vi.fn()
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={onIngredientsOpenChange}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Show ingredients' }))

      expect(onIngredientsOpenChange).toHaveBeenCalledWith(true)
    })

    it('renders no toggle for a meal with no ingredients', () => {
      render(
        <AlternativeCard
          meal={{ ...mockMeal, components: [] }}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.queryByRole('button', { name: /ingredients/ })).not.toBeInTheDocument()
    })

    it('keeps keyboard focus on the toggle after it opens and closes the list', async () => {
      function Controlled() {
        const [open, setOpen] = useState(false)
        return (
          <AlternativeCard
            meal={mockMeal}
            householdServings={3}
            onSelect={vi.fn()}
            isSelecting={false}
            ingredientsOpen={open}
            onIngredientsOpenChange={setOpen}
          />
        )
      }
      const user = userEvent.setup()
      render(<Controlled />)

      const toggle = screen.getByRole('button', { name: 'Show ingredients' })
      toggle.focus()
      await user.keyboard('{Enter}')
      expect(screen.getByText('Rice')).toBeInTheDocument()
      expect(toggle).toHaveAccessibleName('Hide ingredients')
      expect(document.activeElement).toBe(toggle)

      await user.keyboard('{Enter}')
      expect(screen.queryByText('Rice')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(toggle)
    })
  })

  describe('selection', () => {
    it('calls onSelect with meal id when Select is clicked', async () => {
      const onSelect = vi.fn()
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={onSelect}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onSelect).toHaveBeenCalledWith('meal-1')
    })

    it('shows Selecting… when isSelecting is true', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={true}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Selecting…' })).toBeInTheDocument()
    })

    it('disables Select button when isSelecting is true', () => {
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={true}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Selecting…' })).toBeDisabled()
    })
  })

  // HON-750: the dialog's cards are tall, so the image sits below the content.
  describe('meal image', () => {
    it('puts the image below the ingredients toggle and above the Select button', () => {
      render(
        <AlternativeCard
          meal={{
            ...mockMeal,
            imageStatus: 'ready',
            imageUrl: 'https://store.public.blob.vercel-storage.com/meals/meal-1.png',
            imageHue: 40,
          }}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

      const image = screen.getByTestId('meal-card-image')
      const toggle = screen.getByRole('button', { name: 'Show ingredients' })
      const select = screen.getByRole('button', { name: 'Select' })
      expect(toggle.compareDocumentPosition(image)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(image.compareDocumentPosition(select)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(image).not.toHaveClass('absolute')
    })
  })

  // HON-340: the card says when the household's own ratings moved the suggestion.
  describe('rating reason', () => {
    const renderWith = (meal: AlternativeMeal) =>
      render(
        <AlternativeCard
          meal={meal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={false}
          onIngredientsOpenChange={vi.fn()}
        />,
      )

    it('says the household rated a liked meal up', () => {
      renderWith({ ...mockMeal, ratingSignal: 'liked' })
      expect(screen.getByText("You've rated this thumbs up")).toBeInTheDocument()
    })

    it('says the household rated a disliked meal down', () => {
      renderWith({ ...mockMeal, ratingSignal: 'disliked' })
      expect(screen.getByText("You've rated this thumbs down")).toBeInTheDocument()
    })

    it('shows no reason for a meal the household has not rated', () => {
      renderWith(mockMeal)
      expect(screen.queryByText(/You've rated this/)).not.toBeInTheDocument()
    })
  })

  describe('pantry availability badge (HON-816)', () => {
    const renderCard = (pantryIngredients?: PantryIngredient[]) =>
      render(
        <AlternativeCard
          meal={mockMeal}
          householdServings={3}
          onSelect={vi.fn()}
          isSelecting={false}
          ingredientsOpen={true}
          onIngredientsOpenChange={vi.fn()}
          pantryIngredients={pantryIngredients}
        />,
      )

    it('counts the rows marked missing', () => {
      renderCard([{ ingredientId: 'ingredient-1', isStaple: false }])

      expect(screen.getByText('1 ingredient to buy')).toBeInTheDocument()
      expect(screen.getAllByText(', not available')).toHaveLength(1)
    })

    it('says so when every ingredient is in the pantry or a staple', () => {
      renderCard([
        { ingredientId: 'ingredient-1', isStaple: false },
        { ingredientId: 'ingredient-2', isStaple: true },
      ])

      expect(screen.getByText('Have all ingredients')).toBeInTheDocument()
      expect(screen.queryByText(', not available')).not.toBeInTheDocument()
    })

    it('shows no badge without pantry data', () => {
      renderCard()

      expect(screen.queryByText(/ingredients? to buy|Have all ingredients/)).not.toBeInTheDocument()
    })

    it('shows no badge when the pantry holds only staples (HON-769 defaults)', () => {
      renderCard([{ ingredientId: 'salt', isStaple: true }])

      expect(screen.queryByText(/ingredients? to buy|Have all ingredients/)).not.toBeInTheDocument()
    })
  })
})
