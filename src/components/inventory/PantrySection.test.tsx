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
})
