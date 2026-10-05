import { describe, it, expect, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations` and falls through to the real `useLocale`.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import { TimelineView } from './TimelineView'
import type { PlanEntry, ExpectedMealTypes } from '@/components/meal-plan/types'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

function renderInLocale(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  )
}

// Mock child components to isolate unit logic
vi.mock('./TimelineDayCard', () => ({
  TimelineDayCard: vi.fn(({ day }) => (
    <div data-testid={`day-card-${day.date}`}>
      {day.label} - {day.entries.length} entries, {day.emptySlots.length} empty
    </div>
  )),
}))

vi.mock('./FillDaysAction', () => ({
  FillDaysAction: vi.fn(({ startDate }) => (
    <div data-testid="fill-days">Fill from {startDate}</div>
  )),
}))

vi.mock('./UrgentShopping', () => ({
  UrgentShopping: vi.fn(({ compact }) => (
    <div data-testid={compact ? 'urgent-shopping-compact' : 'urgent-shopping'}>Shopping</div>
  )),
}))

const defaultProps = {
  entries: [] as PlanEntry[],
  planId: 'plan-1',
  expectedMealTypes: {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  } as ExpectedMealTypes,
  householdServings: 3,
  pantryIngredients: [],
  pantryItems: [],
  shoppingItems: [],
  todayDate: '2026-03-29', // Sunday
}

describe('TimelineView', () => {
  it('renders past section and future day cards', () => {
    renderInLocale(<TimelineView {...defaultProps} />)

    // Today should be in future days
    expect(screen.getByTestId('day-card-2026-03-29')).toBeInTheDocument()

    // Shopping sidebar
    expect(screen.getByTestId('urgent-shopping')).toBeInTheDocument()
  })

  // HON-766: below lg the sidebar falls under the whole timeline, so a compact
  // copy leads the left column. CSS picks one; both are in the markup.
  it('puts the compact shopping summary above the timeline, visible only below lg', () => {
    renderInLocale(<TimelineView {...defaultProps} />)

    const compact = screen.getByTestId('urgent-shopping-compact')
    const full = screen.getByTestId('urgent-shopping')
    const today = screen.getByTestId('day-card-2026-03-29')

    expect(compact.parentElement).toHaveClass('lg:hidden')
    expect(full.parentElement).toHaveClass('hidden', 'lg:flex')
    expect(compact.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('groups entries by date correctly', () => {
    const entries: PlanEntry[] = [
      {
        id: 'e1',
        date: '2026-03-29',
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
      },
      {
        id: 'e2',
        date: '2026-03-30',
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        meal: {
          id: 'm2',
          name: 'Fish Stew',
          kidFriendly: true,
          components: [],
          nutrition: { calories: 400, protein: 25, carbs: 40, fat: 12 },
        },
        preparationTips: null,
        note: null,
        servingOverride: null,
      },
    ]

    renderInLocale(<TimelineView {...defaultProps} entries={entries} />)

    // Today (Mar 29) should have 1 entry
    expect(screen.getByTestId('day-card-2026-03-29')).toHaveTextContent('1 entries')
    // Tomorrow (Mar 30) should have 1 entry
    expect(screen.getByTestId('day-card-2026-03-30')).toHaveTextContent('1 entries')
  })

  it('computes empty slots from expected meal types', () => {
    // No entries, so all expected slots should be empty
    renderInLocale(<TimelineView {...defaultProps} />)

    // Today expects dinner (Sunday = weekend), should have 1 empty slot
    expect(screen.getByTestId('day-card-2026-03-29')).toHaveTextContent('0 entries, 1 empty')
  })

  it('shows fill days action when there are empty future slots', () => {
    renderInLocale(<TimelineView {...defaultProps} />)

    // Empty slots exist, so fill days action should show
    expect(screen.getByTestId('fill-days')).toBeInTheDocument()
  })

  it('hides fill days action when all future slots are filled', () => {
    // Create entries for every future day in the range (14 days)
    const entries: PlanEntry[] = []
    const start = new Date(2026, 2, 22) // 7 days before today
    for (let i = 0; i < 22; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      entries.push({
        id: `e-${i}`,
        date: dateStr,
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        meal: {
          id: `m-${i}`,
          name: `Meal ${i}`,
          kidFriendly: true,
          components: [],
          nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
        },
        preparationTips: null,
        note: null,
        servingOverride: null,
      })
    }

    renderInLocale(<TimelineView {...defaultProps} entries={entries} />)

    // No empty future slots, so fill days action should be hidden
    expect(screen.queryByTestId('fill-days')).not.toBeInTheDocument()
  })

  describe('fill bar placement', () => {
    const breakfastAndDinner = {
      weekdayMealTypes: ['breakfast', 'dinner'],
      weekendMealTypes: ['breakfast', 'dinner'],
    } as ExpectedMealTypes

    function entry(date: string, mealType: PlanEntry['mealType'] = 'dinner'): PlanEntry {
      return {
        id: `e-${date}-${mealType}`,
        date,
        mealType,
        status: 'planned',
        rating: null,
        meal: {
          id: `m-${date}-${mealType}`,
          name: `Meal ${date}`,
          kidFriendly: true,
          components: [],
          nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
        },
        preparationTips: null,
        note: null,
        servingOverride: null,
      }
    }

    // Consecutive dates from 2026-03-29 (today) onward.
    function futureDates(count: number): string[] {
      return Array.from({ length: count }, (_, i) => {
        const date = new Date(2026, 2, 29 + i)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      })
    }

    function isBefore(a: HTMLElement, b: HTMLElement) {
      return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    }

    it('anchors after the last planned day when earlier days have empty slots', () => {
      // Today has breakfast + dinner; dinners through Thu Apr 2; breakfasts empty after today.
      const entries = [
        entry('2026-03-29', 'breakfast'),
        ...futureDates(5).map((date) => entry(date)),
      ]

      renderInLocale(
        <TimelineView {...defaultProps} expectedMealTypes={breakfastAndDinner} entries={entries} />,
      )

      const bar = screen.getByTestId('fill-days')
      expect(bar).toHaveTextContent('Fill from 2026-04-03')
      expect(isBefore(screen.getByTestId('day-card-2026-04-02'), bar)).toBe(true)
      expect(isBefore(bar, screen.getByTestId('day-card-2026-04-03'))).toBe(true)
    })

    it('anchors after Today when Today is the last planned day', () => {
      renderInLocale(<TimelineView {...defaultProps} entries={[entry('2026-03-29')]} />)

      const bar = screen.getByTestId('fill-days')
      expect(bar).toHaveTextContent('Fill from 2026-03-30')
      expect(isBefore(screen.getByTestId('day-card-2026-03-29'), bar)).toBe(true)
      expect(isBefore(bar, screen.getByTestId('day-card-2026-03-30'))).toBe(true)
    })

    it('sits above Today and starts today when no future day has an entry', () => {
      renderInLocale(<TimelineView {...defaultProps} entries={[entry('2026-03-27')]} />)

      const bar = screen.getByTestId('fill-days')
      expect(bar).toHaveTextContent('Fill from 2026-03-29')
      expect(isBefore(bar, screen.getByTestId('day-card-2026-03-29'))).toBe(true)
    })

    it('stays above a run of empty days when only a far-future day is planned', () => {
      // Only entry is on the last day of the window (today + 14).
      renderInLocale(<TimelineView {...defaultProps} entries={[entry('2026-04-12')]} />)

      const bar = screen.getByTestId('fill-days')
      expect(bar).toHaveTextContent('Fill from 2026-03-29')
      expect(isBefore(bar, screen.getByTestId('day-card-2026-03-29'))).toBe(true)
    })

    it('anchors at the end of the planned run from today, not after a later isolated entry', () => {
      const entries = [entry('2026-03-29'), entry('2026-03-30'), entry('2026-04-08')]

      renderInLocale(<TimelineView {...defaultProps} entries={entries} />)

      const bar = screen.getByTestId('fill-days')
      expect(bar).toHaveTextContent('Fill from 2026-03-31')
      expect(isBefore(screen.getByTestId('day-card-2026-03-30'), bar)).toBe(true)
      expect(isBefore(bar, screen.getByTestId('day-card-2026-03-31'))).toBe(true)
    })

    it('hides when every day in the window has an entry but slots are still empty', () => {
      // Today + 14 days = 15 days, each with dinner only; breakfasts stay empty.
      const entries = futureDates(15).map((date) => entry(date))

      renderInLocale(
        <TimelineView {...defaultProps} expectedMealTypes={breakfastAndDinner} entries={entries} />,
      )

      expect(screen.getByTestId('day-card-2026-04-12')).toHaveTextContent('1 entries, 1 empty')
      expect(screen.queryByTestId('fill-days')).not.toBeInTheDocument()
    })
  })

  it('separates past and future days correctly', () => {
    const entries: PlanEntry[] = [
      {
        id: 'e-past',
        date: '2026-03-27',
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        meal: {
          id: 'm-past',
          name: 'Past Meal',
          kidFriendly: true,
          components: [],
          nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
        },
        preparationTips: null,
        note: null,
        servingOverride: null,
      },
    ]

    renderInLocale(<TimelineView {...defaultProps} entries={entries} />)

    // Past entry date should NOT be in the future day cards
    expect(screen.queryByTestId('day-card-2026-03-27')).not.toBeInTheDocument()
  })

  // HON-1007: past days moved to /past-meals. HON-1028: the nudge to mark them
  // moved to a dot on the account menu, so Today shows neither.
  describe('past meals', () => {
    function pastEntry(
      id: string,
      date: string,
      status: PlanEntry['status'],
      withMeal = true,
    ): PlanEntry {
      return {
        id,
        date,
        mealType: 'dinner',
        status,
        rating: null,
        meal: withMeal
          ? {
              id: `m-${id}`,
              name: `Meal ${id}`,
              kidFriendly: true,
              components: [],
              nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
            }
          : null,
        preparationTips: null,
        note: null,
        servingOverride: null,
      }
    }

    const pastEntries = [
      pastEntry('p1', '2026-03-27', 'planned'),
      pastEntry('p2', '2026-03-26', 'planned'),
      pastEntry('p3', '2026-03-25', 'completed'),
      pastEntry('p4', '2026-03-24', 'planned', false),
    ]

    it('renders no past days and no menu on Today', () => {
      renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      for (const date of ['2026-03-27', '2026-03-26', '2026-03-25', '2026-03-24']) {
        expect(screen.queryByTestId(`day-card-${date}`)).not.toBeInTheDocument()
      }
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders no notice, even with past meals still to mark', () => {
      const { container } = renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      expect(container.querySelector('[data-slot="callout"]')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /past meals/i })).not.toBeInTheDocument()
    })
  })

  // One h1 per page, first in the outline, visually hidden. Named "Meal plan"
  // rather than "Today", which is the first day card's heading (HON-815).
  it('opens the page with one hidden h1', () => {
    const { container } = renderInLocale(<TimelineView {...defaultProps} />)

    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Meal plan')
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBe(h1s[0])
    expect(h1s[0]?.parentElement).toHaveClass('sr-only')
  })
})
