import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMeal } from '@/stories/fixtures'
import type { DemoMeal } from '@/lib/landing/load-demo-day'
import { DemoMealCard } from './DemoMealCard'

vi.mock('@/components/meal-plan/MealImage', () => ({ MealImage: () => null }))

const entry: DemoMeal = {
  mealType: 'lunch',
  servings: 4,
  steps: { steps: ['Cook the rice'], pitfalls: [] },
  meal: createMeal({
    id: 'm-2',
    name: 'Beef bibimbap',
    primaryProteinType: 'beef',
    kidFriendly: true,
  }),
}

function renderCard(onOpen?: () => void) {
  render(<DemoMealCard entry={entry} onOpen={onOpen} />)
  const card = document.querySelector<HTMLElement>('[data-slot="card"]')!
  return { card }
}

describe('DemoMealCard', () => {
  it('opens from the name', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderCard(onOpen)

    await user.click(screen.getByRole('button', { name: 'Beef bibimbap' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens from a click anywhere on the card, and gives the name focus', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const { card } = renderCard(onOpen)

    await user.click(card)

    expect(onOpen).toHaveBeenCalledTimes(1)
    // The cook view hands focus back to whatever had it as it opened.
    expect(screen.getByRole('button', { name: 'Beef bibimbap' })).toHaveFocus()
  })

  it('does not open from a click on the Kid-friendly badge', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const { card } = renderCard(onOpen)

    await user.click(within(card).getByText('Kid-friendly'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('marks the card interactive and the name its only keyboard target', () => {
    const { card } = renderCard(vi.fn())
    const name = screen.getByRole('button', { name: 'Beef bibimbap' })
    expect(card).toHaveClass('group/card', 'cursor-pointer', 'hover:border-border', 'hover:ring-1')
    expect(name).toHaveAttribute('data-slot', 'card-target')
    expect(name).toHaveClass('outline-none', 'group-hover/card:underline')
    expect(card).not.toHaveAttribute('role')
    expect(card).not.toHaveAttribute('tabindex')
    expect(within(card).getAllByRole('button')).toHaveLength(1)
  })

  it('draws a picture without `onOpen`: the name is text and nothing is a button', () => {
    const { card } = renderCard()
    expect(within(card).getByText('Beef bibimbap')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(card).not.toHaveClass('cursor-pointer')
  })
})
