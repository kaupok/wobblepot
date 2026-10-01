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
  describe('prep time', () => {
    it('shows the badge for a known prep time', () => {
      render(<MealCardBase meal={{ ...mockMeal, timeMinutes: 25 }} />)

      expect(screen.getByText(/25/)).toBeInTheDocument()
    })

    it('renders a zero-minute meal exactly like one with no prep time, with no stray "0" (HON-711)', () => {
      const zero = render(<MealCardBase meal={{ ...mockMeal, timeMinutes: 0 }} />)
      const zeroHtml = zero.container.innerHTML
      zero.unmount()
      const unknown = render(<MealCardBase meal={{ ...mockMeal, timeMinutes: null }} />)

      expect(zeroHtml).toBe(unknown.container.innerHTML)
    })
  })

  describe('meal name', () => {
    it('renders at the Section size, never the Title size (HON-784)', () => {
      render(<MealCardBase meal={mockMeal} />)

      const name = screen.getByRole('heading', { name: 'Salmon Rice Bowl' })
      expect(name).toHaveClass('text-base', 'font-semibold')
      expect(name).not.toHaveClass('text-xl')
    })

    it('keeps the tag the caller passes', () => {
      render(<MealCardBase meal={mockMeal} nameHeadingTag="h3" />)

      expect(screen.getByRole('heading', { level: 3, name: 'Salmon Rice Bowl' })).toHaveClass(
        'text-base',
      )
    })
  })

  describe('ingredient list visibility', () => {
    it('shows the list at every width by default', () => {
      render(<MealCardBase meal={mockMeal} />)

      const list = screen.getByText('Salmon').closest('ul')
      expect(list).toBeInTheDocument()
      expect(list).not.toHaveClass('hidden')
    })

    it("leaves the list out of the DOM with ingredients='never' (HON-819)", () => {
      const { container } = render(<MealCardBase meal={mockMeal} ingredients="never" />)

      expect(container.querySelector('ul')).toBeNull()
      expect(screen.queryByText('Salmon')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Salmon Rice Bowl' })).toBeInTheDocument()
    })
  })

  describe('source URL rendering', () => {
    it('renders link for https URLs', () => {
      const meal = { ...mockMeal, sourceUrl: 'https://example.com/recipe' }
      render(<MealCardBase meal={meal} />)

      const link = screen.getByRole('link', { name: /view original recipe/i })
      expect(link).toHaveAttribute('href', 'https://example.com/recipe')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('does not render link for javascript: URLs', () => {
      const meal = { ...mockMeal, sourceUrl: 'javascript:alert(1)' }
      render(<MealCardBase meal={meal} />)

      expect(screen.queryByRole('link', { name: /view original recipe/i })).not.toBeInTheDocument()
    })

    it('does not render link when sourceUrl is null', () => {
      const meal = { ...mockMeal, sourceUrl: null }
      render(<MealCardBase meal={meal} />)

      expect(screen.queryByRole('link', { name: /view original recipe/i })).not.toBeInTheDocument()
    })
  })

  describe('ingredient availability color-coding', () => {
    it('renders ingredients without color-coding when no pantry data', () => {
      render(<MealCardBase meal={mockMeal} />)

      const salmon = screen.getByText('Salmon')
      expect(salmon.closest('li')).not.toHaveClass('text-success')
      expect(salmon.closest('li')).not.toHaveClass('text-warning')
    })

    it('renders available ingredients in green', () => {
      const pantry: PantryIngredient[] = [
        { ingredientId: 'ing-salmon', isStaple: false },
        { ingredientId: 'ing-rice', isStaple: false },
      ]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const salmon = screen.getByText('Salmon').closest('li')
      expect(salmon).toHaveClass('text-success')
    })

    it('renders missing ingredients in amber', () => {
      const pantry: PantryIngredient[] = [{ ingredientId: 'ing-salmon', isStaple: false }]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const avocado = screen.getByText('Avocado').closest('li')
      expect(avocado).toHaveClass('text-warning')
    })

    it('renders staples as available (green)', () => {
      const pantry: PantryIngredient[] = [
        { ingredientId: 'ing-soy', isStaple: true },
        { ingredientId: 'ing-salmon', isStaple: false },
      ]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const soy = screen.getByText('Soy sauce').closest('li')
      expect(soy).toHaveClass('text-success')
    })

    it('does not color-code when the pantry holds only staples (HON-769 defaults)', () => {
      const pantry: PantryIngredient[] = [{ ingredientId: 'ing-soy', isStaple: true }]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      for (const name of ['Salmon', 'Soy sauce', 'Avocado']) {
        const li = screen.getByText(name).closest('li')
        expect(li).not.toHaveClass('text-success')
        expect(li).not.toHaveClass('text-warning')
      }
    })

    it('colors all ingredients correctly with mixed availability', () => {
      const pantry: PantryIngredient[] = [
        { ingredientId: 'ing-salmon', isStaple: false },
        { ingredientId: 'ing-rice', isStaple: false },
        { ingredientId: 'ing-soy', isStaple: true },
        // avocado not in pantry
      ]

      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      expect(screen.getByText('Salmon').closest('li')).toHaveClass('text-success')
      expect(screen.getByText('Sushi rice').closest('li')).toHaveClass('text-success')
      expect(screen.getByText('Soy sauce').closest('li')).toHaveClass('text-success')
      expect(screen.getByText('Avocado').closest('li')).toHaveClass('text-warning')
    })
  })

  // Colour is never the only cue (docs/DESIGN.md → Color, HON-816).
  describe('ingredient availability cues beyond colour', () => {
    const pantry: PantryIngredient[] = [
      { ingredientId: 'ing-salmon', isStaple: false },
      { ingredientId: 'ing-soy', isStaple: true },
    ]

    it('names the state of an available and a missing ingredient in hidden text', () => {
      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const salmon = screen.getByText('Salmon').closest('li')!
      const avocado = screen.getByText('Avocado').closest('li')!
      expect(salmon).toHaveTextContent('Salmon, available')
      expect(avocado).toHaveTextContent('Avocado, not available')
      expect(screen.getAllByText(', available')[0]).toHaveClass('sr-only')
      expect(screen.getAllByText(', not available')[0]).toHaveClass('sr-only')
    })

    it('marks staples as available in the hidden text too', () => {
      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      expect(screen.getByText('Soy sauce').closest('li')).toHaveTextContent('Soy sauce, available')
    })

    it('gives available and missing rows different decorative icons in place of bullets', () => {
      render(<MealCardBase meal={mockMeal} pantryIngredients={pantry} />)

      const salmon = screen.getByText('Salmon').closest('li')!
      const avocado = screen.getByText('Avocado').closest('li')!
      const salmonIcon = salmon.querySelector('svg')!
      const avocadoIcon = avocado.querySelector('svg')!
      expect(salmonIcon).toHaveClass('lucide-check')
      expect(avocadoIcon).toHaveClass('lucide-minus')
      expect(salmonIcon).toHaveAttribute('aria-hidden', 'true')
      expect(avocadoIcon).toHaveAttribute('aria-hidden', 'true')
      expect(salmon.closest('ul')).not.toHaveClass('list-disc')
    })

    it('keeps the muted bulleted list, with no icons or state text, without pantry data', () => {
      render(<MealCardBase meal={mockMeal} />)

      const list = screen.getByText('Salmon').closest('ul')!
      expect(list).toHaveClass('list-disc', 'text-muted-foreground')
      expect(list.querySelector('svg')).toBeNull()
      expect(screen.queryByText(/available/)).not.toBeInTheDocument()
    })

    it("renders no list with ingredients='never', even with pantry data", () => {
      const { container } = render(
        <MealCardBase meal={mockMeal} pantryIngredients={pantry} ingredients="never" />,
      )

      expect(container.querySelector('ul')).toBeNull()
      expect(screen.queryByText(/available/)).not.toBeInTheDocument()
    })
  })
})
