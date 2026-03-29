import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShoppingSection } from './ShoppingSection'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { IngredientCategory } from '@/generated/prisma/enums'

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn())

// Mock sonner toast
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

// Mock date utility used in urgency mode
vi.mock('@/lib/meal-planning/dates', () => ({
  getUrgencyBucket: () => 'this-week' as const,
}))

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
