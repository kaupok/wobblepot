import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SORT_STORAGE_KEY } from './shopping-sort'
import type { ShoppingSection } from './ShoppingSection'
import { renderSection } from './ShoppingSection.fixtures'

vi.stubGlobal('fetch', vi.fn())

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// `ShoppingListHeader`'s picker navigates on a window change.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/shopping',
}))

beforeEach(() => {
  localStorage.clear()
})

/**
 * The list sits on one note sheet, the paper of Today's `UrgentShopping`; the
 * title and controls stay on the page above it (HON-1016).
 */
describe('ShoppingSection note sheet', () => {
  it('holds the Add field and every group, and nothing of the header', () => {
    renderSection()

    const sheet = screen.getByTestId('shopping-sheet')
    expect(sheet).toHaveAttribute('data-surface', 'note')
    expect(
      within(sheet).getByRole('textbox', { name: 'Add custom item to shopping list' }),
    ).toBeInTheDocument()
    expect(within(sheet).getByText('Carrot')).toBeInTheDocument()
    expect(within(sheet).getByText('Beef')).toBeInTheDocument()

    expect(within(sheet).queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('3 items')).not.toBeInTheDocument()
  })

  // A bordered group inside the bordered sheet is a card inside a card.
  it.each(['urgency', 'category', 'alphabetical'] as const)(
    'rules the rows in %s mode rather than boxing them',
    (mode) => {
      localStorage.setItem(SORT_STORAGE_KEY, mode)
      renderSection({
        initialCustomItems: [
          {
            id: 'c1',
            name: 'Napkins',
            checked: false,
            ingredientId: null,
            ingredientCategory: null,
            createdAt: '2026-02-16T00:00:00.000Z',
          },
        ],
      })

      const groups = screen
        .getByTestId('shopping-sheet')
        .querySelectorAll('[data-slot="row-group"]')
      expect(groups.length).toBeGreaterThan(0)
      for (const group of groups) {
        expect(group).toHaveAttribute('data-variant', 'ruled')
        expect(group).not.toHaveClass('border')
      }
    },
  )
})

/**
 * An empty list keeps the sheet and its Add field, with one muted line under
 * the field that says why it is empty, so the household can always add an
 * item (HON-1354).
 */
describe('ShoppingSection empty list', () => {
  const addField = () => screen.getByRole('textbox', { name: 'Add custom item to shopping list' })

  afterEach(() => {
    vi.mocked(fetch).mockReset()
  })

  function mockAdd(name: string) {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        item: {
          id: 'c-new',
          name,
          checked: false,
          ingredientId: null,
          ingredient: null,
          createdAt: '2026-02-16T00:00:00.000Z',
        },
      }),
    )
  }

  const emptyCases: {
    state: string
    props: Partial<Parameters<typeof ShoppingSection>[0]>
    line: string
  }[] = [
    {
      state: 'no-plan',
      props: { emptyVariant: 'no-plan', groups: [] },
      line: 'Your shopping list is empty.',
    },
    {
      state: 'nothing-needed',
      props: { emptyVariant: 'nothing-needed', groups: [] },
      line: 'Your pantry has everything you need for the next 7 days.',
    },
    {
      state: 'all-purchased',
      props: { initialPurchasedIds: new Set(['v1', 'v2', 'p1']) },
      line: "You've bought everything on your list.",
    },
  ]

  it.each(emptyCases)(
    '$state: shows the header, the sheet, the Add field and its line',
    ({ props, line }) => {
      renderSection(props)

      expect(screen.getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Time window' })).toBeInTheDocument()
      const sheet = screen.getByTestId('shopping-sheet')
      expect(sheet).toHaveAttribute('data-surface', 'note')
      expect(within(sheet).getByRole('textbox', { name: 'Add custom item to shopping list' })).toBe(
        addField(),
      )
      expect(within(sheet).getByText(line)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Generate plan' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Copy list' })).not.toBeInTheDocument()
    },
  )

  it.each(emptyCases)(
    '$state: an added item replaces the line at once and can be copied',
    async ({ props, line }) => {
      const user = userEvent.setup()
      mockAdd('Napkins')
      renderSection(props)

      await user.type(addField(), 'Napkins{Enter}')

      const sheet = screen.getByTestId('shopping-sheet')
      await waitFor(() => expect(within(sheet).getByText('Napkins')).toBeInTheDocument())
      expect(within(sheet).queryByText(line)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Copy list' })).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledWith(
        '/api/shopping-list/custom',
        expect.objectContaining({ method: 'POST', body: '{"name":"Napkins"}' }),
      )
    },
  )

  // An empty mode wrapper is a flex child too, so it would add a gap under
  // the line: the sheet holds the Add field and the line, nothing else.
  it.each(['urgency', 'category', 'alphabetical'] as const)(
    'puts nothing after the line in %s mode',
    (mode) => {
      localStorage.setItem(SORT_STORAGE_KEY, mode)
      renderSection({ emptyVariant: 'no-plan', groups: [] })

      const line = screen.getByText('Your shopping list is empty.')
      expect(line.nextElementSibling).toBeNull()
    },
  )

  it('names the window the household is looking at in the nothing-needed line', () => {
    renderSection({ emptyVariant: 'nothing-needed', groups: [], windowDays: 14 })

    expect(
      screen.getByText('Your pantry has everything you need for the next 14 days.'),
    ).toBeInTheDocument()
  })

  // The all-purchased line sits beside a live picker, so it must not name a
  // scope the picker may contradict (HON-661).
  it('keeps the all-purchased line window-agnostic at 14 days', () => {
    renderSection({ windowDays: 14, initialPurchasedIds: new Set(['v1', 'v2', 'p1']) })

    const line = screen.getByText("You've bought everything on your list.")
    expect(line.textContent).not.toMatch(/week|14/i)
  })

  it('shows no line while the list has an item left to buy', () => {
    renderSection({ initialPurchasedIds: new Set(['v1', 'v2']) })

    expect(screen.queryByText("You've bought everything on your list.")).not.toBeInTheDocument()
    expect(screen.queryByText('Your shopping list is empty.')).not.toBeInTheDocument()
  })
})
