import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShoppingItem, type ShoppingItemData } from './ShoppingItem'

const baseItem: ShoppingItemData = {
  ingredientId: 'ing-1',
  name: 'Chicken breast',
  displayQuantity: '500g',
  purchased: false,
  neededByDate: '2026-03-10',
  neededByRelative: 'tomorrow',
  neededByAbsolute: 'Tuesday, March 10',
}

const purchasedItem: ShoppingItemData = {
  ...baseItem,
  purchased: true,
}

const vagueItem: ShoppingItemData = {
  ...baseItem,
  ingredientId: 'ing-2',
  name: 'Garlic',
  displayQuantity: 'some',
  isVague: true,
}

describe('ShoppingItem', () => {
  it('renders item name and quantity', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
    expect(screen.getByText('500g')).toBeInTheDocument()
  })

  it('renders relative date', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    expect(screen.getByText('tomorrow')).toBeInTheDocument()
  })

  it('renders checkbox with correct aria-label for unpurchased item', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    expect(
      screen.getByRole('checkbox', { name: 'Mark Chicken breast as purchased' }),
    ).toBeInTheDocument()
  })

  it('renders checkbox with correct aria-label for purchased item', () => {
    render(<ShoppingItem item={purchasedItem} onToggle={vi.fn()} />)
    expect(
      screen.getByRole('checkbox', { name: 'Mark Chicken breast as not purchased' }),
    ).toBeInTheDocument()
  })

  it('calls onToggle with ingredientId and checked state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ShoppingItem item={baseItem} onToggle={onToggle} />)

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith('ing-1', true)
  })

  it('applies strikethrough when purchased', () => {
    render(<ShoppingItem item={purchasedItem} onToggle={vi.fn()} />)
    const nameElement = screen.getByText('Chicken breast')
    expect(nameElement.className).toContain('line-through')
  })

  it('does not apply strikethrough when not purchased', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    const nameElement = screen.getByText('Chicken breast')
    expect(nameElement.className).not.toContain('line-through')
  })

  it('applies italic class for vague quantities', () => {
    render(<ShoppingItem item={vagueItem} onToggle={vi.fn()} />)
    const quantityElement = screen.getByText('some')
    expect(quantityElement.className).toContain('italic')
  })

  it('does not apply italic for exact quantities', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    const quantityElement = screen.getByText('500g')
    expect(quantityElement.className).not.toContain('italic')
  })

  it('reduces opacity when pending', () => {
    const { container } = render(<ShoppingItem item={baseItem} onToggle={vi.fn()} pending />)
    const label = container.querySelector('label')
    expect(label?.className).toContain('opacity-70')
  })

  it('applies disabled styling when disabled', () => {
    const { container } = render(<ShoppingItem item={baseItem} onToggle={vi.fn()} disabled />)
    const label = container.querySelector('label')
    expect(label?.className).toContain('opacity-50')
  })
})
