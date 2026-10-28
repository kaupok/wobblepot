import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InventoryPage } from './InventoryPage'
import { EMPTY_SHOPPING_DATA, renderPage } from './InventoryPage.fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/shopping',
}))

vi.stubGlobal('fetch', vi.fn())

beforeEach(() => {
  vi.mocked(fetch).mockReset()
  localStorage.clear()
})

// HON-1438: the untick deleted the butter row and the 200 g the household
// entered on it.
describe('InventoryPage tick then untick', () => {
  const butter = { id: 'butter', name: 'Butter', category: 'dairy', defaultUnit: 'g' } as const

  function renderButterList(pantryItems: Parameters<typeof InventoryPage>[0]['pantryItems']) {
    renderPage({
      view: 'shopping',
      windowDays: 7,
      pantryItems,
      shoppingData: {
        ...EMPTY_SHOPPING_DATA,
        groups: [
          {
            category: 'dairy',
            items: [
              {
                ingredientId: 'butter',
                name: 'Butter',
                displayQuantity: '300\u00a0g',
                purchased: false,
                neededByDate: '2026-02-18',
                neededByRelative: 'Wed',
                neededByAbsolute: 'Feb 18',
              },
            ],
          },
        ],
      },
    })
  }

  function purchaseAnswer(replacedQuantity: number | null) {
    return Response.json({
      success: true,
      results: [
        {
          ingredientId: 'butter',
          replacedQuantity,
          pantryItem: {
            id: 'pantry-butter',
            ingredient: butter,
            quantity: null,
            isStaple: false,
            updatedAt: '2026-02-16T00:00:00.000Z',
          },
        },
      ],
    })
  }

  async function tickThenUntick() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: 'Mark Butter as purchased' }))
    const untick = await screen.findByRole('checkbox', { name: 'Mark Butter as not purchased' })
    await user.click(untick)
    await screen.findByRole('checkbox', { name: 'Mark Butter as purchased' })
  }

  function untickBody() {
    const [url, init] = vi.mocked(fetch).mock.calls[1]!
    expect(url).toBe('/api/shopping-list/unpurchase')
    return JSON.parse(init!.body as string)
  }

  it('keeps the pantry row at the amount it had before the tick', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(purchaseAnswer(200))
      .mockResolvedValueOnce(
        Response.json({ success: true, ingredientId: 'butter', action: 'restored' }),
      )
    renderButterList([
      {
        id: 'pantry-butter',
        ingredient: butter,
        quantity: 200,
        isStaple: false,
        updatedAt: '2026-02-10T00:00:00.000Z',
      },
    ])

    await tickThenUntick()

    expect(untickBody()).toEqual({ ingredientId: 'butter', restoreQuantity: 200 })
    const pantryColumn = within(screen.getByTestId('pantry-column'))
    await waitFor(() =>
      expect(
        pantryColumn.getByRole('button', { name: 'Amount: Butter, 200\u00a0g' }),
      ).toBeInTheDocument(),
    )
  })

  it('takes a row that had no amount back out of the pantry, as before', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(purchaseAnswer(null))
      .mockResolvedValueOnce(
        Response.json({ success: true, ingredientId: 'butter', action: 'removed' }),
      )
    renderButterList([])

    await tickThenUntick()

    expect(untickBody()).toEqual({ ingredientId: 'butter' })
    const pantryColumn = within(screen.getByTestId('pantry-column'))
    await waitFor(() => expect(pantryColumn.queryByText('Butter')).not.toBeInTheDocument())
  })

  const butterAt200 = {
    id: 'pantry-butter',
    ingredient: butter,
    quantity: 200,
    isStaple: false,
    updatedAt: '2026-02-10T00:00:00.000Z',
  }

  function lastFetchBody() {
    const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!
    expect(url).toBe('/api/shopping-list/unpurchase')
    return JSON.parse(init!.body as string)
  }

  // A Remove in the pantry column unticks the item without the untick, so the
  // amount the first tick replaced must not reach a later untick.
  it('sends no amount after a tick that replaced none, when the row was removed in between', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(purchaseAnswer(200))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(purchaseAnswer(null))
      .mockResolvedValueOnce(
        Response.json({ success: true, ingredientId: 'butter', action: 'removed' }),
      )
    renderButterList([butterAt200])

    await user.click(screen.getByRole('checkbox', { name: 'Mark Butter as purchased' }))
    await screen.findByRole('checkbox', { name: 'Mark Butter as not purchased' })
    await user.click(screen.getByRole('button', { name: 'Remove Butter' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Butter as purchased' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Butter as not purchased' }))
    await screen.findByRole('checkbox', { name: 'Mark Butter as purchased' })

    expect(lastFetchBody()).toEqual({ ingredientId: 'butter' })
  })

  it('keeps an amount the household entered after the tick', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(purchaseAnswer(200))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({ success: true, ingredientId: 'butter', action: 'has_quantity' }),
      )
    renderButterList([butterAt200])

    await user.click(screen.getByRole('checkbox', { name: 'Mark Butter as purchased' }))
    const pantryColumn = within(screen.getByTestId('pantry-column'))
    await user.click(await pantryColumn.findByRole('button', { name: 'Add amount: Butter' }))
    await user.type(screen.getByRole('textbox', { name: 'How much do you have?' }), '150')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await pantryColumn.findByRole('button', { name: 'Amount: Butter, 150\u00a0g' })

    await user.click(screen.getByRole('checkbox', { name: 'Mark Butter as not purchased' }))
    await screen.findByRole('checkbox', { name: 'Mark Butter as purchased' })

    expect(lastFetchBody()).toEqual({ ingredientId: 'butter', restoreQuantity: 200 })
    expect(
      pantryColumn.getByRole('button', { name: 'Amount: Butter, 150\u00a0g' }),
    ).toBeInTheDocument()
  })
})
