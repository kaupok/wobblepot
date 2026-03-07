import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PantryItem, type PantryItemData } from './PantryItem'

const baseItem: PantryItemData = {
  id: 'item-1',
  ingredient: {
    id: 'ing-1',
    name: 'Olive oil',
    category: 'fat',
    defaultUnit: 'g',
  },
  quantity: null,
  isStaple: false,
  updatedAt: '2026-03-01T10:00:00Z',
}

const stapleItem: PantryItemData = {
  ...baseItem,
  id: 'item-2',
  isStaple: true,
}

describe('PantryItem', () => {
  it('renders the ingredient name', () => {
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('Olive oil')).toBeInTheDocument()
  })

  it('shows "Mark as staple" button for non-staple items', () => {
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Mark as staple' })).toBeInTheDocument()
  })

  it('shows "Remove from staples" button for staple items', () => {
    render(<PantryItem item={stapleItem} onToggleStaple={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Remove from staples' })).toBeInTheDocument()
  })

  it('calls onToggleStaple when star button is clicked', async () => {
    const user = userEvent.setup()
    const onToggleStaple = vi.fn().mockResolvedValue(undefined)
    render(<PantryItem item={baseItem} onToggleStaple={onToggleStaple} onRemove={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Mark as staple' }))
    expect(onToggleStaple).toHaveBeenCalledWith('item-1', false)
  })

  it('shows remove button with correct aria-label', () => {
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Remove Olive oil' })).toBeInTheDocument()
  })

  it('opens confirm dialog when remove button is clicked', async () => {
    const user = userEvent.setup()
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Remove Olive oil' }))
    expect(screen.getByText('Remove from pantry')).toBeInTheDocument()
    expect(
      screen.getByText('Are you sure you want to remove Olive oil from your pantry?'),
    ).toBeInTheDocument()
  })

  it('calls onRemove when confirm dialog is confirmed', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn().mockResolvedValue(undefined)
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'Remove Olive oil' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith('item-1')
  })

  it('does not call onRemove when dialog is cancelled', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<PantryItem item={baseItem} onToggleStaple={vi.fn()} onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'Remove Olive oil' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRemove).not.toHaveBeenCalled()
  })
})
