import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { KidFriendlyBadge } from './KidFriendlyBadge'

describe('KidFriendlyBadge', () => {
  it('renders the label as a secondary badge with a decorative icon', () => {
    const { container } = render(<KidFriendlyBadge />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveClass('bg-secondary')
    expect(badge).toHaveTextContent('Kid-friendly')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(badge).not.toHaveAttribute('title')
  })

  it('keeps the label for assistive tech and the tooltip when compact', () => {
    const { container } = render(<KidFriendlyBadge compact />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveAttribute('title', 'Kid-friendly')
    expect(screen.getByText('Kid-friendly')).toHaveClass('sr-only')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
