import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function renderCard(props: Partial<ComponentProps<typeof AlternativeCard>> = {}) {
  return render(
    <AlternativeCard
      meal={mockMeal}
      householdServings={3}
      onSelect={vi.fn()}
      isSelecting={false}
      onOpen={vi.fn()}
      {...props}
    />,
  )
}

describe('AlternativeCard', () => {
  describe('rendering', () => {
    it('renders meal name', () => {
      renderCard()

      expect(screen.getByText('Chicken Rice Bowl')).toBeInTheDocument()
    })

    it('leaves out the meal-type badges: the dialog title names the slot (HON-945)', () => {
      renderCard({ meal: { ...mockMeal, suitableFor: ['breakfast', 'dinner'] } })

      expect(screen.queryByText('Breakfast')).not.toBeInTheDocument()
      expect(screen.queryByText('Dinner')).not.toBeInTheDocument()
      expect(screen.getByText('Kid-friendly')).toBeInTheDocument()
    })

    it('renders time when provided', () => {
      renderCard()

      expect(screen.getByText('30 min')).toBeInTheDocument()
    })

    // HON-1352: the cook view, one tap away on the name, carries both.
    it('shows no nutrition and no ingredient list', () => {
      renderCard()

      expect(screen.queryByText('450 kcal')).not.toBeInTheDocument()
      expect(screen.queryByText('35g')).not.toBeInTheDocument()
      expect(screen.queryByText('Chicken Breast')).not.toBeInTheDocument()
      expect(screen.queryByText('Rice')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /ingredients/i })).not.toBeInTheDocument()
    })

    it('renders kid-friendly badge when true', () => {
      renderCard()

      expect(screen.getByText('Kid-friendly')).toBeInTheDocument()
    })

    it('does not render kid-friendly badge when false', () => {
      renderCard({ meal: { ...mockMeal, kidFriendly: false } })

      expect(screen.queryByText('Kid-friendly')).not.toBeInTheDocument()
    })

    it('renders protein type', () => {
      renderCard()

      expect(screen.getByText('Poultry')).toBeInTheDocument()
    })

    it('renders Select button', () => {
      renderCard()

      expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument()
    })
  })

  // HON-1352: the name opens the cook view; Select stays the card's action.
  describe('opening the cook view', () => {
    it('opens the view from the name and gives the name focus first', () => {
      const onOpen = vi.fn()
      let focusedOnOpen: Element | null = null
      onOpen.mockImplementation(() => {
        focusedOnOpen = document.activeElement
      })
      renderCard({ onOpen })

      // `fireEvent`, not `userEvent`: Safari does not focus a button on a
      // click, so the card must, or the view hands focus back to the body.
      const name = screen.getByRole('button', { name: 'Chicken Rice Bowl' })
      fireEvent.click(name)

      expect(onOpen).toHaveBeenCalledTimes(1)
      expect(focusedOnOpen).toBe(name)
    })

    it('does not open the view from a click elsewhere on the card', async () => {
      const onOpen = vi.fn()
      renderCard({ onOpen })

      await userEvent.click(screen.getByText('Poultry'))
      await userEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onOpen).not.toHaveBeenCalled()
    })

    it('rings the name itself: the card is not a click target', () => {
      renderCard()

      const name = screen.getByRole('button', { name: 'Chicken Rice Bowl' })
      expect(name).not.toHaveAttribute('data-slot', 'card-target')
      expect(name).toHaveClass('focus-visible:ring-3')
    })
  })

  describe('selection', () => {
    it('calls onSelect with meal id when Select is clicked', async () => {
      const onSelect = vi.fn()
      renderCard({ onSelect })

      await userEvent.click(screen.getByRole('button', { name: 'Select' }))

      expect(onSelect).toHaveBeenCalledWith('meal-1')
    })

    it('shows Selecting… when isSelecting is true', () => {
      renderCard({ isSelecting: true })

      expect(screen.getByRole('button', { name: 'Selecting…' })).toBeInTheDocument()
    })

    it('disables Select button when isSelecting is true', () => {
      renderCard({ isSelecting: true })

      expect(screen.getByRole('button', { name: 'Selecting…' })).toBeDisabled()
    })
  })

  // HON-750: the dialog's cards are tall, so the image sits below the content.
  describe('meal image', () => {
    it('puts the image below the name and above the Select button', () => {
      renderCard({
        meal: {
          ...mockMeal,
          imageStatus: 'ready',
          imageUrl: 'https://store.public.blob.vercel-storage.com/meals/meal-1.png',
          imageHue: 40,
        },
      })

      const image = screen.getByTestId('meal-card-image')
      const name = screen.getByRole('button', { name: 'Chicken Rice Bowl' })
      const select = screen.getByRole('button', { name: 'Select' })
      expect(name.compareDocumentPosition(image)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(image.compareDocumentPosition(select)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(image).not.toHaveClass('absolute')
    })
  })

  // HON-340: the card says when the household's own ratings moved the suggestion.
  describe('rating reason', () => {
    const renderWith = (meal: AlternativeMeal) => renderCard({ meal })

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
    const renderWithPantry = (pantryIngredients?: PantryIngredient[]) =>
      renderCard({ pantryIngredients })

    it('counts the missing ingredients', () => {
      renderWithPantry([{ ingredientId: 'ingredient-1', isStaple: false }])

      expect(screen.getByText('1 ingredient to buy')).toBeInTheDocument()
    })

    it('says so when every ingredient is in the pantry or a staple', () => {
      renderWithPantry([
        { ingredientId: 'ingredient-1', isStaple: false },
        { ingredientId: 'ingredient-2', isStaple: true },
      ])

      expect(screen.getByText('Have all ingredients')).toBeInTheDocument()
    })

    it('shows no badge without pantry data', () => {
      renderWithPantry()

      expect(screen.queryByText(/ingredients? to buy|Have all ingredients/)).not.toBeInTheDocument()
    })

    it('shows no badge when the pantry holds only staples (HON-769 defaults)', () => {
      renderWithPantry([{ ingredientId: 'salt', isStaple: true }])

      expect(screen.queryByText(/ingredients? to buy|Have all ingredients/)).not.toBeInTheDocument()
    })
  })

  // HON-1388: "what have we not had lately?"
  describe('cooking history line', () => {
    afterEach(() => vi.useRealTimers())

    function onThe28th() {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 28, 12))
    }

    it('says how long ago the household cooked it', () => {
      onThe28th()
      renderCard({ meal: { ...mockMeal, lastCookedOn: '2026-10-16', nextPlannedOn: null } })

      expect(screen.getByText('Cooked 12 days ago')).toBeInTheDocument()
    })

    it('says a recipe is not cooked yet and when it is planned', () => {
      onThe28th()
      renderCard({ meal: { ...mockMeal, lastCookedOn: null, nextPlannedOn: '2026-10-31' } })

      expect(screen.getByText('Not cooked yet · Planned: Sat, Oct 31')).toBeInTheDocument()
    })

    it('shows no line on a suggestion, which carries no history', () => {
      renderCard()

      expect(screen.queryByText(/Cooked|Not cooked yet/)).not.toBeInTheDocument()
    })
  })
})
