import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UrgentShopping } from './UrgentShopping'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

const todayItem: ShoppingItem = {
  ingredientId: 'ing-1',
  name: 'Tomatoes',
  displayQuantity: '400g',
  neededByDate: '2026-03-07',
  neededByRelative: 'today',
  purchased: false,
  urgency: 'today',
}

const tomorrowItem: ShoppingItem = {
  ingredientId: 'ing-2',
  name: 'Onion',
  displayQuantity: '2',
  neededByDate: '2026-03-08',
  neededByRelative: 'tomorrow',
  purchased: false,
  urgency: 'tomorrow',
}

const purchasedTodayItem: ShoppingItem = {
  ingredientId: 'ing-3',
  name: 'Garlic',
  displayQuantity: '3 cloves',
  neededByDate: '2026-03-07',
  neededByRelative: 'today',
  purchased: true,
  urgency: 'today',
}

const laterItem: ShoppingItem = {
  ingredientId: 'ing-4',
  name: 'Rice',
  displayQuantity: '1kg',
  neededByDate: '2026-03-14',
  neededByRelative: 'next week',
  purchased: false,
  urgency: 'later',
}

describe('UrgentShopping', () => {
  it('shows all-set state when no unpurchased urgent items', () => {
    render(<UrgentShopping items={[purchasedTodayItem]} />)
    expect(screen.getByText(/all set for the next 2 days/)).toBeInTheDocument()
  })

  it('shows all-set state when only later items exist', () => {
    render(<UrgentShopping items={[laterItem]} />)
    expect(screen.getByText(/all set for the next 2 days/)).toBeInTheDocument()
  })

  it('shows all-set state with empty items', () => {
    render(<UrgentShopping items={[]} />)
    expect(screen.getByText(/all set for the next 2 days/)).toBeInTheDocument()
  })

  it('renders unpurchased items', () => {
    render(<UrgentShopping items={[todayItem, tomorrowItem]} />)
    expect(screen.getByText('Tomatoes')).toBeInTheDocument()
    expect(screen.getByText('Onion')).toBeInTheDocument()
  })

  it('shows correct summary for today items', () => {
    render(<UrgentShopping items={[todayItem]} />)
    expect(screen.getByText('Need 1 for today')).toBeInTheDocument()
  })

  it('shows correct summary for today and tomorrow items', () => {
    render(<UrgentShopping items={[todayItem, tomorrowItem]} />)
    expect(screen.getByText('Need 1 for today, 1 for tomorrow')).toBeInTheDocument()
  })

  it('shows unpurchased item count in header', () => {
    render(<UrgentShopping items={[todayItem, tomorrowItem]} />)
    // The header has a Shopping title with the count
    expect(screen.getByText('Shopping')).toBeInTheDocument()
    expect(screen.getByText('Need 1 for today, 1 for tomorrow')).toBeInTheDocument()
  })

  it('shows "View full list" link', () => {
    render(<UrgentShopping items={[todayItem]} />)
    const link = screen.getByRole('link', { name: 'View full list' })
    expect(link).toHaveAttribute('href', '/shopping')
  })

  it('shows purchased items toggle when there are purchased items', () => {
    render(<UrgentShopping items={[todayItem, purchasedTodayItem]} />)
    expect(screen.getByText('1 item purchased')).toBeInTheDocument()
  })

  it('expands purchased items when toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<UrgentShopping items={[todayItem, purchasedTodayItem]} />)

    // Garlic should not be visible initially
    expect(screen.queryByText('Garlic')).not.toBeInTheDocument()

    // Click to expand
    await user.click(screen.getByText('1 item purchased'))
    expect(screen.getByText('Garlic')).toBeInTheDocument()
  })

  it('does not show purchased toggle when no purchased items', () => {
    render(<UrgentShopping items={[todayItem, tomorrowItem]} />)
    expect(screen.queryByText(/purchased/)).not.toBeInTheDocument()
  })

  it('excludes later items from display', () => {
    render(<UrgentShopping items={[todayItem, laterItem]} />)
    expect(screen.getByText('Tomatoes')).toBeInTheDocument()
    expect(screen.queryByText('Rice')).not.toBeInTheDocument()
  })
})
