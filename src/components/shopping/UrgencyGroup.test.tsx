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
    displayQuantity: '2',
    purchased: true,
    neededByDate: '2026-03-07',
    neededByRelative: 'today',
    neededByAbsolute: 'Friday, March 7',
  },
]

describe('UrgencyGroup', () => {
  it('renders urgency label with count', () => {
    render(<UrgencyGroup bucket="today" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText(/Today \(2\)/)).toBeInTheDocument()
  })

  it('renders "Tomorrow" label for tomorrow bucket', () => {
    render(<UrgencyGroup bucket="tomorrow" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText(/Tomorrow \(2\)/)).toBeInTheDocument()
  })

  it('renders "This week" label for this-week bucket', () => {
    render(<UrgencyGroup bucket="this-week" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText(/This week \(2\)/)).toBeInTheDocument()
  })

  it('renders "Later" label for later bucket', () => {
    render(<UrgencyGroup bucket="later" items={items} onToggleItem={vi.fn()} />)
    expect(screen.getByText(/Later \(2\)/)).toBeInTheDocument()
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
})
