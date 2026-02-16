import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomItemInput } from './CustomItemInput'

describe('CustomItemInput', () => {
  it('renders the input with placeholder', () => {
    render(<CustomItemInput onItemAdded={vi.fn()} />)
    expect(screen.getByPlaceholderText('Add an item...')).toBeInTheDocument()
  })

  it('has proper aria label', () => {
    render(<CustomItemInput onItemAdded={vi.fn()} />)
    expect(screen.getByLabelText('Add custom item to shopping list')).toBeInTheDocument()
  })

  it('does not submit empty input', async () => {
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    render(<CustomItemInput onItemAdded={onItemAdded} />)

    const input = screen.getByPlaceholderText('Add an item...')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onItemAdded).not.toHaveBeenCalled()
  })

  it('disables input when disabled prop is true', () => {
    render(<CustomItemInput onItemAdded={vi.fn()} disabled />)
    expect(screen.getByPlaceholderText('Add an item...')).toBeDisabled()
  })
})
