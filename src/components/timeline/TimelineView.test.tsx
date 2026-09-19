import { describe, it, expect, vi, afterEach } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations` and falls through to the real `useLocale`.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  TimelineDayCard: vi.fn(({ day, headerAction }) => (
    <div data-testid={`day-card-${day.date}`}>
      {day.label} - {day.entries.length} entries, {day.emptySlots.length} empty
      {headerAction}
    </div>
  )),
}))

vi.mock('./TimelinePastSection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./TimelinePastSection')>()),
  TimelinePastSection: vi.fn(({ days, expanded, ref }) =>
    expanded ? (
      <div ref={ref} data-testid="past-section">
        {days.length} past days
      </div>
    ) : null,
  ),
}))

vi.mock('./FillDaysAction', () => ({
  FillDaysAction: vi.fn(({ firstEmptyDate }) => (
    <div data-testid="fill-days">Fill from {firstEmptyDate}</div>
  )),
}))

vi.mock('./UrgentShopping', () => ({
  UrgentShopping: vi.fn(() => <div data-testid="urgent-shopping">Shopping</div>),
}))

const defaultProps = {
  entries: [] as PlanEntry[],
  planId: 'plan-1',
  expectedMealTypes: {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  } as ExpectedMealTypes,
  householdSize: 3,
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

  describe('past meals menu', () => {
    function pastEntry(id: string, date: string, status: PlanEntry['status']): PlanEntry {
      return {
        id,
        date,
        mealType: 'dinner',
        status,
        rating: null,
        meal: {
          id: `m-${id}`,
          name: `Meal ${id}`,
          kidFriendly: true,
          components: [],
          nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
        },
        preparationTips: null,
        note: null,
        servingOverride: null,
      }
    }

    const pastEntries = [
      pastEntry('p1', '2026-03-27', 'planned'),
      pastEntry('p2', '2026-03-26', 'planned'),
      pastEntry('p3', '2026-03-25', 'completed'),
    ]

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('does not render the menu when there are no past days with entries', () => {
      renderInLocale(<TimelineView {...defaultProps} />)

      expect(screen.queryByRole('button', { name: /timeline options/i })).not.toBeInTheDocument()
    })

    it('renders the menu on the Today heading only', () => {
      renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      const trigger = screen.getByRole('button', { name: /timeline options/i })
      expect(within(screen.getByTestId('day-card-2026-03-29')).getByRole('button')).toBe(trigger)
      expect(screen.getAllByRole('button', { name: /timeline options/i })).toHaveLength(1)
    })

    it('includes the catch-up count in the trigger name', () => {
      renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      expect(
        screen.getByRole('button', {
          name: 'Timeline options, 2 past meals to catch up',
        }),
      ).toBeInTheDocument()
    })

    it('omits the count from the trigger name when nothing needs catching up', () => {
      renderInLocale(
        <TimelineView {...defaultProps} entries={[pastEntry('p3', '2026-03-25', 'completed')]} />,
      )

      expect(screen.getByRole('button', { name: 'Timeline options' })).toBeInTheDocument()
    })

    it('expands past days and scrolls the first one into view', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      expect(screen.queryByTestId('past-section')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /timeline options/i }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Show past meals · 2 to catch up' }),
      )

      expect(screen.getByTestId('past-section')).toHaveTextContent('3 past days')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('past-section'))

      await user.click(screen.getByRole('button', { name: /timeline options/i }))
      await user.click(await screen.findByRole('menuitem', { name: /hide past meals/i }))

      expect(screen.queryByTestId('past-section')).not.toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    it('scrolls instantly under prefers-reduced-motion', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      )
      renderInLocale(<TimelineView {...defaultProps} entries={pastEntries} />)

      await user.click(screen.getByRole('button', { name: /timeline options/i }))
      await user.click(await screen.findByRole('menuitem', { name: /show past meals/i }))

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    })
  })
})
