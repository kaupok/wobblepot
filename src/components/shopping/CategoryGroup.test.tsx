import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CategoryGroup } from './CategoryGroup'
import type { ShoppingItemData } from './ShoppingItem'

const items: ShoppingItemData[] = [
  {
    ingredientId: 'ing-1',
    name: 'Chicken breast',
    displayQuantity: '500g',
    purchased: false,
    neededByDate: '2026-03-10',
    neededByRelative: 'tomorrow',
    neededByAbsolute: 'Tuesday, March 10',
  },
  {
    ingredientId: 'ing-2',
    name: 'Salmon fillet',
    displayQuantity: '300g',
    purchased: true,
    neededByDate: '2026-03-11',
    neededByRelative: '2 days',
    neededByAbsolute: 'Wednesday, March 11',
  },
]

describe('CategoryGroup', () => {
  it('renders category label with emoji and count', () => {
    render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={items}
        onToggleItem={vi.fn()}
      />,
    )
    expect(screen.getByText(/Protein \(2\)/)).toBeInTheDocument()
  })

  it('shows purchase progress when some items are purchased', () => {
    render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={items}
        onToggleItem={vi.fn()}
      />,
    )
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('does not show purchase progress when no items are purchased', () => {
    const unpurchasedItems = items.map((item) => ({ ...item, purchased: false }))
    render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={unpurchasedItems}
        onToggleItem={vi.fn()}
      />,
    )
    expect(screen.queryByText(/0\/2/)).not.toBeInTheDocument()
  })

  it('renders all shopping items', () => {
    render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={items}
        onToggleItem={vi.fn()}
      />,
    )
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
    expect(screen.getByText('Salmon fillet')).toBeInTheDocument()
  })

  it('returns null when there are no items', () => {
    const { container } = render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={[]}
        onToggleItem={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('includes custom items in total count', () => {
    const customItems = [
      {
        id: 'custom-1',
        name: 'Extra sauce',
        checked: false,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-03-01T10:00:00Z',
      },
    ]
    render(
      <CategoryGroup
        category="protein"
        categoryLabel="Protein"
        items={items}
        customItems={customItems}
        onToggleItem={vi.fn()}
        onToggleCustomItem={vi.fn()}
        onUnlinkCustomItem={vi.fn()}
        onDeleteCustomItem={vi.fn()}
      />,
    )
    expect(screen.getByText(/Protein \(3\)/)).toBeInTheDocument()
  })
})
