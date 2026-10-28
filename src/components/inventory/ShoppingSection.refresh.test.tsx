import { afterEach, describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShoppingSection } from './ShoppingSection'
import { defaultProps, makeGroup, makeItem, renderSection } from './ShoppingSection.fixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/shopping',
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// A pantry change re-reads the list (`router.refresh()`), and the server
// leaves a bought item out of it. The household's ticks outlive the re-read,
// so the list must not count a tick it no longer shows, and must keep the
// ticked row so it can be unticked (HON-1439).
describe('ShoppingSection after the list is re-read', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const milk = makeItem('Milk', 'milk')
  const eggs = makeItem('Eggs', 'eggs')
  const withMilk = () => [
    makeGroup('dairy', 'Dairy', [milk]),
    makeGroup('protein', 'Protein', [eggs]),
  ]
  // The server's answer once Milk is bought: Milk is gone.
  const withoutMilk = () => [makeGroup('protein', 'Protein', [eggs])]

  function stubPurchaseApi() {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        Response.json(
          url.endsWith('/unpurchase') ? { success: true, action: 'deleted' } : { results: [{}] },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function tickMilkThenReRead() {
    const fetchMock = stubPurchaseApi()
    const user = userEvent.setup()
    const view = renderSection({ groups: withMilk() })
    await user.click(screen.getByRole('checkbox', { name: 'Mark Milk as purchased' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    view.rerender(<ShoppingSection {...defaultProps} groups={withoutMilk()} />)
    return { fetchMock, user, view }
  }

  it('counts only the rows on screen and does not say everything is bought', async () => {
    await tickMilkThenReRead()

    expect(screen.getByText(/^2 items/)).toBeInTheDocument()
    expect(screen.getByText('· 1 purchased')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mark Eggs as purchased' })).not.toBeChecked()
    expect(screen.queryByText("You've bought everything on your list.")).not.toBeInTheDocument()
  })

  it('keeps the ticked row, which the household can untick', async () => {
    const { fetchMock, user } = await tickMilkThenReRead()

    const milkBox = screen.getByRole('checkbox', { name: 'Mark Milk as not purchased' })
    expect(milkBox).toBeChecked()

    await user.click(milkBox)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/shopping-list/unpurchase',
      expect.objectContaining({ method: 'POST', body: '{"ingredientId":"milk"}' }),
    )
    // The untick does not re-read the list, so the row stays, unticked.
    expect(screen.getByRole('checkbox', { name: 'Mark Milk as purchased' })).not.toBeChecked()
    expect(screen.queryByText(/purchased$/)).not.toBeInTheDocument()
  })

  it('drops an unticked kept row at the next re-read', async () => {
    const { user, view } = await tickMilkThenReRead()
    await user.click(screen.getByRole('checkbox', { name: 'Mark Milk as not purchased' }))
    await screen.findByRole('checkbox', { name: 'Mark Milk as purchased' })

    // The server now owns Milk again; a list without it means Milk is not needed.
    view.rerender(<ShoppingSection {...defaultProps} groups={withoutMilk()} />)

    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })

  // A listed item is never bought (`load-shopping-list.ts`): a pantry amount
  // below the need, or Ran out, puts Milk back on the list to buy.
  it('shows the server copy of a row, unticked, once the server lists it again', async () => {
    const { view } = await tickMilkThenReRead()

    view.rerender(<ShoppingSection {...defaultProps} groups={withMilk()} />)

    expect(screen.getAllByText('Milk')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Mark Milk as purchased' })).not.toBeChecked()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.queryByText(/purchased$/)).not.toBeInTheDocument()
  })

  // A re-read that lands while the tick is in flight was read before the tick.
  it('keeps a tick still in flight when a re-read lists its row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    const user = userEvent.setup()
    const view = renderSection({ groups: withMilk() })
    await user.click(screen.getByRole('checkbox', { name: 'Mark Milk as purchased' }))

    view.rerender(<ShoppingSection {...defaultProps} groups={withMilk()} />)

    expect(screen.getByRole('checkbox', { name: 'Mark Milk as not purchased' })).toBeChecked()
  })

  it('does not count a tick whose row was never on screen', () => {
    renderSection({ groups: withoutMilk(), initialPurchasedIds: new Set(['milk']) })

    expect(screen.getByText('1 item')).toBeInTheDocument()
    expect(screen.queryByText(/purchased$/)).not.toBeInTheDocument()
  })

  // `/shopping` keys the section on the window (`src/app/shopping/page.tsx`),
  // so a new window starts from the server's list alone.
  it('forgets the kept rows when the section remounts under a new key', async () => {
    const { view } = await tickMilkThenReRead()

    view.rerender(<ShoppingSection key={14} {...defaultProps} groups={withoutMilk()} />)

    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })
})
