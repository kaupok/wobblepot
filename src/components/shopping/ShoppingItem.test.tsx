import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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

const ranOutItem: ShoppingItemData = {
  ...baseItem,
  ingredientId: 'ing-3',
  name: 'Greek yoghurt',
  displayQuantity: '',
  restock: true,
}

describe('ShoppingItem', () => {
  it('shows "Ran out" in place of the amount for a ran-out staple with no amount', () => {
    render(<ShoppingItem item={ranOutItem} onToggle={vi.fn()} />)

    const row = screen
      .getByRole('checkbox', { name: 'Mark Greek yoghurt as purchased' })
      .closest('label')!
    expect(row).toHaveTextContent(/^Greek yoghurtRan outtomorrow$/)
  })

  it('shows the amount and "Ran out" for a ran-out staple a meal needs', () => {
    render(<ShoppingItem item={{ ...ranOutItem, displayQuantity: '300g' }} onToggle={vi.fn()} />)

    expect(screen.getByText('300g')).toBeInTheDocument()
    expect(screen.getByText('Ran out')).toBeInTheDocument()
  })

  it('shows the name and "Running low" for a low line with no amount, and no "0 g"', () => {
    const onion = {
      ...baseItem,
      ingredientId: 'ing-4',
      name: 'Onion',
      displayQuantity: '',
      low: true,
    }
    render(<ShoppingItem item={onion} onToggle={vi.fn()} />)

    const row = screen.getByRole('checkbox', { name: 'Mark Onion as purchased' }).closest('label')!
    expect(row).toHaveTextContent(/^OnionRunning lowtomorrow$/)
    expect(row).not.toHaveTextContent('0 g')
  })

  it('shows the amount and "Running low" for a low line with a shortfall', () => {
    const onion = { ...baseItem, name: 'Onion', displayQuantity: '200 g', low: true }
    render(<ShoppingItem item={onion} onToggle={vi.fn()} />)

    expect(screen.getByText('200 g')).toBeInTheDocument()
    expect(screen.getByText('Running low')).toBeInTheDocument()
  })

  it('shows no "Ran out" tag on an ordinary line', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)

    expect(screen.queryByText('Ran out')).not.toBeInTheDocument()
  })

  it('renders item name and quantity', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
    expect(screen.getByText('500g')).toBeInTheDocument()
  })

  it('renders relative date', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    expect(screen.getByText('tomorrow')).toBeInTheDocument()
  })

  it('omits the due label when showDue is false', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} showDue={false} />)
    expect(screen.queryByText('tomorrow')).not.toBeInTheDocument()
    expect(screen.getByText('Chicken breast')).toBeInTheDocument()
    expect(screen.getByText('500g')).toBeInTheDocument()
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

  it('marks the due label with the warning token when due today', () => {
    render(<ShoppingItem item={{ ...baseItem, dueToday: true }} onToggle={vi.fn()} />)
    expect(screen.getByText('tomorrow')).toHaveClass('text-warning')
  })

  it('keeps the due label muted when not due today', () => {
    render(<ShoppingItem item={baseItem} onToggle={vi.fn()} />)
    const label = screen.getByText('tomorrow')
    expect(label).toHaveClass('text-muted-foreground')
    expect(label).not.toHaveClass('text-warning')
  })

  it('dims a due-today label once the item is purchased', () => {
    render(<ShoppingItem item={{ ...purchasedItem, dueToday: true }} onToggle={vi.fn()} />)
    expect(screen.getByText('tomorrow')).not.toHaveClass('text-warning')
  })

  it('applies disabled styling when disabled', () => {
    const { container } = render(<ShoppingItem item={baseItem} onToggle={vi.fn()} disabled />)
    const label = container.querySelector('label')
    expect(label?.className).toContain('opacity-50')
  })
})
