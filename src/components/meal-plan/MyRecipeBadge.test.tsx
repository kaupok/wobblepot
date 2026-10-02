import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MyRecipeBadge, MyRecipeIcon } from './MyRecipeBadge'

describe('MyRecipeBadge', () => {
  it('renders the label as a secondary badge with a decorative icon', () => {
    const { container } = render(<MyRecipeBadge />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveClass('bg-secondary')
    expect(badge).toHaveTextContent('My recipe')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(badge).not.toHaveAttribute('title')
  })
})

describe('MyRecipeIcon', () => {
  it('is a bare icon whose trigger carries the label, with no native tooltip', () => {
    const { container } = render(<MyRecipeIcon />)
    const trigger = screen.getByRole('button', { name: 'My recipe' })
    expect(trigger).not.toHaveAttribute('title')
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // Not a pill: no badge around the icon.
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(container.querySelector('[title]')).toBeNull()
  })
})
