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
    <MealDetail meal={meal} householdServings={4} onToggleAvailability={vi.fn()} {...props} />,
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
  it('keeps the checkboxes but shows no status or missing styling on a staples-only pantry', () => {
    renderDetail({ pantryIngredients: staplesOnly })

    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByText(/to buy/)).not.toBeInTheDocument()
    expect(missingRows()).toHaveLength(0)
  })

  it('shows the status and missing styling once the pantry holds a non-staple', () => {
    renderDetail({
      pantryIngredients: [...staplesOnly, { ingredientId: 'chicken-thigh', isStaple: false }],
    })

    // Plain text after the heading in the warning tone, not a pill (HON-1025).
    const status = screen.getByText('2 to buy')
    expect(status).toHaveClass('text-warning')
    expect(status.closest('[data-slot="badge"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
    expect(missingRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Potato'),
      expect.stringContaining('Lemon'),
    ])
  })

  it('turns the status on as soon as an ingredient is ticked, before the refresh', () => {
    const { rerender } = renderDetail({ pantryIngredients: staplesOnly })
    expect(screen.queryByText(/to buy/)).not.toBeInTheDocument()

    rerender(
      <MealDetail
        meal={meal}
        householdServings={4}
        onToggleAvailability={vi.fn()}
        pantryIngredients={staplesOnly}
        optimisticOverrides={new Map([['chicken-thigh', true]])}
      />,
    )

    expect(screen.getByText('2 to buy')).toBeInTheDocument()
    expect(missingRows()).toHaveLength(2)
  })

  it('drops the status again when the only non-staple is unticked', () => {
    renderDetail({
      pantryIngredients: [...staplesOnly, { ingredientId: 'chicken-thigh', isStaple: false }],
      optimisticOverrides: new Map([['chicken-thigh', false]]),
    })

    expect(screen.queryByText(/to buy/)).not.toBeInTheDocument()
    expect(missingRows()).toHaveLength(0)
  })
})

describe('MealDetail prep time', () => {
  it('shows the time as a surface badge with a clock, after Kid-friendly (HON-951, HON-1025)', () => {
    renderDetail({ pantryIngredients: [] })

    const time = screen.getByText('45 min')
    const badge = time.closest('[data-slot="badge"]')
    expect(badge).toHaveAttribute('data-variant', 'surface')
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const kidFriendly = screen.getByText('Kid-friendly').closest('[data-slot="badge"]')!
    expect(kidFriendly.compareDocumentPosition(badge!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('renders a zero-minute meal exactly like one with no prep time, with no stray "0" (HON-711)', () => {
    const renderWith = (timeMinutes: number | null) =>
      render(
        <MealDetail
          meal={{ ...meal, timeMinutes }}
          householdServings={4}
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

describe('MealDetail badge row icons (HON-1023)', () => {
  function renderMeal(overrides: Partial<typeof meal>) {
    return render(
      <MealDetail
        meal={{ ...meal, ...overrides }}
        householdServings={4}
        pantryIngredients={[]}
        onToggleAvailability={vi.fn()}
      />,
    )
  }

  it('shows Kid-friendly as the icon pill at lg, with the label for screen readers', () => {
    renderMeal({ kidFriendly: true })

    const label = screen.getByText('Kid-friendly')
    expect(label).toHaveClass('sr-only')
    const pill = label.closest('[data-slot="badge"]')!
    expect(pill).toHaveAttribute('data-variant', 'secondary')
    expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps "My recipe" out of the badge row; the title carries it', () => {
    renderMeal({ isCustom: true })

    expect(screen.queryByText('My recipe')).toBeNull()
    expect(screen.queryByRole('button', { name: 'My recipe' })).toBeNull()
  })

  it('keeps the badge row for Serves alone when there is no time and no kid-friendly flag', () => {
    renderMeal({ isCustom: true, timeMinutes: null, kidFriendly: false })

    const row = screen.getByTestId('cook-view-badges')
    expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
    expect(row).toHaveTextContent(/^Serves 4$/)
  })
})

describe('MealDetail Serves badge (HON-1025)', () => {
  const badges = () =>
    Array.from(screen.getByTestId('cook-view-badges').querySelectorAll('[data-slot="badge"]'))

  it('puts Kid-friendly, the time and Serves in one row, in that order', () => {
    render(
      <MealDetail
        meal={{ ...meal, kidFriendly: true }}
        householdServings={4}
        servings={4}
        onServingsChange={vi.fn(async () => true)}
      />,
    )

    const [kidFriendly, time, serves] = badges()
    expect(kidFriendly).toHaveTextContent('Kid-friendly')
    expect(time).toHaveTextContent('45 min')
    expect(serves).toBe(screen.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    expect(serves).toHaveAttribute('data-variant', 'surface')
    expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
  })

  it("shows a completed entry's servings as a static badge with no pencil", () => {
    const onServingsChange = vi.fn(async () => true)
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        status="completed"
        servings={6}
        onServingsChange={onServingsChange}
      />,
    )

    const serves = badges().at(-1)!
    expect(serves.tagName).toBe('SPAN')
    expect(serves).toHaveTextContent(/^Serves 6$/)
    expect(serves.querySelector('svg')).toBeNull()
    expect(screen.queryByRole('button', { name: /serves/i })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
  })
})

// Two adults and a toddler at 0.5× cook for 2.5 servings, not 3 (HON-1040).
describe('MealDetail with fractional household servings', () => {
  it('shows Serves 2.5 and scales the ingredients by 2.5', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={2.5}
        servings={2.5}
        onServingsChange={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByRole('button', { name: 'Serves 2.5. Click to edit.' })).toBeInTheDocument()
    const chicken = ingredientRows().find((row) => row.textContent?.includes('Chicken thigh'))
    expect(chicken).toHaveTextContent('375g') // 150g × 2.5
  })
})

describe('MealDetail cook view layout (HON-932)', () => {
  const nutritionMeal = {
    ...meal,
    nutrition: { calories: 520, protein: 38, carbs: 42, fat: 18 },
  }
  const follows = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('orders title, ingredients, nutrition and steps in the DOM, as on screen', () => {
    render(
      <MealDetail
        meal={nutritionMeal}
        householdServings={4}
        title={<h2>Lemon chicken</h2>}
        onHowToPrepare={vi.fn()}
      />,
    )

    const title = screen.getByRole('heading', { name: 'Lemon chicken' })
    const ingredients = screen.getByRole('heading', { name: /^Ingredients/ })
    const steps = screen.getByTestId('cook-view-steps')
    const nutrition = screen.getByTestId('cook-view-nutrition')
    expect(follows(title, ingredients)).toBe(true)
    expect(follows(ingredients, nutrition)).toBe(true)
    expect(follows(nutrition, steps)).toBe(true)
    // No `order-*` reshuffle: the DOM order is the visual order in both
    // layouts, so on a phone the view ends on the steps (HON-965).
    expect(nutrition.className).not.toMatch(/(^|\s|:)order-/)
    expect(screen.getByTestId('cook-view-left')).toHaveClass('contents', 'lg:flex')
    // The disclaimer stays visible, directly under the macros (HON-466).
    expect(nutrition.lastElementChild).toHaveTextContent(/estimate|medical/i)
  })

  it('shows the How to prepare button until tips are asked for', () => {
    const onHowToPrepare = vi.fn()
    render(<MealDetail meal={meal} householdServings={4} onHowToPrepare={onHowToPrepare} />)

    screen.getByRole('button', { name: 'How to prepare' }).click()
    expect(onHowToPrepare).toHaveBeenCalledOnce()
    expect(screen.queryByText(/You'll need/)).not.toBeInTheDocument()
  })

  it('puts the equipment at the top of the steps area, directly above Steps', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        onHowToPrepare={vi.fn()}
        isTipsExpanded
        tips={{ equipment: ['Sheet pan', 'Tongs'], steps: ['Roast it'], pitfalls: [] }}
      />,
    )

    const equipment = screen.getByRole('list', { name: "You'll need" })
    expect(within(equipment).getAllByRole('listitem')).toHaveLength(2)
    const steps = screen.getByTestId('cook-view-steps')
    expect(steps).toContainElement(equipment)
    expect(screen.getByTestId('cook-view-left')).not.toContainElement(equipment)
    // The same level as Steps (HON-966).
    const heading = screen.getByRole('heading', { level: 3, name: "You'll need" })
    const stepsHeading = within(steps).getByRole('heading', { level: 3, name: 'Steps' })
    expect(heading.parentElement?.nextElementSibling).toBe(stepsHeading)
    expect(within(steps).getByText('Roast it')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How to prepare' })).not.toBeInTheDocument()
  })

  it('renders nothing above Steps while the steps generate', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        onHowToPrepare={vi.fn()}
        isTipsExpanded
        isLoadingTips
      />,
    )

    const body = screen.getByTestId('cook-view-steps-body')
    expect(body.firstElementChild).toBe(screen.getByRole('heading', { name: 'Steps' }))
  })

  it('puts the hero in the steps column, first on a phone (HON-966)', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        image={<div role="img" aria-label="Lemon chicken" />}
        title={<h2>Lemon chicken</h2>}
        onHowToPrepare={vi.fn()}
      />,
    )

    const steps = screen.getByTestId('cook-view-steps')
    const hero = screen.getByRole('img', { name: 'Lemon chicken' })
    expect(steps.firstElementChild).toContainElement(hero)
    // Below `lg` both columns are `contents`, and the hero moves to the front.
    expect(steps).toHaveClass('contents', 'lg:flex')
    expect(steps.firstElementChild).toHaveClass('order-first', 'lg:order-none')
    // From `lg` the title starts its column; with a hero, "Steps" needs no
    // top padding of its own.
    expect(screen.getByTestId('cook-view-steps-body')).not.toHaveClass('lg:pt-8')
    expect(
      screen.getByRole('heading', { name: 'Lemon chicken' }).closest('.lg\\:pt-8'),
    ).not.toBeNull()
  })

  it('pads the steps to the title line without a hero (HON-951)', () => {
    render(<MealDetail meal={meal} householdServings={4} onHowToPrepare={vi.fn()} />)

    expect(screen.getByTestId('cook-view-steps-body')).toHaveClass('lg:pt-8')
  })

  it('keeps the hero without a steps area', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        image={<div role="img" aria-label="Lemon chicken" />}
      />,
    )

    expect(screen.getByRole('img', { name: 'Lemon chicken' })).toBeInTheDocument()
    expect(screen.queryByTestId('cook-view-steps-body')).not.toBeInTheDocument()
  })

  it('puts the title actions on the title row', () => {
    render(
      <MealDetail
        meal={meal}
        householdServings={4}
        title={<h2>Lemon chicken</h2>}
        titleActions={<button type="button">More actions: Lemon chicken</button>}
      />,
    )

    const title = screen.getByRole('heading', { name: 'Lemon chicken' })
    const actions = screen.getByRole('button', { name: 'More actions: Lemon chicken' })
    const row = title.parentElement?.parentElement
    expect(row).toHaveClass('flex', 'justify-between')
    expect(row).toContainElement(actions)
    expect(actions.parentElement).toHaveClass('shrink-0')
  })

  it('renders the household notes in the steps area before tips are asked for', () => {
    render(
      <MealDetail
        meal={{ ...meal, preparationNotes: 'Broil the last two minutes' }}
        householdServings={4}
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
        householdServings={4}
        pantryIngredients={[{ ingredientId: 'chicken-thigh', isStaple: false }]}
        onToggleAvailability={onToggleAvailability}
      />,
    )

    // The name, not the checkbox: the row is the checkbox's label.
    screen.getByText('Potato').click()
    expect(onToggleAvailability).toHaveBeenCalledExactlyOnceWith('potato', true)
  })

  it('puts the quantity before the name', () => {
    render(<MealDetail meal={meal} householdServings={4} pantryIngredients={[]} />)
    const row = ingredientRows()[0]!
    expect(row.textContent).toMatch(/^\d[\d,.]*\s?(g|\b)/)
  })
})

describe('MealDetail Done cooking (HON-933)', () => {
  it('renders Done cooking only when the caller passes the handler', async () => {
    const onDoneCooking = vi.fn()
    const { rerender } = render(
      <MealDetail meal={meal} householdServings={4} onHowToPrepare={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Done cooking' })).not.toBeInTheDocument()

    rerender(
      <MealDetail
        meal={meal}
        householdServings={4}
        onHowToPrepare={vi.fn()}
        onDoneCooking={onDoneCooking}
      />,
    )
    screen.getByRole('button', { name: 'Done cooking' }).click()
    expect(onDoneCooking).toHaveBeenCalledTimes(1)
  })
})
