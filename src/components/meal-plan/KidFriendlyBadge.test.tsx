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
  })
})
