import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UrgencyGroup } from './UrgencyGroup'
import type { ShoppingItemData } from './ShoppingItem'

const items: ShoppingItemData[] = [
  {
    ingredientId: 'ing-1',
    name: 'Tomatoes',
    displayQuantity: '400g',
    purchased: false,
    neededByDate: '2026-03-07',
    neededByRelative: 'today',
    neededByAbsolute: 'Friday, March 7',
  },
  {
    ingredientId: 'ing-2',
    name: 'Onion',
    displayQuantity: '2\u00a0pc',
    purchased: true,
    neededByDate: '2026-03-07',
    neededByRelative: 'today',
    neededByAbsolute: 'Friday, March 7',
  },
]

describe('UrgencyGroup', () => {
  it('renders urgency label with count', () => {
    render(<UrgencyGroup bucket="today" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Today 2' })).toBeInTheDocument()
  })

  it('renders "Tomorrow" label for tomorrow bucket', () => {
    render(<UrgencyGroup bucket="tomorrow" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Tomorrow 2' })).toBeInTheDocument()
  })

  it('renders "This week" label for this-week bucket', () => {
    render(<UrgencyGroup bucket="this-week" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'This week 2' })).toBeInTheDocument()
  })

  it('renders "Later" label for later bucket', () => {
    render(<UrgencyGroup bucket="later" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Later 2' })).toBeInTheDocument()
  })

  it('shows purchase progress when some items are purchased', () => {
    render(<UrgencyGroup bucket="today" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('does not show purchase progress when none purchased', () => {
    const unpurchasedItems = items.map((item) => ({ ...item, purchased: false }))
    render(<UrgencyGroup bucket="today" items={unpurchasedItems} onToggleItem={vi.fn()} />)
    expect(screen.queryByText(/0\/2/)).not.toBeInTheDocument()
  })

  it('renders all items', () => {
    render(<UrgencyGroup bucket="today" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText('Tomatoes')).toBeInTheDocument()
    expect(screen.getByText('Onion')).toBeInTheDocument()
  })

  it.each(['today', 'tomorrow'] as const)(
    'does not repeat the day on each row in the %s group',
    (bucket) => {
      const dayItems = items.map((item) => ({ ...item, neededByRelative: bucket }))
      render(<UrgencyGroup bucket={bucket} items={dayItems} onToggleItem={vi.fn()} />)
      expect(screen.queryByText(bucket)).not.toBeInTheDocument()
    },
  )

  it.each(['this-week', 'later'] as const)(
    'shows the day on each row in the %s group',
    (bucket) => {
      const dayItems = items.map((item) => ({ ...item, neededByRelative: 'Tuesday' }))
      render(<UrgencyGroup bucket={bucket} items={dayItems} onToggleItem={vi.fn()} />)
      expect(screen.getAllByText('Tuesday')).toHaveLength(2)
    },
  )

  it('keeps the purchased styling on a row in the today group', () => {
    render(<UrgencyGroup bucket="today" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText('Onion')).toHaveClass('line-through')
    expect(screen.getByText('Tomatoes')).not.toHaveClass('line-through')
  })
})
