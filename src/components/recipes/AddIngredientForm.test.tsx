import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubPointerApis } from '@/test/household-settings'
import { createQueryWrapper } from '@/test/query-wrapper'

import { AddIngredientForm } from './AddIngredientForm'

// The global next-intl mock answers from the English catalog (HON-1263).

const created = {
  id: 'ing-lovage',
  name: 'lovage',
  category: 'vegetable',
  defaultUnit: 'g',
  gramsPerPiece: null,
  measuredByVolume: false,
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 1.5,
}

function renderForm(onCreated = vi.fn()) {
  const { wrapper } = createQueryWrapper()
  render(<AddIngredientForm extractedName="lovage" onCreated={onCreated} onCancel={vi.fn()} />, {
    wrapper,
  })
  return { onCreated }
}

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Category' }))
  await user.click(await screen.findByRole('option', { name: label }))
}

async function fillNutrition(user: ReturnType<typeof userEvent.setup>, fat = '1,5') {
  await user.type(screen.getByLabelText('Calories, kcal'), '36')
  await user.type(screen.getByLabelText('Protein, g'), '3')
  await user.type(screen.getByLabelText('Carbs, g'), '6')
  await user.type(screen.getByLabelText('Fat, g'), fat)
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubPointerApis()
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ ingredient: created }), { status: 201 }))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('AddIngredientForm', () => {
  it('moves focus to the name, prefilled with the recipe name', () => {
    renderForm()

    expect(screen.getByLabelText('Name')).toHaveValue('lovage')
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('asks for grams per piece only when measured in pieces', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.queryByLabelText('Grams per piece')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Pieces' }))

    expect(screen.getByLabelText('Grams per piece')).toBeInTheDocument()
  })

  it('asks for a protein type for protein, with none chosen', async () => {
    const user = userEvent.setup()
    renderForm()

    await chooseCategory(user, 'Protein')

    const proteinType = screen.getByRole('combobox', { name: 'Protein type' })
    expect(proteinType).toHaveTextContent('Choose a protein type')
    await user.click(proteinType)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Poultry',
      'Beef',
      'Pork',
      'Lamb',
      'Fish',
      'Eggs',
      'Legumes',
    ])
  })

  it('preselects dairy for dairy, and offers plant-based', async () => {
    const user = userEvent.setup()
    renderForm()

    await chooseCategory(user, 'Dairy')

    const proteinType = screen.getByRole('combobox', { name: 'Protein type' })
    expect(proteinType).toHaveTextContent('Dairy')
    await user.click(proteinType)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Dairy',
      'Plant-based',
    ])
  })

  it('asks no protein type for a vegetable', async () => {
    const user = userEvent.setup()
    renderForm()

    await chooseCategory(user, 'Vegetables')

    expect(screen.queryByRole('combobox', { name: 'Protein type' })).not.toBeInTheDocument()
  })

  it('does not save with an empty calories field', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderForm()
    await chooseCategory(user, 'Vegetables')
    await user.type(screen.getByLabelText('Protein, g'), '3')
    await user.type(screen.getByLabelText('Carbs, g'), '6')
    await user.type(screen.getByLabelText('Fat, g'), '1')

    await user.click(screen.getByRole('button', { name: 'Save ingredient' }))

    expect(screen.getByLabelText('Calories, kcal')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a value')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('submits "1,5" in the fat field as 1.5, with the ticked allergens', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderForm()
    await chooseCategory(user, 'Vegetables')
    await fillNutrition(user)
    await user.click(screen.getByRole('button', { name: 'Sesame' }))

    await user.click(screen.getByRole('button', { name: 'Save ingredient' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('/api/ingredients')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'lovage',
      category: 'vegetable',
      defaultUnit: 'g',
      allergens: ['sesame'],
      calories: 36,
      protein: 3,
      carbs: 6,
      fat: 1.5,
    })
  })

  it('marks the field a 400 names, in catalog copy', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Validation failed', details: { fat: ['Too big'] } }), {
        status: 400,
      }),
    )
    const user = userEvent.setup()
    renderForm()
    await chooseCategory(user, 'Vegetables')
    await fillNutrition(user, '2')

    await user.click(screen.getByRole('button', { name: 'Save ingredient' }))

    expect(await screen.findByText('Check this value')).toBeInTheDocument()
    expect(screen.getByLabelText('Fat, g')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Too big')).not.toBeInTheDocument()
  })
})
