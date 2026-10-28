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
  // A test that fails before its request leaves the queued response for the next.
  vi.mocked(fetch).mockReset()
  mockPathname = '/shopping'
  localStorage.clear()
  routerPush.mockClear()
  routerReplace.mockClear()
  routerRefresh.mockClear()
})

/** What `loadInventory` hands over for a list with nothing on it. */
const EMPTY_SHOPPING_DATA = {
  windowDays: 7,
  startDate: '2026-02-16',
  endDate: '2026-02-23',
  groups: [],
  initialPurchasedIds: new Set<string>(),
  customItems: [],
}

function renderPage(overrides: Partial<Parameters<typeof InventoryPage>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(
    <InventoryPage
      view="shopping"
      pantryItems={[]}
      shoppingData={EMPTY_SHOPPING_DATA}
      {...overrides}
    />,
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

  it('applies it on `no-plan` as well', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'no-plan', windowDays: 7 })

    expect(routerReplace).toHaveBeenCalledWith('/shopping?days=14')
  })

  // `error` renders no header and so no picker. It still has to honour the
  // saved window, so the list opens at the chosen window once it loads.
  it('applies it on `error`, which has no picker to recover with', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')

    renderPage({ emptyStateVariant: 'error', shoppingData: null, windowDays: 7 })

    expect(screen.queryByRole('combobox', { name: 'Time window' })).not.toBeInTheDocument()

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

  // The page stays neutral edge to edge: no layer paints the viewport and
  // neither column is a surface. The note is one sheet inside the shopping
  // column (HON-1016), on an empty list too (HON-1354).
  it.each(['shopping', 'pantry'] as const)(
    'view="%s" puts the list, and only the list, on one note sheet',
    (view) => {
      const { container } = renderPage({
        view,
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
                  ingredientId: 'v1',
                  name: 'Carrot',
                  displayQuantity: '2',
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

      expect(screen.getByTestId('shopping-column')).not.toHaveAttribute('data-surface')
      expect(screen.getByTestId('pantry-column')).not.toHaveAttribute('data-surface')

      const surfaces = container.querySelectorAll('[data-surface]')
      expect(surfaces).toHaveLength(1)
      expect(surfaces[0]).toBe(screen.getByTestId('shopping-sheet'))
      expect(within(screen.getByTestId('shopping-column')).getByTestId('shopping-sheet')).toBe(
        surfaces[0],
      )
    },
  )

  // An empty list keeps the sheet and its Add field, so the household can
  // always add an item; the plan is generated on Today, not here (HON-1354).
  it.each([
    ['no-plan', 'Your shopping list is empty.'],
    ['nothing-needed', 'Your pantry has everything you need for the next 7 days.'],
  ] as const)('renders the %s state on the sheet with its Add field', (emptyStateVariant, line) => {
    renderPage({ emptyStateVariant, windowDays: 7 })

    const column = within(screen.getByTestId('shopping-column'))
    expect(column.getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument()
    expect(column.getByRole('combobox', { name: 'Time window' })).toBeInTheDocument()
    const sheet = within(column.getByTestId('shopping-sheet'))
    expect(sheet.getByRole('textbox', { name: 'Add custom item to shopping list' })).toBeVisible()
    expect(sheet.getByText(line)).toBeInTheDocument()
    expect(screen.queryByText('No meal plan yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Generate plan' })).not.toBeInTheDocument()
  })

  it('adds an item from the no-plan state without a reload', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        item: {
          id: 'c-new',
          name: 'Coffee',
          checked: false,
          ingredientId: null,
          ingredient: null,
          createdAt: '2026-02-16T00:00:00.000Z',
        },
      }),
    )
    renderPage({ emptyStateVariant: 'no-plan', windowDays: 7 })

    await user.type(
      screen.getByRole('textbox', { name: 'Add custom item to shopping list' }),
      'Coffee{Enter}',
    )

    const sheet = within(screen.getByTestId('shopping-sheet'))
    await waitFor(() => expect(sheet.getByText('Coffee')).toBeInTheDocument())
    expect(sheet.queryByText('Your shopping list is empty.')).not.toBeInTheDocument()
    expect(routerRefresh).not.toHaveBeenCalled()
  })

  // A failed load has no list to put on paper, so it renders on the page
  // background with its error and no Add field.
  it('renders the load-failed state with no sheet', () => {
    const { container } = renderPage({
      emptyStateVariant: 'error',
      shoppingData: null,
      windowDays: 7,
    })

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(container.querySelector('[data-surface]')).toBeNull()
    expect(
      screen.queryByRole('textbox', { name: 'Add custom item to shopping list' }),
    ).not.toBeInTheDocument()
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
  // The list shows the onion in pieces, but the pantry screen stays in grams,
  // so the bought row's caption takes the gram string, as a reload would
  // (HON-1312).
  it('captions an item bought as pieces in grams in the pantry column', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        success: true,
        results: [
          {
            pantryItem: {
              id: 'pantry-onion',
              ingredient: { id: 'onion', name: 'Onion', category: 'vegetable', defaultUnit: 'g' },
              quantity: null,
              isStaple: false,
              updatedAt: '2026-02-16T00:00:00.000Z',
            },
          },
        ],
      }),
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
                ingredientId: 'onion',
                name: 'Onion',
                displayQuantity: '1\u00a0pc',
                pantryDisplayQuantity: '83g',
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

    await user.click(screen.getByRole('checkbox', { name: 'Mark Onion as purchased' }))

    const pantryColumn = within(screen.getByTestId('pantry-column'))
    await waitFor(() =>
      expect(pantryColumn.getByText('83g needed in next 7 days')).toBeInTheDocument(),
    )
  })

  // A ran-out row is on the list for the full amount and a null row is not,
  // so "Have it" re-reads the list beside the pantry (HON-1288).
  it('refreshes the shopping list after "Have it" on a ran-out row', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }))

    renderPage({
      view: 'pantry',
      pantryItems: [
        {
          id: 'pantry-avocado',
          ingredient: { id: 'avocado', name: 'Avocado', category: 'fruit', defaultUnit: 'piece' },
          quantity: 0,
          isStaple: false,
          updatedAt: '2026-10-21T00:00:00.000Z',
        },
      ],
      emptyStateVariant: 'nothing-needed',
      windowDays: 7,
    })

    await user.click(screen.getByRole('button', { name: 'Have it: Avocado' }))

    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledWith(
      '/api/pantry/pantry-avocado',
      expect.objectContaining({ method: 'PATCH', body: '{"quantity":null}' }),
    )
  })
})
