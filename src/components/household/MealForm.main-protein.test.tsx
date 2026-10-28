import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { stubPointerApis } from '@/test/household-settings'
import { MealForm, type MealFormData } from './MealForm'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// The "Main protein" select (HON-1386). Beef mince carries 26 g protein per
// 100 g and kidney beans 8.7 g, so the amounts decide the automatic value.

const mince = {
  id: 'mince',
  name: 'Beef mince',
  category: 'protein' as const,
  defaultUnit: 'g' as const,
  protein: 26,
  calories: 250,
  proteinType: 'beef' as const,
}
const beans = {
  id: 'beans',
  name: 'Kidney beans',
  category: 'legume' as const,
  defaultUnit: 'g' as const,
  protein: 8.7,
  calories: 127,
  proteinType: 'legume' as const,
}
const buckwheat = {
  id: 'buckwheat',
  name: 'Buckwheat',
  category: 'carb' as const,
  defaultUnit: 'g' as const,
  protein: 13,
  calories: 343,
  proteinType: null,
}

/** A saved recipe over 3 servings, with each ingredient's recipe total in grams. */
function recipe(
  totals: [typeof mince | typeof beans | typeof buckwheat, number][],
  extra: Partial<MealFormData> = {},
): MealFormData {
  return {
    id: 'meal-1',
    name: 'Mince and beans',
    kidFriendly: false,
    suitableFor: ['dinner'],
    servings: 3,
    components: totals.map(([ingredient, total]) => ({
      ingredientId: ingredient.id,
      quantityPerServing: total / 3,
      ingredient,
    })),
    ...extra,
  }
}

const select = () => screen.queryByRole('combobox', { name: 'Main protein' })

async function options() {
  await userEvent.click(select()!)
  return (await screen.findAllByRole('option')).map((option) => option.textContent)
}

describe('MealForm main protein', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    stubPointerApis()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'meal-1' }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  function renderForm(meal: MealFormData) {
    const { wrapper } = createQueryWrapper()
    return render(<MealForm meal={meal} onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper })
  }

  async function savedBody() {
    await userEvent.click(screen.getByRole('button', { name: 'Update recipe' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    return JSON.parse(fetchMock.mock.calls[0]![1].body as string)
  }

  it('is hidden when the ingredients carry one protein type', () => {
    renderForm(
      recipe([
        [mince, 225],
        [buckwheat, 150],
      ]),
    )

    expect(select()).not.toBeInTheDocument()
  })

  it('is hidden when the ingredients carry no protein type', () => {
    renderForm(recipe([[buckwheat, 150]]))

    expect(select()).not.toBeInTheDocument()
  })

  it('offers the derived value first, then each protein type, for 225 g mince and 172.5 g beans', async () => {
    renderForm(
      recipe([
        [mince, 225],
        [beans, 172.5],
      ]),
    )

    expect(select()).toHaveTextContent('Beef (automatic)')
    expect(await options()).toEqual(['Beef (automatic)', 'Beef', 'Legumes'])
  })

  it('labels automatic Legumes for 75 g mince and 400 g beans, and sends Beef when chosen', async () => {
    renderForm(
      recipe([
        [mince, 75],
        [beans, 400],
      ]),
    )
    expect(select()).toHaveTextContent('Legumes (automatic)')

    await options()
    await userEvent.click(screen.getByRole('option', { name: 'Beef' }))

    expect((await savedBody()).proteinTypeOverride).toBe('beef')
  })

  it('sends Legumes when chosen', async () => {
    renderForm(
      recipe([
        [mince, 225],
        [beans, 172.5],
      ]),
    )

    await options()
    await userEvent.click(screen.getByRole('option', { name: 'Legumes' }))

    expect((await savedBody()).proteinTypeOverride).toBe('legume')
  })

  it('reopens with the stored choice selected', () => {
    renderForm(
      recipe(
        [
          [mince, 75],
          [beans, 400],
        ],
        { proteinTypeOverride: 'beef' },
      ),
    )

    expect(select()).toHaveTextContent('Beef')
    expect(select()).not.toHaveTextContent('automatic')
  })

  it('sends null for automatic', async () => {
    renderForm(
      recipe(
        [
          [mince, 75],
          [beans, 400],
        ],
        { proteinTypeOverride: 'beef' },
      ),
    )

    await options()
    await userEvent.click(screen.getByRole('option', { name: 'Legumes (automatic)' }))

    expect((await savedBody()).proteinTypeOverride).toBeNull()
  })

  it('hides the select and sends null once removing the beans leaves one type', async () => {
    renderForm(
      recipe(
        [
          [mince, 75],
          [beans, 400],
        ],
        { proteinTypeOverride: 'legume' },
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove Kidney beans' }))

    expect(select()).not.toBeInTheDocument()
    expect((await savedBody()).proteinTypeOverride).toBeNull()
  })

  it('falls back to automatic when the chosen type leaves the ingredients', async () => {
    renderForm(
      recipe(
        [
          [mince, 75],
          [beans, 400],
          [{ ...buckwheat, proteinType: 'dairy' as never }, 150],
        ],
        {
          proteinTypeOverride: 'beef',
        },
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove Beef mince' }))

    expect(select()).toHaveTextContent('(automatic)')
    expect((await savedBody()).proteinTypeOverride).toBeNull()
  })

  it('shows catalog copy when the server refuses the choice', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'English', code: 'proteinTypeNotInRecipe' }),
    })
    renderForm(
      recipe(
        [
          [mince, 75],
          [beans, 400],
        ],
        { proteinTypeOverride: 'beef' },
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Update recipe' }))

    expect(
      await screen.findByText('This recipe has no ingredient with that protein'),
    ).toBeInTheDocument()
  })
})
