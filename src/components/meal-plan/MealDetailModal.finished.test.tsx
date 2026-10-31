import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMeal } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { MealDetailModal } from './MealDetailModal'
import type { MealStatus, PantryIngredient } from './types'

// The cook view of a cooked or skipped entry (HON-1504), with the real
// `MealDetail`: the meal is history, so no pantry checkboxes, missing styling
// or "N to buy".

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('@/hooks/use-member-portions', () => ({ useMemberPortions: vi.fn(() => undefined) }))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

// Chicken thigh, potato, lemon and garlic.
const meal = createMeal()
// Everything but the potato.
const pantry: PantryIngredient[] = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'lemon', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function modal(status: MealStatus) {
  return (
    <MealDetailModal
      meal={meal}
      householdServings={4}
      status={status}
      open
      onOpenChange={vi.fn()}
      planId="plan-1"
      entryId="entry-1"
      pantryIngredients={pantry}
      initialSteps={{ steps: ['Roast it'], pitfalls: [] }}
    />
  )
}

function renderModal(status: MealStatus) {
  const { wrapper } = createQueryWrapper()
  return render(modal(status), { wrapper })
}

function missingRows() {
  return screen.getAllByRole('listitem').filter((row) => row.classList.contains('text-warning'))
}

describe('MealDetailModal on a finished entry (HON-1504)', () => {
  it.each(['completed', 'skipped'] as const)(
    'shows a %s entry’s ingredients with no checkbox, missing styling or "to buy"',
    (status) => {
      renderModal(status)

      expect(screen.getByText('Potato')).toBeInTheDocument()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      expect(screen.queryByText(/to buy/)).not.toBeInTheDocument()
      expect(missingRows()).toHaveLength(0)
    },
  )

  it('keeps the checkboxes, missing styling and "to buy" on a planned entry', () => {
    renderModal('planned')

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByText('1 to buy')).toBeInTheDocument()
    expect(missingRows()).toHaveLength(1)
  })

  it('shows the checkboxes again when an undo puts the entry back to planned', () => {
    const { rerender } = renderModal('completed')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)

    rerender(modal('planned'))

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByText('1 to buy')).toBeInTheDocument()
  })
})
