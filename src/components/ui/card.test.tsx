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

  // HON-1010: a card a click anywhere opens. It stays a plain div.
  it("marks an interactive card for hover and its target's focus ring", () => {
    const card = renderCard({ interactive: true })
    expect(card).toHaveClass(
      'group/card',
      'cursor-pointer',
      'hover:border-border',
      'hover:ring-1',
      'hover:ring-border',
      'has-[[data-slot=card-target]:focus-visible]:ring-[3px]',
    )
    expect(card).not.toHaveAttribute('role')
    expect(card).not.toHaveAttribute('tabindex')
  })

  // HON-1224: a card on a coloured surface (the landing tiles) has no border.
  it('draws a border by default', () => {
    expect(renderCard()).toHaveClass('border')
  })

  it('draws no border when bordered is false', () => {
    const card = renderCard({ bordered: false })
    expect(card).not.toHaveClass('border')
    expect(card).toHaveClass('rounded-xl', 'bg-card')
  })

  it('keeps the hover ring and focus ring of an interactive card without a border', () => {
    const card = renderCard({ bordered: false, interactive: true })
    expect(card).not.toHaveClass('border')
    expect(card).toHaveClass(
      'hover:ring-1',
      'hover:ring-border',
      'has-[[data-slot=card-target]:focus-visible]:ring-[3px]',
    )
  })

  it('is not interactive by default', () => {
    expect(renderCard()).not.toHaveClass('cursor-pointer', 'group/card')
  })
})
