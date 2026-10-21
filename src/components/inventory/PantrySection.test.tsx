import { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { PantrySection } from './PantrySection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { PantryItemData } from '@/components/pantry/PantryItem'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function makeItem(overrides: Partial<PantryItemData> = {}): PantryItemData {
  return {
    id: 'pantry-1',
    ingredient: { id: 'ing-1', name: 'Butter', category: 'dairy', defaultUnit: 'g' },
    quantity: null,
    isStaple: false,
    updatedAt: '2026-09-24T10:00:00.000Z',
    neededQuantity: 50,
    neededDisplayQuantity: '50g',
    windowDays: 7,
    ...overrides,
  }
}

function renderSection(items: PantryItemData[], onItemsChange = vi.fn()) {
  const { wrapper } = createQueryWrapper()
  return render(<PantrySection items={items} onItemsChange={onItemsChange} />, { wrapper })
}

describe('PantrySection needed line', () => {
  it('shows the quantity for a numeric need', () => {
    renderSection([makeItem()])

    expect(screen.getByText('50g needed in next 7 days')).toBeInTheDocument()
  })

  // A vague quantity's display is the phrase itself, which read "to taste
  // needed in next 7 days" (HON-783).
  it('drops the phrase for a vague need', () => {
    renderSection([
      makeItem({
        id: 'pantry-2',
        ingredient: { id: 'ing-2', name: 'Black pepper', category: 'spice', defaultUnit: 'g' },
        isStaple: true,
        neededQuantity: 1,
        neededDisplayQuantity: 'to taste',
        isVague: true,
      }),
    ])

    expect(screen.getByText('Needed in next 7 days')).toBeInTheDocument()
    expect(screen.queryByText(/to taste/)).not.toBeInTheDocument()
  })
})

// The column counts every item beside its title, where the shopping list puts
// its own count, and has no subtitle (HON-957).
describe('PantrySection header', () => {
  function titleRow() {
    return screen.getByRole('heading', { level: 2, name: 'Your pantry' }).parentElement!
  }

  it('counts staples and on-hand items together beside the title', () => {
    renderSection([
      makeItem({ id: 'pantry-1', isStaple: true }),
      makeItem({
        id: 'pantry-2',
        ingredient: { id: 'ing-2', name: 'Rice', category: 'carb', defaultUnit: 'g' },
      }),
    ])

    expect(within(titleRow()).getByText('2 items')).toBeInTheDocument()
    expect(screen.queryByText('Manage your household inventory')).not.toBeInTheDocument()
  })

  it('shows "No items" beside the title of an empty pantry, above the empty copy', () => {
    renderSection([])

    expect(within(titleRow()).getByText('No items')).toBeInTheDocument()
    expect(screen.getByText(/your pantry is empty/i)).toBeInTheDocument()
  })

  it('shows no count when the pantry failed to load', () => {
    const { wrapper } = createQueryWrapper()
    render(<PantrySection items={[]} onItemsChange={vi.fn()} loadFailed />, { wrapper })

    expect(titleRow()).toHaveTextContent(/^Your pantry$/)
    expect(screen.queryByText('No items')).not.toBeInTheDocument()
  })
})

// Each group counts its rows in a number after the label, not as "N items" at
// the right end (HON-954).
describe('PantrySection group headings', () => {
  it('counts each group in a number inside the heading', () => {
    renderSection([
      makeItem({ id: 'pantry-1', isStaple: true }),
      makeItem({
        id: 'pantry-2',
        ingredient: { id: 'ing-2', name: 'Salt', category: 'spice', defaultUnit: 'g' },
        isStaple: true,
      }),
      makeItem({
        id: 'pantry-3',
        ingredient: { id: 'ing-3', name: 'Rice', category: 'carb', defaultUnit: 'g' },
      }),
    ])

    expect(
      screen.getByRole('heading', { level: 3, name: 'Staples (always stocked) 2' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'On hand 1' })).toBeInTheDocument()
    // The one "N items" left is the column count beside the title (HON-957).
    expect(screen.getAllByText(/\d+ items?$/)).toEqual([screen.getByText('3 items')])
    expect(screen.getByText('3 items').parentElement).toContainElement(
      screen.getByRole('heading', { level: 2, name: 'Your pantry' }),
    )
  })
})

describe('PantrySection remove', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function confirmRemove() {
    fireEvent.click(screen.getByRole('button', { name: 'Remove Butter' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
  }

  // The route answers 204 with no body, which `apiFetch` resolves to
  // `undefined` rather than failing to parse (HON-793).
  it('treats the bodiless 204 as a success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    renderSection([makeItem()])

    await confirmRemove()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Item removed from pantry'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-1', { method: 'DELETE' })
  })

  it('restores the row and toasts on an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Pantry item not found' }), { status: 404 }),
        ),
    )
    const onItemsChange = vi.fn()
    renderSection([makeItem()], onItemsChange)

    await confirmRemove()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to remove item'))
    // Once to drop the row optimistically, once to put it back.
    expect(onItemsChange).toHaveBeenCalledTimes(2)
  })

  it('puts a restored row back in its sorted place, not at the end (HON-920)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onItemsChange = vi.fn()
    renderSection([makeItem()], onItemsChange)

    await confirmRemove()

    await waitFor(() => expect(onItemsChange).toHaveBeenCalledTimes(2))
    const restore = onItemsChange.mock.calls[1]![0] as (prev: PantryItemData[]) => PantryItemData[]
    const others = [
      makeItem({ id: 'p-a', ingredient: { ...makeItem().ingredient, id: 'a', name: 'Apple' } }),
      makeItem({ id: 'p-c', ingredient: { ...makeItem().ingredient, id: 'c', name: 'Carrot' } }),
    ]
    expect(restore(others).map((item) => item.ingredient.name)).toEqual([
      'Apple',
      'Butter',
      'Carrot',
    ])
  })
})

// A row at 0 has run out (HON-1288): it leaves On hand for its own group, with
// a "Have it" that sets the quantity back to null, "have some".
describe('PantrySection ran out', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const avocado = makeItem({
    id: 'pantry-avocado',
    ingredient: { id: 'ing-avocado', name: 'Avocado', category: 'fruit', defaultUnit: 'piece' },
    quantity: 0,
  })
  const lime = makeItem({
    id: 'pantry-lime',
    ingredient: { id: 'ing-lime', name: 'Lime', category: 'fruit', defaultUnit: 'piece' },
    quantity: 0,
  })
  const bread = makeItem({
    id: 'pantry-bread',
    ingredient: { id: 'ing-bread', name: 'Bread', category: 'carb', defaultUnit: 'piece' },
    quantity: null,
  })
  const salt = makeItem({
    id: 'pantry-salt',
    ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
    quantity: 0,
    isStaple: true,
  })

  /** The group a row's name sits in, read from the heading over its `RowGroup`. */
  function groupOf(name: string) {
    const group = screen.getByText(name).closest('.flex-col.gap-2')
    return group?.querySelector('h3')?.textContent
  }

  /** Holds the list in state, as `InventoryPage` does, so a row can move. */
  function StatefulSectionWithRefresh({
    initial,
    onPantryQuantityChanged,
  }: {
    initial: PantryItemData[]
    onPantryQuantityChanged?: () => void
  }) {
    const [items, setItems] = useState(initial)
    return (
      <PantrySection
        items={items}
        onItemsChange={setItems}
        onPantryQuantityChanged={onPantryQuantityChanged}
      />
    )
  }

  function renderStateful(items: PantryItemData[], onPantryQuantityChanged = vi.fn()) {
    const { wrapper } = createQueryWrapper()
    return render(
      <StatefulSectionWithRefresh
        initial={items}
        onPantryQuantityChanged={onPantryQuantityChanged}
      />,
      { wrapper },
    )
  }

  it('puts a non-staple row at 0 under Ran out, and a staple at 0 under Staples', () => {
    renderSection([salt, bread, avocado])

    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(groupOf('Bread')).toBe('On hand 1')
    expect(groupOf('Salt')).toBe('Staples (always stocked) 1')
    expect(screen.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'On hand 1' })).toBeInTheDocument()
    // The title still counts every row.
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })

  it('renders no Ran out heading when no row is at 0', () => {
    renderSection([bread, makeItem({ quantity: 2 })])

    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Have it/ })).not.toBeInTheDocument()
  })

  it('offers "Have it" only on a ran-out row', () => {
    renderSection([salt, bread, avocado])

    expect(screen.getAllByRole('button', { name: /^Have it/ })).toEqual([
      screen.getByRole('button', { name: 'Have it: Avocado' }),
    ])
  })

  it('sends quantity null and moves the row to On hand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(screen.getByRole('button', { name: 'Have it: Avocado' }))

    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 2'))
    // The shopping list beside it re-reads, because a null row is not bought.
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-avocado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":null}',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('puts the row back under Ran out and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(screen.getByRole('button', { name: 'Have it: Avocado' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(screen.getByRole('button', { name: 'Have it: Avocado' })).toBeInTheDocument()
  })

  it('focuses the next ran-out row\'s "Have it", not <body>', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([bread, avocado, lime])
    const haveIt = screen.getByRole('button', { name: 'Have it: Avocado' })
    haveIt.focus()

    fireEvent.click(haveIt)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Have it: Lime' })).toHaveFocus())
    expect(document.body).not.toHaveFocus()
  })

  it("focuses the moved row's star once Ran out is empty", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([avocado])
    const haveIt = screen.getByRole('button', { name: 'Have it: Avocado' })
    haveIt.focus()

    fireEvent.click(haveIt)

    // jsdom, like a browser, moves focus to <body> when the focused button
    // unmounts with its row, so this fails without the refocus.
    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 1'))
    const star = within(screen.getByText('Avocado').closest('.p-3') as HTMLElement).getByRole(
      'button',
      { name: 'Mark as staple' },
    )
    expect(star).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})
