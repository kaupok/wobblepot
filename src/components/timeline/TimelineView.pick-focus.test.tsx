import { describe, it, expect, vi } from 'vitest'
// `useLocale()` requires the real next-intl context.
vi.unmock('next-intl')
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { TimelineView } from './TimelineView'
import type { PlanEntry, ExpectedMealTypes } from '@/components/meal-plan/types'

// "Pick for me" fills a slot with no dialog, and the control it was chosen
// from leaves with the refresh, so the day heading takes focus, as after a
// fill (HON-1248). The real day cards are under test; the slot and the card
// are reduced to the button that reports a pick.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('./TimelineEmptySlot', () => ({
  TimelineEmptySlot: ({ mealType, onPicked }: { mealType: string; onPicked?: () => void }) => (
    <button onClick={onPicked}>Pick {mealType}</button>
  ),
}))

vi.mock('@/components/meal-plan/MealCard', () => ({
  MealCard: ({ meal, onPicked }: { meal: { name: string } | null; onPicked?: () => void }) =>
    meal ? <div>{meal.name}</div> : <button onClick={onPicked}>Pick for the cleared card</button>,
}))

vi.mock('./FillDaysAction', () => ({ FillDaysAction: () => null }))
vi.mock('./UrgentShopping', () => ({ UrgentShopping: () => null }))

const TODAY = '2026-03-29'
const TOMORROW = '2026-03-30'

function dinnerOn(date: string, name: string | null): PlanEntry {
  return {
    id: `e-${date}`,
    date,
    mealType: 'dinner',
    status: 'planned',
    rating: null,
    meal: name
      ? {
          id: `m-${date}`,
          name,
          kidFriendly: true,
          components: [],
          nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
        }
      : null,
    preparationTips: null,
    note: name ? null : 'Leftovers',
    servingOverride: null,
  }
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

function renderTimeline(entries: PlanEntry[]) {
  const { wrapper: Wrapper } = createQueryWrapper()
  const view = (next: PlanEntry[]) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Wrapper>
        <TimelineView {...props} entries={next} />
      </Wrapper>
    </NextIntlClientProvider>
  )
  const { rerender } = render(view(entries))
  return { refreshWith: (next: PlanEntry[]) => rerender(view(next)) }
}

// Today is planned, so tomorrow's slot is the first empty one.
const planned = [dinnerOn(TODAY, 'Chicken rice')]
const filled = [...planned, dinnerOn(TOMORROW, 'Fish pie')]
const tomorrowHeading = () => screen.getByRole('heading', { level: 2, name: 'Tomorrow' })

describe('TimelineView after Pick for me', () => {
  it("focuses the picked day's heading once the refresh lands", async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline(planned)

    await user.click(screen.getAllByRole('button', { name: 'Pick dinner' })[0]!)
    refreshWith(filled)

    expect(tomorrowHeading()).toHaveFocus()
  })

  it('does not focus before the refresh lands', async () => {
    const user = userEvent.setup()
    renderTimeline(planned)

    await user.click(screen.getAllByRole('button', { name: 'Pick dinner' })[0]!)

    expect(tomorrowHeading()).not.toHaveFocus()
  })

  it('focuses the heading once, not again on a later refresh', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline(planned)

    await user.click(screen.getAllByRole('button', { name: 'Pick dinner' })[0]!)
    refreshWith(filled)
    act(() => tomorrowHeading().blur())
    refreshWith([...filled])

    expect(document.body).toHaveFocus()
  })

  it('focuses the day heading after a pick on the cleared card', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline([...planned, dinnerOn(TOMORROW, null)])

    await user.click(screen.getByRole('button', { name: 'Pick for the cleared card' }))
    refreshWith(filled)

    expect(tomorrowHeading()).toHaveFocus()
  })
})
