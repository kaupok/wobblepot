import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMeal } from '@/stories/fixtures'
import { MealDetail } from './MealDetail'
import type { PantryIngredient } from './types'

// Chicken thigh, potato, lemon and garlic.
const meal = createMeal()
const staplesOnly: PantryIngredient[] = [{ ingredientId: 'garlic', isStaple: true }]

function renderDetail(props: {
  pantryIngredients: PantryIngredient[]
  optimisticOverrides?: Map<string, boolean>
}) {
  return render(
    <MealDetail meal={meal} householdSize={4} onToggleAvailability={vi.fn()} {...props} />,
  )
}

function ingredientRows() {
  return within(screen.getByRole('list')).getAllByRole('listitem')
}

function missingRows() {
  return ingredientRows().filter((row) => row.classList.contains('text-warning'))
}

// A staples-only pantry is one the household has never filled in (HON-769), so
// meal detail keeps the checkboxes but claims nothing is missing (HON-824).
describe('MealDetail availability', () => {
  it('keeps the checkboxes but shows no badge or missing styling on a staples-only pantry', () => {
    renderDetail({ pantryIngredients: staplesOnly })

    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByText(/ingredients? to buy/)).not.toBeInTheDocument()
    expect(missingRows()).toHaveLength(0)
  })

  it('shows the badge and missing styling once the pantry holds a non-staple', () => {
    renderDetail({
      pantryIngredients: [...staplesOnly, { ingredientId: 'chicken-thigh', isStaple: false }],
    })

    expect(screen.getByText('2 ingredients to buy')).toBeInTheDocument()
    expect(missingRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Potato'),
      expect.stringContaining('Lemon'),
    ])
  })

  it('turns the badge on as soon as an ingredient is ticked, before the refresh', () => {
    const { rerender } = renderDetail({ pantryIngredients: staplesOnly })
    expect(screen.queryByText(/ingredients? to buy/)).not.toBeInTheDocument()

    rerender(
      <MealDetail
        meal={meal}
        householdSize={4}
        onToggleAvailability={vi.fn()}
        pantryIngredients={staplesOnly}
        optimisticOverrides={new Map([['chicken-thigh', true]])}
      />,
    )

    expect(screen.getByText('2 ingredients to buy')).toBeInTheDocument()
    expect(missingRows()).toHaveLength(2)
  })

  it('drops the badge again when the only non-staple is unticked', () => {
    renderDetail({
      pantryIngredients: [...staplesOnly, { ingredientId: 'chicken-thigh', isStaple: false }],
      optimisticOverrides: new Map([['chicken-thigh', false]]),
    })

    expect(screen.queryByText(/ingredients? to buy/)).not.toBeInTheDocument()
    expect(missingRows()).toHaveLength(0)
  })
})

describe('MealDetail prep time', () => {
  it('renders a zero-minute meal exactly like one with no prep time, with no stray "0" (HON-711)', () => {
    const renderWith = (timeMinutes: number | null) =>
      render(
        <MealDetail
          meal={{ ...meal, timeMinutes }}
          householdSize={4}
          pantryIngredients={[]}
          onToggleAvailability={vi.fn()}
        />,
      )
    const zero = renderWith(0)
    const zeroHtml = zero.container.innerHTML
    zero.unmount()

    expect(zeroHtml).toBe(renderWith(null).container.innerHTML)
  })
})
