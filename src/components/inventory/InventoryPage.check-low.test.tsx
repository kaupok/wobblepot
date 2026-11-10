import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_SHOPPING_DATA, renderPage } from './InventoryPage.fixtures'
import type { StockLabel } from './PantrySection.fixtures'

// The check row and the pantry row carry the same control, so each is read
// inside its column.
const stockIn = (column: 'pantry-column' | 'shopping-column', name: string) =>
  within(screen.getByTestId(column)).getByRole('radiogroup', { name: `Stock: ${name}` })
const pressedIn = (column: 'pantry-column' | 'shopping-column', name: string) =>
  within(stockIn(column, name)).getByRole('radio', { checked: true })
const checkPart = (name: string, label: StockLabel) =>
  within(stockIn('shopping-column', name)).getByRole('radio', { name: label })

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

// The check's stock control writes the pantry row (HON-1638): the pantry
// column shows the new state without a reload, as the server holds it. Ran out
// clears running low (HON-1586).
describe('InventoryPage check and running low', () => {
  it('shows each part the check presses in the pantry column', async () => {
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
            pantryRows: [{ id: 'pantry-carrot', quantity: null, low: true }],
            isStaple: false,
            stock: 'low',
          },
        ],
      },
    })
    expect(pressedIn('pantry-column', 'Carrot')).toHaveAccessibleName('Low')
    expect(pressedIn('shopping-column', 'Carrot')).toHaveAccessibleName('Low')

    await user.click(checkPart('Carrot', 'Ran out'))
    await waitFor(() =>
      expect(pressedIn('pantry-column', 'Carrot')).toHaveAccessibleName('Ran out'),
    )

    await user.click(checkPart('Carrot', 'Have it'))
    await waitFor(() =>
      expect(pressedIn('pantry-column', 'Carrot')).toHaveAccessibleName('Have it'),
    )

    await user.click(checkPart('Carrot', 'Low'))
    await waitFor(() => expect(pressedIn('pantry-column', 'Carrot')).toHaveAccessibleName('Low'))
  })
})
