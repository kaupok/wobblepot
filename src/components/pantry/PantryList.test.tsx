import { describe, it, expect, vi } from 'vitest'
// The vitest setup mock returns the raw catalog string; this suite checks the
// ICU-resolved plural output, so use the real next-intl provider instead.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import { PantryList } from './PantryList'
import type { PantryItemData } from './PantryItem'

// Mock InlineAddItem since it depends on fetch for search
vi.mock('./InlineAddItem', () => ({
  InlineAddItem: ({ onItemAdded: _ }: { onItemAdded: unknown }) => (
    <div data-testid="inline-add-item">Add item</div>
  ),
}))

function renderInLocale(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  )
}

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
    renderInLocale(<PantryList initialItems={[]} />)
    expect(screen.getByText('Your pantry')).toBeInTheDocument()
    expect(screen.getByText(/Your pantry is empty/)).toBeInTheDocument()
  })

  it('renders the inline add item component', () => {
    renderInLocale(<PantryList initialItems={[]} />)
    expect(screen.getByTestId('inline-add-item')).toBeInTheDocument()
  })

  it('shows staples section when there are staple items', () => {
    renderInLocale(<PantryList initialItems={[stapleItem]} />)
    expect(screen.getByText('Staples (always stocked)')).toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
    expect(screen.getByText('Salt')).toBeInTheDocument()
  })

  it('shows on hand section when there are non-staple items', () => {
    renderInLocale(<PantryList initialItems={[onHandItem]} />)
    expect(screen.getByText('On hand')).toBeInTheDocument()
    expect(screen.getByText('1 item')).toBeInTheDocument()
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
  })

  it('shows correct plural item counts', () => {
    renderInLocale(<PantryList initialItems={[onHandItem, anotherOnHandItem]} />)
    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('shows both sections when there are staple and on-hand items', () => {
    renderInLocale(<PantryList initialItems={[stapleItem, onHandItem]} />)
    expect(screen.getByText('Staples (always stocked)')).toBeInTheDocument()
    expect(screen.getByText('On hand')).toBeInTheDocument()
    expect(screen.getByText('Salt')).toBeInTheDocument()
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
  })

  it('shows footer hint text when items exist', () => {
    renderInLocale(<PantryList initialItems={[onHandItem]} />)
    expect(
      screen.getByText('Mark items as staples to exclude them from shopping lists'),
    ).toBeInTheDocument()
  })

  it('does not show footer hint in empty state', () => {
    renderInLocale(<PantryList initialItems={[]} />)
    expect(
      screen.queryByText('Mark items as staples to exclude them from shopping lists'),
    ).not.toBeInTheDocument()
  })
})
