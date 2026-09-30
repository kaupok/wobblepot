import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMeal } from '@/stories/fixtures'
import { MealCard } from './MealCard'
import type { PantryIngredient } from './types'

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

function renderCard(props: { meal: typeof meal | null; pantryIngredients?: PantryIngredient[] }) {
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

    expect(screen.queryByText(/ingredients? missing/)).not.toBeInTheDocument()
    expect(screen.queryByText('Have all ingredients')).not.toBeInTheDocument()
  })

  it('counts the missing ingredients once the pantry holds a non-staple', () => {
    renderCard({
      meal,
      pantryIngredients: [garlicStaple, { ingredientId: 'chicken-thigh', isStaple: false }],
    })

    // Potato and lemon: garlic is a staple, chicken is on hand.
    expect(screen.getByText('2 ingredients missing')).toBeInTheDocument()
  })
})
