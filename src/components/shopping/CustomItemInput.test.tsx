import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomItemInput } from './CustomItemInput'
import { createQueryWrapper } from '@/test/query-wrapper'

function renderInput(props: Partial<Parameters<typeof CustomItemInput>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<CustomItemInput onItemAdded={vi.fn()} {...props} />, { wrapper })
}

describe('CustomItemInput', () => {
  it('renders the input with placeholder', () => {
    renderInput()
    expect(screen.getByPlaceholderText('Add an item...')).toBeInTheDocument()
  })

  it('has proper aria label', () => {
    renderInput()
    expect(screen.getByLabelText('Add custom item to shopping list')).toBeInTheDocument()
  })

  it('does not submit empty input', async () => {
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item...')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onItemAdded).not.toHaveBeenCalled()
  })

  it('disables input when disabled prop is true', () => {
    renderInput({ disabled: true })
    expect(screen.getByPlaceholderText('Add an item...')).toBeDisabled()
  })
})
