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
