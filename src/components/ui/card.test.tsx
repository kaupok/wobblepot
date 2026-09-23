import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './card'

function renderCard(props: React.ComponentProps<typeof Card> = {}) {
  render(
    <Card data-testid="card" {...props}>
      Content
    </Card>,
  )
  return screen.getByTestId('card')
}

describe('Card', () => {
  it('uses the roomy rhythm by default', () => {
    const card = renderCard()
    expect(card).toHaveClass('gap-6', 'py-6', 'rounded-xl', 'border')
    expect(card).toHaveAttribute('data-size', 'default')
  })

  // HON-674: the dense card was `className="gap-2 py-2"` at each callsite.
  it('tightens only its own gap and vertical padding at size sm', () => {
    const card = renderCard({ size: 'sm' })
    expect(card).toHaveClass('gap-2', 'py-2', 'rounded-xl', 'border')
    expect(card).not.toHaveClass('gap-6', 'py-6')
    expect(card).toHaveAttribute('data-size', 'sm')
  })

  it('still merges a placement className', () => {
    expect(renderCard({ className: 'w-80' })).toHaveClass('w-80', 'gap-6')
  })
})
