import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Switch } from './switch'

describe('Switch', () => {
  it('renders a switch whose aria-checked follows checked', () => {
    const { rerender } = render(<Switch aria-label="Have it: Milk" checked={false} />)
    const control = screen.getByRole('switch', { name: 'Have it: Milk' })
    expect(control).toHaveAttribute('aria-checked', 'false')

    rerender(<Switch aria-label="Have it: Milk" checked />)
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('fires onCheckedChange with the next state on click and on Space', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Have it: Milk" checked onCheckedChange={onCheckedChange} />)
    const control = screen.getByRole('switch', { name: 'Have it: Milk' })

    await userEvent.click(control)
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)

    control.focus()
    await userEvent.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledTimes(2)
  })

  it('does not fire when disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Have it: Milk" disabled onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Have it: Milk' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
