import { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { PantrySection } from './PantrySection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { makeItem, renderSection } from './PantrySection.fixtures'

// `toast` is callable (the Undo toast) and carries `error` / `success`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

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

// Remove takes the row out at once, and the toast's Undo puts it back
// (HON-1355).
describe('PantrySection remove', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const butter = makeItem({ quantity: 2, isStaple: true })
  const milk = makeItem({
    id: 'pantry-milk',
    ingredient: { id: 'ing-milk', name: 'Milk', category: 'dairy', defaultUnit: 'g' },
  })
  const oats = makeItem({
    id: 'pantry-oats',
    ingredient: { id: 'ing-oats', name: 'Oats', category: 'carb', defaultUnit: 'g' },
  })
  const rice = makeItem({
    id: 'pantry-rice',
    ingredient: { id: 'ing-rice', name: 'Rice', category: 'carb', defaultUnit: 'g' },
  })

  /** DELETE answers 204; POST answers the posted row under a new id. */
  function stubPantryApi({ post = 'ok' }: { post?: 'ok' | 'fail' } = {}) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      if (post === 'fail') {
        return Promise.resolve(Response.json({ error: 'Item already in pantry' }, { status: 409 }))
      }
      const body = JSON.parse(init!.body as string) as {
        ingredientId: string
        quantity: number | null
        isStaple: boolean
      }
      const ingredient = [butter, milk, oats, rice].find(
        (item) => item.ingredient.id === body.ingredientId,
      )!.ingredient
      return Promise.resolve(
        Response.json(
          {
            id: `new-${body.ingredientId}`,
            ingredientId: body.ingredientId,
            ingredient,
            quantity: body.quantity,
            isStaple: body.isStaple,
            updatedAt: '2026-10-28T10:00:00.000Z',
          },
          { status: 201 },
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  /** Holds the list in state, as `InventoryPage` does, so rows leave and return. */
  function renderStateful(
    initial: PantryItemData[],
    callbacks: {
      onPantryItemRemoved?: (ingredientId: string) => void
      onPantryItemRestored?: (ingredientId: string) => void
    } = {},
  ) {
    function Stateful() {
      const [items, setItems] = useState(initial)
      return <PantrySection items={items} onItemsChange={setItems} {...callbacks} />
    }
    const { wrapper } = createQueryWrapper()
    return render(<Stateful />, { wrapper })
  }

  function clickRemove(name: string) {
    const button = screen.getByRole('button', { name: `Remove ${name}` })
    button.focus()
    fireEvent.click(button)
  }

  /** The Undo of the nth Undo toast, clicked as Sonner would call it. */
  function clickUndo(nth = 0) {
    // Only the `currentTarget.blur` part of Sonner's click event is used.
    const [, options] = vi.mocked(toast).mock.calls[nth]! as unknown as [
      string,
      { action: { onClick: (event: { currentTarget: { blur: () => void } }) => void } },
    ]
    const blur = vi.fn()
    act(() => options.action.onClick({ currentTarget: { blur } }))
    return blur
  }

  it('removes the row at once, with no dialog, and toasts Undo for 6 seconds', async () => {
    const fetchMock = stubPantryApi()
    const onPantryItemRemoved = vi.fn()
    renderStateful([butter, milk], { onPantryItemRemoved })

    clickRemove('Butter')

    expect(screen.queryByText('Butter')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-1', { method: 'DELETE' }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Butter removed from pantry', {
        action: { label: 'Undo', onClick: expect.any(Function) },
        duration: 6000,
      }),
    )
    expect(onPantryItemRemoved).toHaveBeenCalledWith('ing-1')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("Undo posts the row's quantity and staple state back and puts it in its place", async () => {
    const fetchMock = stubPantryApi()
    const onPantryItemRestored = vi.fn()
    renderStateful([butter, milk], { onPantryItemRestored })
    clickRemove('Butter')
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))

    const blur = clickUndo()

    expect(blur).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ingredientId":"ing-1","quantity":2,"isStaple":true}',
      }),
    )
    // Back under Staples, above Milk, with its "needed" caption.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 3, name: 'Staples (always stocked) 1' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Butter').closest('.p-3')).toHaveTextContent(
      '50g needed in next 7 days',
    )
    expect(onPantryItemRestored).toHaveBeenCalledWith('ing-1')
    // Focus goes to the restored row's Remove (a new id), not <body>.
    expect(screen.getByRole('button', { name: 'Remove Butter' })).toHaveFocus()
  })

  it('removes three rows in a row, and Undo on the second puts back only the second', async () => {
    const fetchMock = stubPantryApi()
    const onPantryItemRestored = vi.fn()
    renderStateful([milk, oats, rice], { onPantryItemRestored })

    clickRemove('Milk')
    clickRemove('Oats')
    clickRemove('Rice')
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(3))
    expect(vi.mocked(toast).mock.calls.map(([message]) => message)).toEqual([
      'Milk removed from pantry',
      'Oats removed from pantry',
      'Rice removed from pantry',
    ])

    clickUndo(1)

    await waitFor(() => expect(screen.getByText('Oats')).toBeInTheDocument())
    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    expect(screen.queryByText('Rice')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(onPantryItemRestored).toHaveBeenCalledExactlyOnceWith('ing-oats')
  })

  it("focuses the next row's Remove in the group, not <body>", async () => {
    stubPantryApi()
    renderStateful([milk, oats, rice])

    clickRemove('Oats')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Rice' })).toHaveFocus())
  })

  it("focuses the previous row's Remove when the last row in a group goes", async () => {
    stubPantryApi()
    renderStateful([butter, milk, oats])

    clickRemove('Oats')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Milk' })).toHaveFocus())
  })

  it('focuses the add search when the group empties', async () => {
    stubPantryApi()
    renderStateful([butter, milk])

    clickRemove('Butter')

    await waitFor(() => expect(screen.getByLabelText('Add ingredient to pantry')).toHaveFocus())
  })

  it('shows catalog copy, not the server text, when Undo fails, and the row stays out', async () => {
    stubPantryApi({ post: 'fail' })
    const onPantryItemRestored = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderStateful([butter, milk], { onPantryItemRestored })
    clickRemove('Butter')
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))

    clickUndo()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to put the item back'))
    expect(toast.error).not.toHaveBeenCalledWith('Item already in pantry')
    expect(screen.queryByText('Butter')).not.toBeInTheDocument()
    expect(onPantryItemRestored).not.toHaveBeenCalled()
  })

  it('restores the row and toasts catalog copy on an error status, with no Undo', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Pantry item not found' }), { status: 404 }),
        ),
    )
    const onPantryItemRemoved = vi.fn()
    renderStateful([butter, milk], { onPantryItemRemoved })

    clickRemove('Butter')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to remove item'))
    expect(screen.getByText('Butter')).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
    expect(onPantryItemRemoved).not.toHaveBeenCalled()
  })

  it('puts a row whose removal failed back in its sorted place, not at the end (HON-920)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onItemsChange = vi.fn()
    renderSection([makeItem()], onItemsChange)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Butter' }))

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
