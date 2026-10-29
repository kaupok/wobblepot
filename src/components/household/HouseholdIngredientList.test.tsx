import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubPointerApis } from '@/test/household-settings'
import { createQueryWrapper } from '@/test/query-wrapper'

import { HouseholdIngredientList } from './HouseholdIngredientList'
import { lovage, speltPasta } from './ingredient-fixtures'

// The global next-intl mock answers from the English catalog.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchSpy: ReturnType<typeof vi.spyOn>

function mockList(ingredients = [lovage, speltPasta]) {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/households/me/ingredients') return json({ ingredients })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return json({ ingredient: lovage })
  })
}

function renderList() {
  render(<HouseholdIngredientList />, createQueryWrapper())
}

/** The list item whose first line is `name`. */
async function row(name: string) {
  const items = await screen.findAllByRole('listitem')
  return within(items.find((item) => within(item).queryByText(name, { exact: true }))!)
}

beforeEach(() => {
  stubPointerApis()
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  mockList()
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('HouseholdIngredientList', () => {
  it('renders its title as an h2 under the page h1', async () => {
    renderList()

    expect(
      await screen.findByRole('heading', { name: 'Ingredients you added', level: 2 }),
    ).toBeInTheDocument()
  })

  it('shows each row with its category and allergens, and Edit and Delete', async () => {
    renderList()

    const pasta = await row('spelt pasta')
    expect(pasta.getByText('Carbs · Contains: Gluten, Eggs')).toBeInTheDocument()
    expect(pasta.getByRole('button', { name: 'Edit spelt pasta' })).toBeInTheDocument()
    expect(pasta.getByRole('button', { name: 'Delete spelt pasta' })).toBeInTheDocument()
    expect((await row('lovage')).getByText('Vegetables')).toBeInTheDocument()
  })

  it('says where ingredients come from when the household added none', async () => {
    mockList([])

    renderList()

    expect(
      await screen.findByText('Ingredients you add from a recipe show here.'),
    ).toBeInTheDocument()
  })

  it('shows the failure copy when the list request fails', async () => {
    fetchSpy.mockResolvedValue(json({}, 500))

    renderList()

    expect(
      await screen.findByText('Could not load your ingredients. Reload the page to try again.'),
    ).toBeInTheDocument()
  })

  it('opens Edit filled from the row, and returns focus to Edit on Cancel', async () => {
    const user = userEvent.setup()
    renderList()
    const edit = (await row('spelt pasta')).getByRole('button', { name: 'Edit spelt pasta' })

    await user.click(edit)

    const dialog = await screen.findByRole('dialog', { name: 'Edit ingredient: spelt pasta' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('spelt pasta')
    expect(within(dialog).getByRole('button', { name: 'Gluten' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(edit).toHaveFocus())
  })

  it('opens Edit from the row again after a cancelled edit', async () => {
    const user = userEvent.setup()
    renderList()
    const edit = (await row('lovage')).getByRole('button', { name: 'Edit lovage' })
    await user.click(edit)
    const name = within(await screen.findByRole('dialog')).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'wild lovage')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(edit)

    expect(within(await screen.findByRole('dialog')).getByLabelText('Name')).toHaveValue('lovage')
  })

  it('returns focus to Delete when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup()
    renderList()
    const del = (await row('lovage')).getByRole('button', { name: 'Delete lovage' })

    await user.click(del)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(del).toHaveFocus())
  })

  it('moves focus to the heading once Delete removed the row', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click((await row('lovage')).getByRole('button', { name: 'Delete lovage' }))
    // The refetch answers only after the dialog has closed, as on a slow network.
    let answerRefetch = () => {}
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      await new Promise<void>((resolve) => (answerRefetch = resolve))
      return json({ ingredients: [speltPasta] })
    })

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByText('lovage')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('/api/ingredients/ing-lovage', { method: 'DELETE' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ingredients you added' })).toHaveFocus(),
    )
    answerRefetch()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Ingredients you added' })).toHaveFocus(),
    )
  })
})
