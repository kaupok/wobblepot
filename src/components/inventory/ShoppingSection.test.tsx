import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { ShoppingSection } from './ShoppingSection'
import { createQueryWrapper } from '@/test/query-wrapper'
import { track } from '@/lib/analytics'
import { formatDateRange } from '@/lib/i18n/format-dates'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import type { IngredientCategory } from '@/generated/prisma/enums'

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn())

// Mock sonner toast
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// Mock date utility used in urgency mode. `parseLocalDate` is kept real — the
// clipboard header formats the window's date range through it.
vi.mock('@/lib/meal-planning/dates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meal-planning/dates')>(
    '@/lib/meal-planning/dates',
  )
  return { ...actual, getUrgencyBucket: () => 'this-week' as const }
})

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// Mock pointer capture APIs required by Radix UI Select in jsdom
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

function makeItem(
  name: string,
  ingredientId: string,
  purchased = false,
): {
  ingredientId: string
  name: string
  displayQuantity: string
  purchased: boolean
  neededByDate: string
  neededByRelative: string
  neededByAbsolute: string
} {
  return {
    ingredientId,
    name,
    displayQuantity: '100 g',
    purchased,
    neededByDate: '2026-02-18',
    neededByRelative: 'Wed',
    neededByAbsolute: 'Feb 18',
  }
}

function makeGroup(
  category: IngredientCategory,
  label: string,
  items: ReturnType<typeof makeItem>[],
): { category: IngredientCategory; categoryLabel: string; items: ReturnType<typeof makeItem>[] } {
  return { category, categoryLabel: label, items }
}

const defaultProps = {
  windowDays: 7,
  startDate: '2026-02-16',
  endDate: '2026-02-23',
  groups: [
    makeGroup('vegetable', 'Vegetable', [makeItem('Carrot', 'v1'), makeItem('Asparagus', 'v2')]),
    makeGroup('protein', 'Protein', [makeItem('Beef', 'p1')]),
  ],
  initialPurchasedIds: new Set<string>(),
}

function renderSection(overrides: Partial<Parameters<typeof ShoppingSection>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<ShoppingSection {...defaultProps} {...overrides} />, { wrapper })
}

beforeEach(() => {
  localStorage.clear()
})

describe('ShoppingSection alphabetical sort', () => {
  it('shows the alphabetical option in the sort dropdown', async () => {
    const user = userEvent.setup()
    renderSection()

    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)

    expect(screen.getByRole('option', { name: 'Alphabetical' })).toBeInTheDocument()
  })

  it('renders items in alphabetical order when alphabetical mode is selected', async () => {
    const user = userEvent.setup()
    renderSection()

    // Switch to alphabetical mode
    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }))

    const checkboxes = screen.getAllByRole('checkbox')
    // Items should be: Asparagus, Beef, Carrot (A-Z)
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[0]).toHaveAccessibleName('Mark Asparagus as purchased')
    expect(checkboxes[1]).toHaveAccessibleName('Mark Beef as purchased')
    expect(checkboxes[2]).toHaveAccessibleName('Mark Carrot as purchased')
  })

  it('sorts purchased items to the bottom in alphabetical mode', async () => {
    const user = userEvent.setup()
    renderSection({
      groups: [
        makeGroup('vegetable', 'Vegetable', [
          makeItem('Carrot', 'v1'),
          makeItem('Asparagus', 'v2'),
        ]),
        makeGroup('protein', 'Protein', [makeItem('Beef', 'p1', true)]),
      ],
      initialPurchasedIds: new Set(['p1']),
    })

    // Switch to alphabetical mode
    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }))

    const checkboxes = screen.getAllByRole('checkbox')
    // Unpurchased first (A-Z): Asparagus, Carrot; then purchased: Beef
    expect(checkboxes[0]).toHaveAccessibleName('Mark Asparagus as purchased')
    expect(checkboxes[1]).toHaveAccessibleName('Mark Carrot as purchased')
    expect(checkboxes[2]).toHaveAccessibleName('Mark Beef as not purchased')
  })

  it('interleaves custom items alphabetically with computed items', async () => {
    const user = userEvent.setup()
    const customItems = [
      {
        id: 'c1',
        name: 'Bananas',
        checked: false,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-02-16T10:00:00Z',
      },
    ]

    renderSection({ initialCustomItems: customItems })

    // Switch to alphabetical mode
    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }))

    const checkboxes = screen.getAllByRole('checkbox')
    // A-Z: Asparagus, Bananas, Beef, Carrot
    expect(checkboxes).toHaveLength(4)
    expect(checkboxes[0]).toHaveAccessibleName('Mark Asparagus as purchased')
    expect(checkboxes[1]).toHaveAccessibleName('Mark Bananas as purchased')
    expect(checkboxes[2]).toHaveAccessibleName('Mark Beef as purchased')
    expect(checkboxes[3]).toHaveAccessibleName('Mark Carrot as purchased')
  })

  it('persists alphabetical sort mode to localStorage', async () => {
    const user = userEvent.setup()
    renderSection()

    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }))

    expect(localStorage.getItem('shopping-list-sort-mode')).toBe('alphabetical')
  })

  it('restores alphabetical sort mode from localStorage', () => {
    localStorage.setItem('shopping-list-sort-mode', 'alphabetical')
    renderSection()

    // In alphabetical mode, there should be no category headers
    expect(screen.queryByText(/Vegetable/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Protein/)).not.toBeInTheDocument()
  })

  it('does not show category headers in alphabetical mode', async () => {
    const user = userEvent.setup()
    renderSection()

    // Initially in category mode - headers should be visible
    expect(screen.getByText(/Vegetable/)).toBeInTheDocument()

    // Switch to alphabetical
    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Alphabetical' }))

    // Category headers should not be visible
    expect(screen.queryByText(/Vegetable \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Protein \(/)).not.toBeInTheDocument()
  })

  it('defaults to category sort mode', () => {
    renderSection()

    const trigger = screen.getByRole('combobox', { name: 'Sort items' })
    expect(trigger).toHaveTextContent('By category')
  })
})

describe('ShoppingSection copy to clipboard', () => {
  // The exact rendering of a date range is `formatDateRange`'s contract (and is
  // covered by its own tests, and by ICU); what matters here is that the header
  // is built from the window's real dates, the active locale, and `withYear`.
  const expectedHeading = `Shopping list · ${formatDateRange(
    parseLocalDate(defaultProps.startDate),
    parseLocalDate(defaultProps.endDate),
    'en',
    { withYear: true },
  )}`

  function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    return writeText
  }

  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(track).mockClear()
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('hides the button when there is nothing left to copy', () => {
    renderSection({ groups: [], initialCustomItems: [] })

    expect(screen.queryByRole('button', { name: /copy list/i })).not.toBeInTheDocument()
  })

  it('copies the category-mode list, excluding purchased items', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined))
    renderSection({
      groups: [
        makeGroup('vegetable', 'Vegetable', [
          makeItem('Carrot', 'v1', true),
          makeItem('Asparagus', 'v2'),
        ]),
        makeGroup('protein', 'Protein', [makeItem('Beef', 'p1')]),
      ],
      initialPurchasedIds: new Set(['v1']),
    })

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    // Heading counts match the copied lines, not the on-screen totals — the
    // vegetable group shows 2 rows on screen but only Asparagus is still to buy.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          expectedHeading,
          '',
          '🥬 Vegetables (1)',
          '- Asparagus 100 g',
          '',
          '🥩 Protein (1)',
          '- Beef 100 g',
        ].join('\n'),
      ),
    )
  })

  it('copies unchecked custom items under the "Other" heading', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined))
    renderSection({
      groups: [makeGroup('protein', 'Protein', [makeItem('Beef', 'p1')])],
      initialCustomItems: [
        {
          id: 'c1',
          name: 'Baking paper',
          checked: false,
          ingredientId: null,
          ingredientCategory: null,
          createdAt: '2026-02-16T10:00:00Z',
        },
        {
          id: 'c2',
          name: 'Napkins',
          checked: true,
          ingredientId: null,
          ingredientCategory: null,
          createdAt: '2026-02-16T10:00:00Z',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          expectedHeading,
          '',
          '🥩 Protein (1)',
          '- Beef 100 g',
          '',
          '📝 Other (1)',
          '- Baking paper',
        ].join('\n'),
      ),
    )
  })

  it('copies urgency buckets and a custom-items section in urgency mode', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined))
    localStorage.setItem('shopping-list-sort-mode', 'urgency')
    renderSection({
      initialCustomItems: [
        {
          id: 'c1',
          name: 'Bananas',
          checked: false,
          ingredientId: null,
          ingredientCategory: null,
          createdAt: '2026-02-16T10:00:00Z',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    // The mocked `getUrgencyBucket` puts every item in "this week".
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          expectedHeading,
          '',
          'This week (3)',
          '- Carrot 100 g',
          '- Asparagus 100 g',
          '- Beef 100 g',
          '',
          '📝 Custom items (1)',
          '- Bananas',
        ].join('\n'),
      ),
    )
  })

  it('copies a flat list with no headings in alphabetical mode', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined))
    localStorage.setItem('shopping-list-sort-mode', 'alphabetical')
    renderSection()

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [expectedHeading, '', '- Asparagus 100 g', '- Beef 100 g', '- Carrot 100 g'].join('\n'),
      ),
    )
  })

  it('shows a success toast, swaps the icon, and fires the analytics event', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    renderSection()

    const button = screen.getByRole('button', { name: /copy list/i })
    await user.click(button)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Shopping list copied'))
    expect(track).toHaveBeenCalledWith('shopping:list_copied', {
      source: 'shopping_list',
      item_count: 3,
    })
    // The label stays constant across the icon swap so the accessible name
    // doesn't churn; the checkmark itself is aria-hidden.
    expect(button).toHaveAccessibleName('Copy list')
  })

  it('shows an error toast when the clipboard write rejects', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    renderSection()

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't copy the list"))
    expect(toast.success).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('shows an error toast when the Clipboard API is unavailable', async () => {
    const user = userEvent.setup()
    // An insecure context has no `navigator.clipboard` at all. `userEvent.setup()`
    // installs its own stub, so strip it back off. Optional chaining around
    // `writeText` would resolve to `undefined` here and report success.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    renderSection()

    await user.click(screen.getByRole('button', { name: /copy list/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't copy the list"))
    expect(toast.success).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })
})
