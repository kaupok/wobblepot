import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { track } from '@/lib/analytics'
import { createMeal, lemonGarlicChickenPantryItems } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { MealCard } from './MealCard'
import type { PreparationSteps } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

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
  meal: typeof meal
  pantryDeducted?: boolean
  preparationTips?: PreparationSteps | null
}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-10"
        mealType="dinner"
        status="planned"
        householdServings={4}
        // The meal's chicken is in the pantry, so a completion has a deduction to preview.
        pantryItems={lemonGarlicChickenPantryItems}
        {...props}
      />
    </Wrapper>,
  )
}

/**
 * A cooked card's rating sits inside the Cooked badge (HON-1589): two thumbs
 * in the pill, and no "How was it?" strip or "Rate" row below the card.
 */
async function expectCookedPill() {
  const up = await screen.findByRole('button', { name: 'Thumbs up' })
  expect(up.closest('[data-slot="badge"]')).toHaveTextContent('Cooked')
  expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.queryByText('How was it?')).not.toBeInTheDocument()
  expect(screen.queryByText('Rate')).not.toBeInTheDocument()
}

// "Done cooking" in the cook view runs the status select's completion: the
// deduction preview (or a direct completion when already charged), then the
// Cooked badge with its rating thumbs, with focus back on the card (HON-933,
// HON-1589).
describe('MealCard Done cooking', () => {
  const tips: PreparationSteps = {
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

  it('closes the view, then confirms the deduction and shows the rating thumbs', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    // Never stacked: the cook view is gone by the time the deduction opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.click(within(deduction).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await expectCookedPill()
    await waitFor(() => expect(name).toHaveFocus())

    expect(fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', deductPantry: true, usedUpIngredientIds: [] }),
      }),
    )
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'cook_view',
      used_up_count: 0,
      // The fixture pantry's staple is a row too (HON-1588).
      some_left_count: 2,
      low_count: 0,
      staple_rows: 1,
    })
  })

  it('returns focus to the meal name when the deduction is cancelled', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    await user.click(within(deduction).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(name).toHaveFocus())
  })

  it('can be undone from the card menu on a day that is not past', async () => {
    const tipsUrl = '/api/meal-plans/plan-1/entries/entry-1/preparation-tips'
    const fresh: PreparationSteps = {
      equipment: [],
      steps: ['Roast the chicken again'],
      pitfalls: [],
    }
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        new Response(JSON.stringify(input === tipsUrl ? { tips: fresh } : { ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips, pantryDeducted: true })

    await doneCooking(user)
    await expectCookedPill()

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not cooked yet' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Thumbs up' })).not.toBeInTheDocument(),
    )
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'planned', deductPantry: false }),
      }),
    )
    // Planned again: the cook view offers Done cooking once more. Leaving
    // `completed` nulled the cached tips server-side, so the view drops its
    // seeded copy and writes fresh steps rather than showing the old ones.
    await user.click(screen.getByRole('button', { name: meal.name }))
    expect(await screen.findByRole('button', { name: 'Done cooking' })).toBeInTheDocument()
    expect(await screen.findByText('Roast the chicken again')).toBeInTheDocument()
    expect(screen.queryByText('Roast the chicken')).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === tipsUrl)).toHaveLength(1)
  })

  it('completes directly when the pantry was already charged', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips, pantryDeducted: true })

    await doneCooking(user)
    await expectCookedPill()
    expect(screen.queryByRole('dialog', { name: 'Mark as cooked' })).not.toBeInTheDocument()
  })
})
