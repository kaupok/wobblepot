import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { CustomItemInput } from './CustomItemInput'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const milk = { id: 'pantry-milk', name: 'Milk', englishName: 'Milk', quantity: null }
const oliveOil = { id: 'pantry-oil', name: 'Olive oil', englishName: 'Olive oil', quantity: null }

function renderInput(props: Partial<Parameters<typeof CustomItemInput>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<CustomItemInput onItemAdded={vi.fn()} {...props} />, { wrapper })
}

const reply = (body: unknown, status: number) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

/**
 * `GET /api/pantry/staples` answers with `staples`; every other request with
 * `body` and `status`. Returns the mock, to read the requests back.
 */
function respondWith(body: unknown, status: number, staples: unknown[] = []) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
    url === '/api/pantry/staples' ? reply({ staples }, 200) : reply(body, status),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The requests other than the staples read: `[url, method, body]`. */
const writes = (fetchMock: ReturnType<typeof respondWith>) =>
  fetchMock.mock.calls
    .filter(([url]) => url !== '/api/pantry/staples')
    .map(([url, init]) => {
      const { method, body } = init ?? {}
      return [url, method, body ? JSON.parse(body as string) : undefined]
    })

describe('CustomItemInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.success).mockClear()
  })

  it('renders the input with placeholder', () => {
    respondWith({}, 200)
    renderInput()
    expect(screen.getByPlaceholderText('Add an item…')).toBeInTheDocument()
  })

  it('has proper aria label', () => {
    respondWith({}, 200)
    renderInput()
    expect(screen.getByLabelText('Add custom item to shopping list')).toBeInTheDocument()
  })

  it('does not submit empty input', async () => {
    respondWith({}, 200)
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onItemAdded).not.toHaveBeenCalled()
  })

  it('disables input when disabled prop is true', () => {
    respondWith({}, 200)
    renderInput({ disabled: true })
    expect(screen.getByPlaceholderText('Add an item…')).toBeDisabled()
  })

  it('adds the item, clears the input and hands it to the list', async () => {
    respondWith(
      {
        item: {
          id: 'item-1',
          name: 'Oat milk',
          checked: false,
          ingredientId: 'ing-1',
          ingredient: { category: 'dairy' },
          createdAt: '2026-09-29T09:00:00.000Z',
        },
      },
      201,
    )
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.type(input, 'Oat milk{Enter}')

    await vi.waitFor(() =>
      expect(onItemAdded).toHaveBeenCalledWith({
        id: 'item-1',
        name: 'Oat milk',
        checked: false,
        ingredientId: 'ing-1',
        ingredientCategory: 'dairy',
        createdAt: '2026-09-29T09:00:00.000Z',
      }),
    )
    expect(input).toHaveValue('')
  })

  it('says the item is already on the list for a 409 and keeps the input', async () => {
    respondWith({ error: 'Item already exists' }, 409)
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.type(input, 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Item already on the list'))
    expect(onItemAdded).not.toHaveBeenCalled()
    expect(input).toHaveValue('Oat milk')
  })

  it('toasts the translated failure for a bodiless 500', async () => {
    respondWith({}, 500)
    const user = userEvent.setup()
    renderInput()

    await user.type(screen.getByPlaceholderText('Add an item…'), 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to add item'))
  })

  it("toasts the translated failure, not the route's error text", async () => {
    respondWith({ error: 'Validation failed' }, 400)
    const user = userEvent.setup()
    renderInput()

    await user.type(screen.getByPlaceholderText('Add an item…'), 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to add item'))
    expect(toast.error).not.toHaveBeenCalledWith('Validation failed')
  })

  describe('staples', () => {
    it('suggests a staple whose name contains the typed text, in any case', async () => {
      respondWith({}, 200, [milk, oliveOil])
      const user = userEvent.setup()
      renderInput()

      const input = screen.getByRole('combobox', { name: 'Add custom item to shopping list' })
      await user.type(input, 'MIL')

      const listbox = await screen.findByRole('listbox', { name: 'Staples' })
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['MilkMark ran out'])
      expect(input).toHaveAttribute('aria-expanded', 'true')
    })

    it('matches the English name for an Estonian household', async () => {
      respondWith({}, 200, [{ ...milk, name: 'Piim' }])
      const user = userEvent.setup()
      renderInput()

      await user.type(screen.getByRole('combobox'), 'milk')

      expect(await screen.findByRole('option', { name: /Piim/ })).toBeInTheDocument()
    })

    it('does not suggest a staple that is ran out already', async () => {
      respondWith({}, 200, [{ ...milk, quantity: 0 }])
      const user = userEvent.setup()
      renderInput()

      await user.type(screen.getByRole('combobox'), 'mil')

      // The staples read has landed, so a missing list is not a race.
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pantry/staples', undefined))
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('marks a clicked staple ran out, with no custom item, and says so', async () => {
      const fetchMock = respondWith({ ok: true }, 200, [milk])
      const user = userEvent.setup()
      const onItemAdded = vi.fn()
      const onStapleRanOut = vi.fn()
      renderInput({ onItemAdded, onStapleRanOut })

      const input = screen.getByRole('combobox')
      await user.type(input, 'mil')
      await user.click(await screen.findByRole('option', { name: /Milk/ }))

      await vi.waitFor(() => expect(onStapleRanOut).toHaveBeenCalledWith('pantry-milk'))
      expect(writes(fetchMock)).toEqual([['/api/pantry/pantry-milk', 'PATCH', { quantity: 0 }]])
      expect(toast.success).toHaveBeenCalledWith('Milk marked as ran out')
      expect(onItemAdded).not.toHaveBeenCalled()
      expect(input).toHaveValue('')
      expect(input).toHaveFocus()
    })

    it('stops suggesting a staple once it is picked', async () => {
      respondWith({ ok: true }, 200, [milk])
      const user = userEvent.setup()
      const onStapleRanOut = vi.fn()
      renderInput({ onStapleRanOut })

      const input = screen.getByRole('combobox')
      await user.type(input, 'mil')
      await user.click(await screen.findByRole('option', { name: /Milk/ }))
      await vi.waitFor(() => expect(onStapleRanOut).toHaveBeenCalledTimes(1))

      await user.type(input, 'mil')

      expect(screen.queryByRole('option', { name: /Milk/ })).not.toBeInTheDocument()
    })

    it('moves with the arrow keys and picks the active staple on Enter', async () => {
      const fetchMock = respondWith({ ok: true }, 200, [milk, oliveOil])
      const user = userEvent.setup()
      const onStapleRanOut = vi.fn()
      renderInput({ onStapleRanOut })

      const input = screen.getByRole('combobox')
      // "l" is in both names.
      await user.type(input, 'l')
      await screen.findByRole('listbox')
      expect(input).not.toHaveAttribute('aria-activedescendant')

      await user.keyboard('{ArrowDown}{ArrowDown}')
      const active = screen.getByRole('option', { name: /Olive oil/ })
      expect(input).toHaveAttribute('aria-activedescendant', active.id)
      expect(active).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{ArrowUp}')
      expect(screen.getByRole('option', { name: /Milk/ })).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{Enter}')

      await vi.waitFor(() => expect(onStapleRanOut).toHaveBeenCalledWith('pantry-milk'))
      expect(writes(fetchMock)).toEqual([['/api/pantry/pantry-milk', 'PATCH', { quantity: 0 }]])
    })

    it('closes the list on Escape, and a plain Enter then sends the name', async () => {
      const fetchMock = respondWith(
        { status: 'staple_ran_out', pantryItemId: 'pantry-milk', ingredientName: 'Milk' },
        200,
        [milk],
      )
      const user = userEvent.setup()
      renderInput()

      await user.type(screen.getByRole('combobox'), 'milk')
      await screen.findByRole('listbox')
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')

      await user.keyboard('{Enter}')

      await vi.waitFor(() =>
        expect(writes(fetchMock)).toEqual([
          ['/api/shopping-list/custom', 'POST', { name: 'milk' }],
        ]),
      )
    })

    it('says the staple is ran out when the server matched the typed name', async () => {
      respondWith(
        { status: 'staple_ran_out', pantryItemId: 'pantry-milk', ingredientName: 'Milk' },
        200,
      )
      const user = userEvent.setup()
      const onItemAdded = vi.fn()
      const onStapleRanOut = vi.fn()
      renderInput({ onItemAdded, onStapleRanOut })

      const input = screen.getByRole('combobox')
      await user.type(input, 'milk{Enter}')

      await vi.waitFor(() => expect(onStapleRanOut).toHaveBeenCalledWith('pantry-milk'))
      expect(toast.success).toHaveBeenCalledWith('Milk marked as ran out')
      expect(onItemAdded).not.toHaveBeenCalled()
      expect(input).toHaveValue('')
    })

    it('toasts the translated failure when marking the staple fails', async () => {
      respondWith({ error: 'Failed to update pantry item' }, 500, [milk])
      const user = userEvent.setup()
      const onStapleRanOut = vi.fn()
      renderInput({ onStapleRanOut })

      await user.type(screen.getByRole('combobox'), 'mil')
      await user.click(await screen.findByRole('option', { name: /Milk/ }))

      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Couldn't mark the staple as ran out"),
      )
      expect(onStapleRanOut).not.toHaveBeenCalled()
    })
  })
})
