import { describe, it, expect, vi } from 'vitest'
// `useLocale()` requires the real next-intl context.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { TimelineView } from './TimelineView'
import type { PlanEntry, ExpectedMealTypes } from '@/components/meal-plan/types'

// After Clear the card unmounts and focus with it, so the slot that replaces
// it takes focus (HON-1123). The real day card and slot are under test; the
// card is reduced to the button that clears it.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/components/meal-plan/MealCard', () => ({
  MealCard: ({ meal, onCleared }: { meal: { name: string }; onCleared?: () => void }) => (
    <button onClick={onCleared}>Clear {meal.name}</button>
  ),
}))

vi.mock('./FillDaysAction', () => ({ FillDaysAction: () => null }))
vi.mock('./UrgentShopping', () => ({ UrgentShopping: () => null }))

const TODAY = '2026-03-29'

const dinner: PlanEntry = {
  id: 'e1',
  date: TODAY,
  mealType: 'dinner',
  status: 'planned',
  rating: null,
  meal: {
    id: 'm1',
    name: 'Chicken Rice',
    kidFriendly: true,
    components: [],
    nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
  },
  preparationTips: null,
  note: null,
  servingOverride: null,
}

const props = {
  planId: 'plan-1',
  expectedMealTypes: {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  } as ExpectedMealTypes,
  householdServings: 3,
  pantryIngredients: [],
  pantryItems: [],
  shoppingItems: [],
  todayDate: TODAY,
}

function renderTimeline() {
  const { wrapper: Wrapper } = createQueryWrapper()
  const view = (entries: PlanEntry[]) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Wrapper>
        <TimelineView {...props} entries={entries} />
      </Wrapper>
    </NextIntlClientProvider>
  )
  const { rerender } = render(view([dinner]))
  return { refreshWith: (entries: PlanEntry[]) => rerender(view(entries)) }
}

describe('TimelineView after a clear', () => {
  // Today's only meal: clearing it moves Today from the planned run to the
  // empty days, which remounts its day card.
  it("focuses the cleared meal's empty slot once the refresh lands", async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline()

    await user.click(screen.getByRole('button', { name: 'Clear Chicken Rice' }))
    refreshWith([])

    expect(screen.getByRole('button', { name: 'Dinner: pick a meal, Today' })).toHaveFocus()
  })

  it('focuses the slot once, not again when it remounts later', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline()

    await user.click(screen.getByRole('button', { name: 'Clear Chicken Rice' }))
    refreshWith([])
    // Undo brings the meal back, and a later clear elsewhere empties the slot again.
    refreshWith([dinner])
    refreshWith([])

    expect(screen.getByRole('button', { name: 'Dinner: pick a meal, Today' })).not.toHaveFocus()
  })
})
