import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MealImageCard } from './MealImageCard'

// HON-1364: My recipes holds the image's space while a saved recipe's image is drawn.
describe('MealImageCard while the image is generating', () => {
  function renderBottom(reserveWhileGenerating: boolean) {
    const { container } = render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'generating' }}
        layout="bottom"
        reserveWhileGenerating={reserveWhileGenerating}
        footer={<span>Foot</span>}
      >
        <p>Content</p>
      </MealImageCard>,
    )
    return container.querySelector('[data-slot="card"]') as HTMLElement
  }

  it('holds the bottom image slot with a plain muted 3:2 box when asked to', () => {
    const card = renderBottom(true)
    const box = screen.getByTestId('meal-card-image-generating')
    const [content, slot, footer] = Array.from(card.children)

    expect(content).toBe(screen.getByText('Content'))
    expect(slot).toBe(box)
    expect(footer).toBe(screen.getByText('Foot'))
    expect(box).toHaveClass('aspect-3/2', 'w-full', 'bg-muted')
    expect(box).toBeEmptyDOMElement()
    expect(box.className).not.toMatch(/animate|mask/)
    expect(card).not.toHaveAttribute('data-meal-surface')
  })

  it('shows nothing extra on a card that does not ask', () => {
    renderBottom(false)

    expect(screen.queryByTestId('meal-card-image-generating')).toBeNull()
  })

  it('shows nothing extra on a side card', () => {
    render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'generating' }}
        reserveWhileGenerating
      >
        <p>Content</p>
      </MealImageCard>,
    )

    expect(screen.queryByTestId('meal-card-image-generating')).toBeNull()
  })
})
