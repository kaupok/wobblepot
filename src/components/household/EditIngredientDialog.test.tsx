import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubPointerApis } from '@/test/household-settings'
import { createQueryWrapper } from '@/test/query-wrapper'

import { EditIngredientDialog } from './EditIngredientDialog'
import { speltPasta } from './ingredient-fixtures'

// The global next-intl mock answers from the English catalog.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchSpy: ReturnType<typeof vi.spyOn>

function renderDialog(onOpenChange = vi.fn()) {
  const { wrapper, queryClient } = createQueryWrapper()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(<EditIngredientDialog ingredient={speltPasta} open onOpenChange={onOpenChange} />, {
    wrapper,
  })
  return { onOpenChange, invalidate, dialog: screen.getByRole('dialog') }
}

beforeEach(() => {
  stubPointerApis()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ingredient: speltPasta }))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('EditIngredientDialog', () => {
  it('saves a corrected allergen, then refreshes the list and the search, and closes', async () => {
    const user = userEvent.setup()
    const { onOpenChange, invalidate, dialog } = renderDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Eggs' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ingredients/ing-spelt-pasta')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'spelt pasta',
      category: 'carb',
      defaultUnit: 'g',
      allergens: ['gluten'],
      calories: 350,
      protein: 13,
      carbs: 70,
      fat: 2.5,
      fiber: 8,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household-ingredients'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ingredients'] })
  })

  it('marks the name with catalog copy on name_taken, and stays open', async () => {
    fetchSpy.mockResolvedValue(
      json({ error: 'An ingredient with this name exists', code: 'name_taken' }, 409),
    )
    const user = userEvent.setup()
    const { onOpenChange, dialog } = renderDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const name = within(dialog).getByLabelText('Name')
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAccessibleDescription(
      'An ingredient with this name exists. Choose another name, or use that ingredient in your recipes.',
    )
    expect(screen.queryByText('An ingredient with this name exists')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('says the unit cannot change on unit_locked', async () => {
    fetchSpy.mockResolvedValue(json({ error: 'locked', code: 'unit_locked', uses: {} }, 409))
    const user = userEvent.setup()
    const { dialog } = renderDialog()

    await user.click(within(dialog).getByRole('radio', { name: 'Pieces' }))
    await user.type(within(dialog).getByLabelText('Grams per piece'), '80')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(
      await within(dialog).findByText('This ingredient is in use, so its unit cannot change.'),
    ).toBeInTheDocument()
  })

  it('checks the fields before it sends anything', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
