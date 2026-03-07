import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PantryList } from './PantryList'
import type { PantryItemData } from './PantryItem'

// Mock InlineAddItem since it depends on fetch for search
vi.mock('./InlineAddItem', () => ({
  InlineAddItem: ({ onItemAdded: _ }: { onItemAdded: unknown }) => (
    <div data-testid="inline-add-item">Add item</div>
  ),
}))

const stapleItem: PantryItemData = {
  id: 'item-1',
  ingredient: { id: 'ing-1', name: 'Salt', category: 'condiment', defaultUnit: 'g' },
  quantity: null,
  isStaple: true,
  updatedAt: '2026-03-01T10:00:00Z',
}

const onHandItem: PantryItemData = {
  id: 'item-2',
  ingredient: { id: 'ing-2', name: 'Chicken breast', category: 'protein', defaultUnit: 'g' },
  quantity: 500,
  isStaple: false,
  updatedAt: '2026-03-01T10:00:00Z',
}

const anotherOnHandItem: PantryItemData = {
  id: 'item-3',
  ingredient: { id: 'ing-3', name: 'Rice', category: 'carb', defaultUnit: 'g' },
  quantity: null,
  isStaple: false,
  updatedAt: '2026-03-01T10:00:00Z',
}

describe('PantryList', () => {
  it('shows empty state when no items', () => {
    render(<PantryList initialItems={[]} />)
    expect(screen.getByText('Your pantry')).toBeInTheDocument()
    expect(screen.getByText(/Your pantry is empty/)).toBeInTheDocument()
  })

  it('renders the inline add item component', () => {
    render(<PantryList initialItems={[]} />)
    expect(screen.getByTestId('inline-add-item')).toBeInTheDocument()
  })

  it('shows staples section when there are staple items', () => {
    render(<PantryList initialItems={[stapleItem]} />)
    expect(screen.getByText('Staples (always stocked)')).toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
    expect(screen.getByText('Salt')).toBeInTheDocument()
  })

  it('shows on hand section when there are non-staple items', () => {
    render(<PantryList initialItems={[onHandItem]} />)
    expect(screen.getByText('On hand')).toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
  })

  it('shows correct plural item counts', () => {
    render(<PantryList initialItems={[onHandItem, anotherOnHandItem]} />)
    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('shows both sections when there are staple and on-hand items', () => {
    render(<PantryList initialItems={[stapleItem, onHandItem]} />)
    expect(screen.getByText('Staples (always stocked)')).toBeInTheDocument()
    expect(screen.getByText('On hand')).toBeInTheDocument()
    expect(screen.getByText('Salt')).toBeInTheDocument()
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
  })

  it('shows footer hint text when items exist', () => {
    render(<PantryList initialItems={[onHandItem]} />)
    expect(
      screen.getByText('Mark items as staples to exclude them from shopping lists'),
    ).toBeInTheDocument()
  })

  it('does not show footer hint in empty state', () => {
    render(<PantryList initialItems={[]} />)
    expect(
      screen.queryByText('Mark items as staples to exclude them from shopping lists'),
    ).not.toBeInTheDocument()
  })
})
