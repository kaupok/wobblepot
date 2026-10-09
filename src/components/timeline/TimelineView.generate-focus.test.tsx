import { afterEach, describe, it, expect, vi } from 'vitest'
// `useLocale()` requires the real next-intl context.
vi.unmock('next-intl')
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { markFirstPlanGenerated, takeFirstPlanGenerated } from '@/lib/first-plan-focus'
import { TimelineView } from './TimelineView'
import type { PlanEntry, ExpectedMealTypes } from '@/components/meal-plan/types'

// After a generation the Generate button can leave the page, so a day heading
// takes focus (HON-1139). The real day cards are under test; the fill bar is
// reduced to its Generate button, which reports a successful fill.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/components/meal-plan/MealCard', () => ({
  MealCard: ({ meal }: { meal: { name: string } }) => <div>{meal.name}</div>,
}))

vi.mock('./FillDaysAction', () => ({
  FillDaysAction: ({
    startDate,
    onFilled,
  }: {
    startDate: string
    onFilled?: (startDate: string) => void
  }) => <button onClick={() => onFilled?.(startDate)}>Generate</button>,
}))
vi.mock('./UrgentShopping', () => ({ UrgentShopping: () => null }))

const TODAY = '2026-03-29'

function dinnerOn(date: string): PlanEntry {
  return {
    id: `e-${date}`,
    date,
    mealType: 'dinner',
    status: 'planned',
    rating: null,
    meal: {
      id: `m-${date}`,
      name: `Dinner ${date}`,
      kidFriendly: true,
      components: [],
      nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
    },
    preparationTips: null,
    note: null,
    servingOverride: null,
  }
}

/** Dinners from today for `count` days. The window is today plus 14 days. */
function dinners(count: number): PlanEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(2026, 2, 29 + i)
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return dinnerOn(iso)
  })
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

// Today and tomorrow are planned, so the fill starts on Tuesday Mar 31.
const firstFilledHeading = () => screen.getByRole('heading', { level: 2, name: /Mar 31/ })

describe('TimelineView after a fill', () => {
  it('focuses the first filled day when the fill plans the last empty day', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline(dinners(2))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    refreshWith(dinners(15))

    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    expect(firstFilledHeading()).toHaveFocus()
  })

  it('leaves focus on Generate when the fill leaves empty days', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline(dinners(2))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    refreshWith(dinners(9))

    expect(screen.getByRole('button', { name: 'Generate' })).toHaveFocus()
  })

  it('does not focus before the refresh lands', async () => {
    const user = userEvent.setup()
    renderTimeline(dinners(2))

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(firstFilledHeading()).not.toHaveFocus()
  })

  it('focuses the heading once, not again on a later refresh', async () => {
    const user = userEvent.setup()
    const { refreshWith } = renderTimeline(dinners(2))

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    refreshWith(dinners(15))
    act(() => firstFilledHeading().blur())
    refreshWith(dinners(15))

    expect(document.body).toHaveFocus()
  })

  it('keeps the heading out of the tab order', () => {
    renderTimeline(dinners(2))
    expect(firstFilledHeading()).toHaveAttribute('tabindex', '-1')
  })
})

describe('TimelineView after the first plan', () => {
  afterEach(() => sessionStorage.clear())

  it('focuses the first day heading and clears the signal', () => {
    markFirstPlanGenerated()
    renderTimeline(dinners(7))

    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toHaveFocus()
    expect(takeFirstPlanGenerated()).toBe(false)
  })

  it('does not move focus on a normal load', () => {
    renderTimeline(dinners(7))

    expect(document.body).toHaveFocus()
  })
})
