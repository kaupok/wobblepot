import { fireEvent, render, screen } from '@testing-library/react'
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
    // The app's tooltip, never the browser's: the badge is its trigger.
    expect(badge).not.toHaveAttribute('title')
    expect(badge).toHaveAttribute('data-state', 'closed')
    expect(screen.getByText('Kid-friendly')).toHaveClass('sr-only')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('opens the label on a tap in the cook view (compact, lg)', () => {
    const { container } = render(<KidFriendlyBadge compact size="lg" />)
    const badge = container.querySelector<HTMLElement>('[data-slot="badge"]')!
    fireEvent.pointerDown(badge, { pointerType: 'touch' })
    fireEvent.pointerUp(badge, { pointerType: 'touch' })
    fireEvent.click(badge)
    expect(badge).toHaveAttribute('data-state', 'instant-open')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Kid-friendly')
  })
})
