import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealForm, type MealFormData } from './MealForm'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

/**
 * The form's ingredient search reads through `useIngredientSearch`, so every
 * render needs a query client. Shadowing `render` keeps the call sites plain.
 */
function render(ui: ReactElement) {
  const { wrapper } = createQueryWrapper()
  return rtlRender(ui, { wrapper })
}

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('MealForm - Duplicate Detection', () => {
  const mockOnSuccess = vi.fn()
  const mockOnCancel = vi.fn()

  const createMockIngredient = (id: string, name: string) => ({
    id,
    name,
    category: 'vegetable' as IngredientCategory,
    defaultUnit: 'g' as Unit,
  })

  describe('Regular mode (components)', () => {
    it('should detect and display duplicate ingredients', () => {
      const mockMeal: MealFormData = {
        id: '1',
        name: 'Test Meal',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        servings: 4,
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'onion-1',
            quantityPerServing: 50,
            ingredient: createMockIngredient('onion-1', 'Onion'),
          },
          {
            ingredientId: 'tomato-1', // Duplicate
            quantityPerServing: 75,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Find all ingredient rows
      const ingredientRows = screen.getAllByText(/Tomato|Onion/)

      // First Tomato (row 1) should show warning about row 3
      const firstTomatoRow = ingredientRows[0]?.closest('div')
      expect(within(firstTomatoRow!).getByText(/Also used in row 3/i)).toBeInTheDocument()

      // Onion (row 2) should NOT have warning
      const onionRow = ingredientRows[1]?.closest('div')
      expect(within(onionRow!).queryByText(/Also used in row/i)).not.toBeInTheDocument()

      // Second Tomato (row 3) should show warning about row 1
      const secondTomatoRow = ingredientRows[2]?.closest('div')
      expect(within(secondTomatoRow!).getByText(/Also used in row 1/i)).toBeInTheDocument()
    })

    it('should show multiple row numbers for ingredients used 3+ times', () => {
      const mockMeal: MealFormData = {
        id: '1',
        name: 'Test Meal',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        servings: 4,
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 50,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 75,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // First Tomato should reference rows 2, 3
      const firstRow = screen.getAllByText('Tomato')[0]?.closest('div')
      expect(within(firstRow!).getByText(/Also used in rows 2, 3/i)).toBeInTheDocument()

      // Second Tomato should reference rows 1, 3
      const secondRow = screen.getAllByText('Tomato')[1]?.closest('div')
      expect(within(secondRow!).getByText(/Also used in rows 1, 3/i)).toBeInTheDocument()

      // Third Tomato should reference rows 1, 2
      const thirdRow = screen.getAllByText('Tomato')[2]?.closest('div')
      expect(within(thirdRow!).getByText(/Also used in rows 1, 2/i)).toBeInTheDocument()
    })
  })

  describe('Import mode (ingredient rows)', () => {
    it('should detect duplicates in matched ingredient rows', () => {
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
          {
            type: 'matched',
            ingredient: createMockIngredient('onion-1', 'Onion'),
            convertedQuantity: 100,
          },
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'), // Duplicate
            convertedQuantity: 150,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Find duplicate warnings
      const warnings = screen.getAllByText(/Also used in row/i)
      expect(warnings).toHaveLength(2) // Both duplicate Tomato rows should show warning
    })

    it('should detect duplicates in low-confidence ingredient rows', () => {
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'low-confidence',
            extractedName: 'tomato',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            alternatives: [
              {
                id: 'cherry-tomato-1',
                name: 'Cherry Tomato',
                category: 'vegetable' as IngredientCategory,
                defaultUnit: 'g' as Unit,
                similarity: 0.8,
              },
            ],
            convertedQuantity: 200,
          },
          {
            type: 'low-confidence',
            extractedName: 'tomato',
            ingredient: createMockIngredient('tomato-1', 'Tomato'), // Duplicate
            alternatives: [
              {
                id: 'cherry-tomato-1',
                name: 'Cherry Tomato',
                category: 'vegetable' as IngredientCategory,
                defaultUnit: 'g' as Unit,
                similarity: 0.8,
              },
            ],
            convertedQuantity: 150,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Both low-confidence duplicates should show warnings
      const warnings = screen.getAllByText(/Also used in row/i)
      expect(warnings).toHaveLength(2)
    })

    it('should not detect duplicates for unmatched ingredients', () => {
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'unmatched',
            extractedName: 'mystery spice',
            originalText: '1 tsp mystery spice',
            extractedQuantity: 5,
            extractedUnit: 'g',
          },
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Unmatched ingredients should not trigger duplicate detection
      expect(screen.queryByText(/Also used in row/i)).not.toBeInTheDocument()
    })
  })

  describe('Warning message format', () => {
    it('should use singular "row" for single duplicate', () => {
      const mockMeal: MealFormData = {
        id: '1',
        name: 'Test Meal',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        servings: 4,
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 50,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Should say "row 2", not "rows 2"
      expect(screen.getByText(/Also used in row 2/i)).toBeInTheDocument()
      expect(screen.queryByText(/Also used in rows 2/i)).not.toBeInTheDocument()
    })

    it('should use plural "rows" for multiple duplicates', () => {
      const mockMeal: MealFormData = {
        id: '1',
        name: 'Test Meal',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        servings: 4,
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 50,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 75,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // Should say "rows 2, 3", not "row 2, 3"
      expect(screen.getByText(/Also used in rows 2, 3/i)).toBeInTheDocument()
    })

    it('should display 1-indexed row numbers', () => {
      const mockMeal: MealFormData = {
        id: '1',
        name: 'Test Meal',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        servings: 4,
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
          {
            ingredientId: 'onion-1',
            quantityPerServing: 50,
            ingredient: createMockIngredient('onion-1', 'Onion'),
          },
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 75,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      // First Tomato (index 0) should reference row 3 (index 2), not row 2
      const firstTomato = screen.getAllByText('Tomato')[0]?.closest('div')
      expect(within(firstTomato!).getByText(/Also used in row 3/i)).toBeInTheDocument()

      // Second Tomato (index 2) should reference row 1 (index 0), not row 0
      const secondTomato = screen.getAllByText('Tomato')[1]?.closest('div')
      expect(within(secondTomato!).getByText(/Also used in row 1/i)).toBeInTheDocument()
    })
  })

  describe('Discard confirmation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should show confirmation dialog when canceling form with imported data', async () => {
      const user = userEvent.setup()
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/discard imported recipe\?/i)).toBeInTheDocument()
        expect(
          screen.getByText(/are you sure you want to discard this imported recipe/i),
        ).toBeInTheDocument()
      })

      // onCancel should NOT be called yet
      expect(mockOnCancel).not.toHaveBeenCalled()
    })

    it('should keep editing when user cancels confirmation', async () => {
      const user = userEvent.setup()
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText(/discard imported recipe\?/i)).toBeInTheDocument()
      })

      // Click "Keep editing"
      const keepEditingButton = screen.getByRole('button', { name: /keep editing/i })
      await user.click(keepEditingButton)

      // Dialog should close, form should remain
      await waitFor(() => {
        expect(screen.queryByText(/discard imported recipe\?/i)).not.toBeInTheDocument()
      })

      // onCancel should NOT be called
      expect(mockOnCancel).not.toHaveBeenCalled()

      // Form should still be visible
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should call onCancel when user confirms discard', async () => {
      const user = userEvent.setup()
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText(/discard imported recipe\?/i)).toBeInTheDocument()
      })

      // Click "Discard"
      const discardButton = screen.getByRole('button', { name: /^discard$/i })
      await user.click(discardButton)

      // onCancel should be called
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalledTimes(1)
      })
    })

    it('should NOT show confirmation when canceling form without imported data', async () => {
      const user = userEvent.setup()
      const mockMeal: MealFormData = {
        name: 'Manual Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        components: [
          {
            ingredientId: 'tomato-1',
            quantityPerServing: 100,
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Confirmation dialog should NOT appear
      expect(screen.queryByText(/discard imported recipe\?/i)).not.toBeInTheDocument()

      // onCancel should be called immediately
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should NOT show confirmation when creating meal from scratch', async () => {
      const user = userEvent.setup()

      render(<MealForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Confirmation dialog should NOT appear
      expect(screen.queryByText(/discard imported recipe\?/i)).not.toBeInTheDocument()

      // onCancel should be called immediately
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should add beforeunload listener when form has imported data', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      render(<MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    })

    it('should NOT add beforeunload listener when form has no imported data', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      render(<MealForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />)

      expect(addEventListenerSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
    })

    it('should remove beforeunload listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      const mockMeal: MealFormData = {
        name: 'Imported Recipe',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          {
            type: 'matched',
            ingredient: createMockIngredient('tomato-1', 'Tomato'),
            convertedQuantity: 200,
          },
        ],
      }

      const { unmount } = render(
        <MealForm meal={mockMeal} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />,
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    })
  })
})

/**
 * The form's title sits at the Title level (`variant="h4"`, rendering `<h4>`);
 * its sections sit one level below it in both the type scale and the document
 * outline. See HON-613.
 *
 * The section level is read off the title's tag rather than restated, so this
 * asserts the *relationship* rather than two independent constants — the same
 * shape as `HouseholdSettingsForm.test.tsx`, deliberately, so the two do not
 * diverge. It catches what axe's `heading-order` cannot: that rule only flags
 * increases greater than one, so a `variant="section"` swap that forgets `as`
 * (rendering the default `<h2>`, *above* the title) reads to axe as a legal
 * decrease. `MealForm.tsx:106` is the one `variant="h4"` the type scale says
 * stays put, so the title is not expected to move here — but pinning the
 * relationship costs nothing and keeps both files honest.
 */
describe('MealForm - section heading hierarchy', () => {
  const mockMeal: MealFormData = {
    id: '1',
    name: 'Test Meal',
    kidFriendly: false,
    suitableFor: ['dinner' as MealType],
    servings: 4,
    components: [],
  }

  it('renders the form title at h4 and every section one level below it', () => {
    render(<MealForm meal={mockMeal} onSuccess={vi.fn()} onCancel={vi.fn()} />)

    const title = screen.getByRole('heading', { name: 'Edit meal', level: 4 })
    const titleLevel = Number(title.tagName.slice(1))

    for (const name of ['Basic information', 'Ingredients', 'Additional details']) {
      expect(screen.getByRole('heading', { name, level: titleLevel + 1 })).toBeInTheDocument()
    }
  })
})
