import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { DeleteIngredientDialog } from './DeleteIngredientDialog'
import { lovage } from './ingredient-fixtures'

// The global next-intl mock answers from the English catalog.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchSpy: ReturnType<typeof vi.spyOn>

function renderDialog() {
  const onOpenChange = vi.fn()
  const { wrapper, queryClient } = createQueryWrapper()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(<DeleteIngredientDialog ingredient={lovage} open onOpenChange={onOpenChange} />, {
    wrapper,
  })
  return { onOpenChange, invalidate }
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('DeleteIngredientDialog', () => {
  it('asks before it deletes', () => {
    renderDialog()

    expect(
      screen.getByRole('alertdialog', { name: 'Delete ingredient: lovage?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This removes the ingredient from your household. You cannot undo this.'),
    ).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deletes, refreshes the list and the search, and closes', async () => {
    const user = userEvent.setup()
    const { onOpenChange, invalidate } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fetchSpy).toHaveBeenCalledWith('/api/ingredients/ing-lovage', { method: 'DELETE' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household-ingredients'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ingredients'] })
  })

  it('names each use with a count above zero on in_use, in catalog copy', async () => {
    fetchSpy.mockResolvedValue(
      json(
        {
          error: 'Ingredient in use',
          code: 'in_use',
          uses: {
            meals: 2,
            deletedMealsInPlan: 0,
            pantry: 1,
            shoppingList: 0,
            mealPlan: 1,
            extras: 0,
          },
        },
        409,
      ),
    )
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText(
        'lovage is still in use, so you cannot delete it: 2 recipes, the pantry, 1 meal plan entry. Remove it from those first.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Ingredient in use')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('names a deleted recipe in the meal plan apart from recipes', async () => {
    fetchSpy.mockResolvedValue(
      json(
        {
          error: 'Ingredient in use',
          code: 'in_use',
          uses: {
            meals: 0,
            deletedMealsInPlan: 1,
            pantry: 0,
            shoppingList: 0,
            mealPlan: 0,
            extras: 0,
          },
        },
        409,
      ),
    )
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText(
        'lovage is still in use, so you cannot delete it: 1 deleted recipe still in your meal plan. Remove it from those first.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/1 recipe\b/)).not.toBeInTheDocument()
  })

  it('says the delete failed and logs the body on an in_use body with no uses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = { error: 'Ingredient in use', code: 'in_use' }
    fetchSpy.mockResolvedValue(json(body, 409))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Could not delete the ingredient. Try again.'),
    ).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith(
      '[DeleteIngredientDialog] Unexpected in_use body:',
      body,
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('says the delete failed on any other error', async () => {
    fetchSpy.mockResolvedValue(json({ error: 'boom' }, 500))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Could not delete the ingredient. Try again.'),
    ).toBeInTheDocument()
  })
})
