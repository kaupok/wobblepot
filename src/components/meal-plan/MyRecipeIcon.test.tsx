import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MyRecipeIcon } from './MyRecipeIcon'

describe('MyRecipeIcon', () => {
  it('is a bare icon whose trigger carries the label, with no native tooltip', () => {
    const { container } = render(<MyRecipeIcon />)
    const trigger = screen.getByRole('button', { name: 'My recipe' })
    expect(trigger).toHaveAttribute('data-size', 'icon-xs')
    expect(trigger).not.toHaveAttribute('title')
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // Not a pill: no badge around the icon.
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(container.querySelector('[title]')).toBeNull()
  })

  it('uses the icon-display button at lg, for the cook view title (HON-1023)', () => {
    render(<MyRecipeIcon size="lg" />)
    const trigger = screen.getByRole('button', { name: 'My recipe' })
    expect(trigger).toHaveAttribute('data-size', 'icon-display')
    // The variant sizes the icon, so the card's 14px class is not on it.
    expect(trigger.querySelector('svg')).not.toHaveClass('size-3.5')
  })
})
