import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InventoryPage } from './InventoryPage'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'
import { createQueryWrapper } from '@/test/query-wrapper'

const routerPush = vi.fn()
const routerReplace = vi.fn()
const routerRefresh = vi.fn()

// A stable router object, not a fresh one per call: `useWindowReconcile` keys
// its effect on the router identity.
let mockPathname = '/shopping'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: routerRefresh }),
  usePathname: () => mockPathname,
}))

vi.stubGlobal('fetch', vi.fn())

beforeEach(() => {
  mockPathname = '/shopping'
  localStorage.clear()
  routerPush.mockClear()
  routerReplace.mockClear()
  routerRefresh.mockClear()
})

function renderPage(overrides: Partial<Parameters<typeof InventoryPage>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(
    <InventoryPage view="shopping" pantryItems={[]} shoppingData={null} {...overrides} />,
    { wrapper },
  )
}

/**
 * The window reconcile lives here rather than in `ShoppingListHeader` because
 * this is the one component on every `/shopping` visit that renders exactly
 * once. That placement is what these tests pin: the header-less states get the
 * reconcile too, and it can never fire twice.
 */
describe('InventoryPage window reconcile', () => {
  it('applies a stored 14-day preference over a 7-day render', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('applies it on the populated list too — the regression HON-624 closes', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({
      windowDays: 7,
      shoppingData: {
        windowDays: 7,
        startDate: '2026-02-16',
        endDate: '2026-02-23',
        groups: [],
        initialPurchasedIds: new Set<string>(),
      },
    })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  // `no-plan` renders no header and so no picker, which the AC requires. It
  // still has to honour the saved window, so the next page the user reaches
  // after generating a plan opens at the window they chose.
  it('applies it on `no-plan`, which has no picker to recover with', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'no-plan', windowDays: 7 })

    expect(screen.queryByRole('combobox', { name: 'Time window' })).not.toBeInTheDocument()
    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('applies it on `error` as well', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'error', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  it('fires once, not once per rendered header', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledTimes(1)
  })

  it('leaves the URL alone when the stored window already matches', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '7')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7 })

    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('leaves the URL alone when there is no stored preference', () => {
    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 14 })

    expect(routerReplace).not.toHaveBeenCalled()
  })

  // An explicit `?days=` is the user's immediate intent. Overriding it makes
  // Back a no-op right after using the picker, and a shared 14-day link
  // unopenable for anyone who has ever chosen 7 days.
  it('leaves an explicit URL alone even when the stored window disagrees', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'nothing-needed', windowDays: 7, windowDaysFromUrl: true })

    expect(routerReplace).not.toHaveBeenCalled()
  })
})

/**
 * `/shopping` and `/pantry` render this same component (HON-776). Below `md`
 * a phone sees only the half its route names; from `md` up both columns show.
 * The split is breakpoint classes, not JS viewport detection, so it is pinned
 * on the class rather than on layout jsdom cannot compute.
 */
describe('InventoryPage view', () => {
  it.each([
    ['shopping', 'pantry-column', 'shopping-column'],
    ['pantry', 'shopping-column', 'pantry-column'],
  ] as const)(
    'view="%s" hides %s below md and leaves %s visible',
    (view, hiddenTestId, shownTestId) => {
      renderPage({ view, emptyStateVariant: 'nothing-needed', windowDays: 7 })

      expect(screen.getByTestId(hiddenTestId)).toHaveClass('hidden', 'md:block')
      expect(screen.getByTestId(shownTestId)).not.toHaveClass('hidden')
    },
  )

  // The list half is the shopping note's paper; the pantry half stays neutral (HON-1012).
  it.each(['shopping', 'pantry'] as const)(
    'view="%s" puts the shopping column, and only it, on the note surface',
    (view) => {
      renderPage({ view, emptyStateVariant: 'nothing-needed', windowDays: 7 })

      expect(screen.getByTestId('shopping-column')).toHaveAttribute('data-surface', 'note')
      expect(screen.getByTestId('pantry-column')).not.toHaveAttribute('data-surface')
    },
  )

  // The paper runs to the viewport's edges, so it is a fixed layer behind the
  // page: the right half from `md`, the whole screen on a phone on `/shopping`
  // and none of it on a phone on `/pantry`.
  it.each([
    ['shopping', ['left-0'], ['hidden']],
    ['pantry', ['hidden', 'md:block'], ['left-0']],
  ] as const)('view="%s" lays the paper behind the list half', (view, has, hasNot) => {
    renderPage({ view, emptyStateVariant: 'nothing-needed', windowDays: 7 })

    const paper = screen.getByTestId('shopping-paper')
    expect(paper).toHaveAttribute('data-surface', 'note')
    expect(paper).toHaveAttribute('aria-hidden', 'true')
    expect(paper).toHaveClass('fixed', 'inset-y-0', 'right-0', '-z-10', 'md:left-1/2', ...has)
    for (const cls of hasNot) expect(paper).not.toHaveClass(cls)
  })

  // One h1 per page, ahead of the column h2s, visually hidden (HON-815).
  it.each(['shopping', 'pantry'] as const)(
    'view="%s" opens its outline with one hidden h1',
    (view) => {
      const { container } = renderPage({ view, emptyStateVariant: 'nothing-needed', windowDays: 7 })

      const h1s = container.querySelectorAll('h1')
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).toHaveTextContent('Pantry & shopping')
      expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBe(h1s[0])
      expect(container.querySelectorAll('h2').length).toBeGreaterThan(0)
      expect(h1s[0]?.parentElement).toHaveClass('sr-only')
    },
  )

  it('renders the pantry as a plain section, with no collapse trigger', () => {
    renderPage({ view: 'pantry', emptyStateVariant: 'nothing-needed', windowDays: 7 })

    const title = screen.getByRole('heading', { name: 'Your pantry' })
    expect(screen.queryByRole('button', { name: /your pantry/i })).not.toBeInTheDocument()
    // The count on the title's baseline, as the shopping list has (HON-957).
    expect(title.parentElement).toHaveTextContent('Your pantryNo items')
  })

  it('shows a failed pantry load as an error, not as an empty pantry', () => {
    renderPage({
      view: 'pantry',
      pantryLoadFailed: true,
      emptyStateVariant: 'nothing-needed',
      windowDays: 7,
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load your pantry/i)
    expect(screen.queryByText(/your pantry is empty/i)).not.toBeInTheDocument()
  })

  it('moves an item bought on the list into the pantry column without a reload', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              pantryItem: {
                id: 'pantry-garlic',
                ingredient: {
                  id: 'garlic',
                  name: 'Garlic',
                  category: 'vegetable',
                  defaultUnit: 'piece',
                },
                quantity: null,
                isStaple: false,
                updatedAt: '2026-02-16T00:00:00.000Z',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    renderPage({
      view: 'shopping',
      windowDays: 7,
      shoppingData: {
        windowDays: 7,
        startDate: '2026-02-16',
        endDate: '2026-02-23',
        groups: [
          {
            category: 'vegetable',
            items: [
              {
                ingredientId: 'garlic',
                name: 'Garlic',
                displayQuantity: '2\u00a0pc',
                purchased: false,
                neededByDate: '2026-02-18',
                neededByRelative: 'Wed',
                neededByAbsolute: 'Feb 18',
              },
            ],
          },
        ],
        initialPurchasedIds: new Set<string>(),
      },
    })

    const pantryColumn = within(screen.getByTestId('pantry-column'))
    expect(pantryColumn.queryByText('Garlic')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Mark Garlic as purchased' }))

    await waitFor(() => expect(pantryColumn.getByText('Garlic')).toBeInTheDocument())
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})
