import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_SHOPPING_DATA, renderPage } from './InventoryPage.fixtures'
import { pressedStock, stockPart } from './PantrySection.fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/shopping',
}))

vi.stubGlobal('fetch', vi.fn())

beforeEach(() => {
  vi.mocked(fetch).mockReset()
  vi.mocked(fetch).mockImplementation(async () => Response.json({}))
  localStorage.clear()
})

// The check's Add to list sets the row to 0, ran out, which replaces running
// low (HON-1586): the pantry column clears low as the server does (HON-1587).
describe('InventoryPage check and running low', () => {
  it('clears low on a row the check sets to 0', async () => {
    const user = userEvent.setup()
    renderPage({
      view: 'shopping',
      windowDays: 7,
      pantryItems: [
        {
          id: 'pantry-carrot',
          ingredient: { id: 'ing-carrot', name: 'Carrot', category: 'vegetable', defaultUnit: 'g' },
          quantity: null,
          isStaple: false,
          low: true,
          updatedAt: '2026-02-16T00:00:00.000Z',
        },
      ],
      shoppingData: {
        ...EMPTY_SHOPPING_DATA,
        check: [
          {
            ingredientId: 'ing-carrot',
            name: 'Carrot',
            displayQuantity: '~20 pcs',
            mealCount: 4,
            neededByDate: '2026-02-18',
            neededByRelative: 'Wed',
            pantryRows: [{ id: 'pantry-carrot', quantity: null }],
            isStaple: false,
          },
        ],
      },
    })
    expect(pressedStock('Carrot')).toHaveAccessibleName('Low')

    await user.click(screen.getByRole('button', { name: 'Add to list: Carrot' }))
    await waitFor(() => expect(pressedStock('Carrot')).toHaveAccessibleName('Ran out'))
    expect(stockPart('Carrot', 'Low')).toHaveAttribute('aria-checked', 'false')

    await user.click(stockPart('Carrot', 'Have it'))
    await waitFor(() => expect(pressedStock('Carrot')).toHaveAccessibleName('Have it'))
    expect(stockPart('Carrot', 'Low')).toHaveAttribute('aria-checked', 'false')
  })
})
