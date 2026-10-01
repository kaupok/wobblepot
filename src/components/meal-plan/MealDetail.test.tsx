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

describe('MealDetail cook view layout (HON-932)', () => {
  const nutritionMeal = {
    ...meal,
    nutrition: { calories: 520, protein: 38, carbs: 42, fat: 18 },
  }
  const follows = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('orders title, ingredients and steps, with nutrition last on a phone', () => {
    render(
      <MealDetail
        meal={nutritionMeal}
        householdSize={4}
        title={<h2>Lemon chicken</h2>}
        onHowToPrepare={vi.fn()}
      />,
    )

    const title = screen.getByRole('heading', { name: 'Lemon chicken' })
    const ingredients = screen.getByRole('heading', { name: /^Ingredients/ })
    const steps = screen.getByTestId('cook-view-steps')
    const nutrition = screen.getByTestId('cook-view-nutrition')
    expect(follows(title, ingredients)).toBe(true)
    expect(follows(ingredients, steps)).toBe(true)
    // In the left column in the DOM (from `lg`), and moved after the steps
    // below `lg` by `order-last` inside a `display: contents` column.
    expect(nutrition).toHaveClass('order-last', 'lg:order-none')
    expect(screen.getByTestId('cook-view-left')).toHaveClass('contents', 'lg:flex')
    // The disclaimer stays visible, directly under the macros (HON-466).
    expect(nutrition.lastElementChild).toHaveTextContent(/estimate|medical/i)
  })

  it('shows the How to prepare button until tips are asked for', () => {
    const onHowToPrepare = vi.fn()
    render(<MealDetail meal={meal} householdSize={4} onHowToPrepare={onHowToPrepare} />)

    screen.getByRole('button', { name: 'How to prepare' }).click()
    expect(onHowToPrepare).toHaveBeenCalledOnce()
    expect(screen.queryByText(/You'll need/)).not.toBeInTheDocument()
  })

  it('puts the equipment under the ingredients and the steps in the steps area', () => {
    render(
      <MealDetail
        meal={meal}
        householdSize={4}
        onHowToPrepare={vi.fn()}
        isTipsExpanded
        tips={{ equipment: ['Sheet pan', 'Tongs'], steps: ['Roast it'], pitfalls: [] }}
      />,
    )

    const equipment = screen.getByText("You'll need: Sheet pan, Tongs")
    const steps = screen.getByTestId('cook-view-steps')
    expect(steps).not.toContainElement(equipment)
    expect(within(steps).getByText('Roast it')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How to prepare' })).not.toBeInTheDocument()
  })

  it('renders the household notes in the steps area before tips are asked for', () => {
    render(
      <MealDetail
        meal={{ ...meal, preparationNotes: 'Broil the last two minutes' }}
        householdSize={4}
        onHowToPrepare={vi.fn()}
      />,
    )

    const steps = screen.getByTestId('cook-view-steps')
    expect(within(steps).getByText('Broil the last two minutes')).toBeInTheDocument()
    expect(within(steps).getByRole('button', { name: 'How to prepare' })).toBeInTheDocument()
  })
})

describe('MealDetail ingredient rows (HON-932)', () => {
  it('toggles the pantry from anywhere on the row', () => {
    const onToggleAvailability = vi.fn()
    render(
      <MealDetail
        meal={meal}
        householdSize={4}
        pantryIngredients={[{ ingredientId: 'chicken-thigh', isStaple: false }]}
        onToggleAvailability={onToggleAvailability}
      />,
    )

    // The name, not the checkbox: the row is the checkbox's label.
    screen.getByText('Potato').click()
    expect(onToggleAvailability).toHaveBeenCalledExactlyOnceWith('potato', true)
  })

  it('puts the quantity before the name', () => {
    render(<MealDetail meal={meal} householdSize={4} pantryIngredients={[]} />)
    const row = ingredientRows()[0]!
    expect(row.textContent).toMatch(/^\d[\d,.]*\s?(g|\b)/)
  })
})

describe('MealDetail Done cooking (HON-933)', () => {
  it('renders Done cooking only when the caller passes the handler', async () => {
    const onDoneCooking = vi.fn()
    const { rerender } = render(
      <MealDetail meal={meal} householdSize={4} onHowToPrepare={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Done cooking' })).not.toBeInTheDocument()

    rerender(
      <MealDetail
        meal={meal}
        householdSize={4}
        onHowToPrepare={vi.fn()}
        onDoneCooking={onDoneCooking}
      />,
    )
    screen.getByRole('button', { name: 'Done cooking' }).click()
    expect(onDoneCooking).toHaveBeenCalledTimes(1)
  })
})
