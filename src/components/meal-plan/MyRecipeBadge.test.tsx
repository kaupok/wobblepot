import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MyRecipeBadge } from './MyRecipeBadge'

describe('MyRecipeBadge', () => {
  it('renders the label as a secondary badge with a decorative icon', () => {
    const { container } = render(<MyRecipeBadge />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveClass('bg-secondary')
    expect(badge).toHaveTextContent('My recipe')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(badge).not.toHaveAttribute('title')
  })

  it('keeps the label for assistive tech and the tooltip when compact', () => {
    const { container } = render(<MyRecipeBadge compact />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveAttribute('title', 'My recipe')
    expect(screen.getByText('My recipe')).toHaveClass('sr-only')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
