import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMeal } from '@/stories/fixtures'
import { track } from '@/lib/analytics'
import { MealCard } from './MealCard'
import type { PantryIngredient, StructuredTips } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The list is not under test here; a stub keeps the selector free of
// suggestion fixtures.
vi.mock('@/components/meal-plan/meal-selector/AlternativesList', () => ({
  AlternativesList: () => <div>alternatives</div>,
}))

const meal = createMeal()

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(props: {
  meal: typeof meal | null
  pantryIngredients?: PantryIngredient[]
  pantryDeducted?: boolean
  preparationTips?: StructuredTips | null
}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        mealType="dinner"
        status="planned"
        householdSize={4}
        {...props}
      />
    </Wrapper>,
  )
}

async function dismissSelector() {
  const dialog = await screen.findByRole('dialog')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

// The selector opens from state with no `DialogTrigger`, so Radix alone would
// leave focus on the page body when it closes (HON-804).
describe('MealCard selector focus', () => {
  it('returns focus to the more-actions trigger when Swap is dismissed', async () => {
    const user = userEvent.setup()
    renderCard({ meal })

    const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Swap' }))

    await dismissSelector()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('returns focus to "Add meal" when the selector is dismissed', async () => {
    const user = userEvent.setup()
    renderCard({ meal: null })

    const addMeal = screen.getByRole('button', { name: 'Add meal' })
    await user.click(addMeal)

    await dismissSelector()
    await waitFor(() => expect(addMeal).toHaveFocus())
  })
})

// Every household starts with salt, pepper and water as staples (HON-769), so a
// staples-only pantry is one the household has never filled in (HON-824).
describe('MealCard availability badge', () => {
  const garlicStaple = { ingredientId: 'garlic', isStaple: true }

  it('shows no badge when the pantry holds only staples', () => {
    renderCard({ meal, pantryIngredients: [garlicStaple] })

    expect(screen.queryByText(/ingredients? to buy/)).not.toBeInTheDocument()
    expect(screen.queryByText('Have all ingredients')).not.toBeInTheDocument()
  })

  it('counts the missing ingredients once the pantry holds a non-staple', () => {
    renderCard({
      meal,
      pantryIngredients: [garlicStaple, { ingredientId: 'chicken-thigh', isStaple: false }],
    })

    // Potato and lemon: garlic is a staple, chicken is on hand.
    expect(screen.getByText('2 ingredients to buy')).toBeInTheDocument()
  })
})

// "Done cooking" in the cook view runs the status select's completion: the
// deduction preview (or a direct completion when already charged), then the
// rating prompt, with focus back on the card (HON-933).
describe('MealCard Done cooking', () => {
  const tips: StructuredTips = {
    equipment: [],
    steps: ['Roast the chicken'],
    pitfalls: [],
  }

  beforeEach(() => {
    vi.mocked(track).mockClear()
  })

  async function doneCooking(user: ReturnType<typeof userEvent.setup>) {
    const name = screen.getByRole('button', { name: meal.name })
    await user.click(name)
    await user.click(await screen.findByRole('button', { name: 'Done cooking' }))
    return name
  }

  it('closes the view, then confirms the deduction and asks for a rating', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as completed' })
    // Never stacked: the cook view is gone by the time the deduction opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.click(within(deduction).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('How was it?')).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveFocus())

    expect(fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', deductPantry: true }),
      }),
    )
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'cook_view',
    })
  })

  it('returns focus to the meal name when the deduction is cancelled', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as completed' })
    await user.click(within(deduction).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(name).toHaveFocus())
  })

  it('completes directly when the pantry was already charged', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips, pantryDeducted: true })

    await doneCooking(user)
    expect(await screen.findByText('How was it?')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Mark as completed' })).not.toBeInTheDocument()
  })
})
