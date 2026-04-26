import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomShoppingItem } from './CustomShoppingItem'
import type { CustomItemData } from './CustomItemInput'

const baseItem: CustomItemData = {
  id: 'custom-1',
  name: 'Olive oil',
  checked: false,
  ingredientId: 'ing-1',
  ingredientCategory: 'fat',
  createdAt: '2026-02-16T10:00:00Z',
}

const unlinkedItem: CustomItemData = {
  id: 'custom-2',
  name: 'Paper towels',
  checked: false,
  ingredientId: null,
  ingredientCategory: null,
  createdAt: '2026-02-16T10:00:00Z',
}

describe('CustomShoppingItem', () => {
  it('renders the item name', () => {
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Olive oil')).toBeInTheDocument()
  })

  it('shows category label for linked items', () => {
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/Oils & fats/)).toBeInTheDocument()
  })

  it('does not show category label for unlinked items', () => {
    render(
      <CustomShoppingItem
        item={unlinkedItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Oils & fats/)).not.toBeInTheDocument()
  })

  it('shows unlink button for linked items', () => {
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Unlink Olive oil from ingredient')).toBeInTheDocument()
  })

  it('does not show unlink button for unlinked items', () => {
    render(
      <CustomShoppingItem
        item={unlinkedItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/unlink/i)).not.toBeInTheDocument()
  })

  it('calls onToggle when checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={onToggle}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith('custom-1', true)
  })

  it('calls onDelete when remove button is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const removeButton = screen.getByLabelText('Remove Olive oil')
    await user.click(removeButton)
    expect(onDelete).toHaveBeenCalledWith('custom-1')
  })

  it('calls onUnlink when unlink button is clicked', async () => {
    const user = userEvent.setup()
    const onUnlink = vi.fn()
    render(
      <CustomShoppingItem
        item={baseItem}
        onToggle={vi.fn()}
        onUnlink={onUnlink}
        onDelete={vi.fn()}
      />,
    )

    const unlinkButton = screen.getByLabelText('Unlink Olive oil from ingredient')
    await user.click(unlinkButton)
    expect(onUnlink).toHaveBeenCalledWith('custom-1')
  })

  it('hides unlink button for checked items', () => {
    const checkedItem = { ...baseItem, checked: true }
    render(
      <CustomShoppingItem
        item={checkedItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/unlink/i)).not.toBeInTheDocument()
  })

  it('applies strikethrough style when checked', () => {
    const checkedItem = { ...baseItem, checked: true }
    render(
      <CustomShoppingItem
        item={checkedItem}
        onToggle={vi.fn()}
        onUnlink={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const nameElement = screen.getByText('Olive oil')
    expect(nameElement.className).toContain('line-through')
  })
})
