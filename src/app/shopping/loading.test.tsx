import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShoppingColumnSkeleton } from './loading'

// HON-1349: the loading list has no note sheet, so its bars are the default
// grey tone. A yellow sheet reads as content, then goes away when the list
// loads empty or fails.
describe('ShoppingColumnSkeleton', () => {
  it('renders no note sheet', () => {
    const { container } = render(<ShoppingColumnSkeleton />)

    expect(container.querySelector('[data-surface]')).toBeNull()
  })

  it('renders every bar in the default tone', () => {
    render(<ShoppingColumnSkeleton />)

    const bars = screen.getAllByRole('status', { hidden: true })
    // Title, three controls, add field, group heading, five rows of three.
    expect(bars).toHaveLength(21)
    for (const bar of bars) {
      expect(bar).toHaveAttribute('data-tone', 'default')
    }
  })
})
