import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimelineView } from './TimelineView'
import type { PlanEntry, ExpectedMealTypes } from '@/components/meal-plan/types'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

// Mock child components to isolate unit logic
vi.mock('./TimelineDayCard', () => ({
  TimelineDayCard: vi.fn(({ day }) => (
    <div data-testid={`day-card-${day.date}`}>
      {day.label} - {day.entries.length} entries, {day.emptySlots.length} empty
    </div>
  )),
}))

vi.mock('./TimelinePastSection', () => ({
  TimelinePastSection: vi.fn(({ days }) => (
    <div data-testid="past-section">{days.length} past days</div>
  )),
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
    render(<TimelineView {...defaultProps} />)

    // Past section is always rendered (shows 0 days if empty)
    expect(screen.getByTestId('past-section')).toBeInTheDocument()

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

    render(<TimelineView {...defaultProps} entries={entries} />)

    // Today (Mar 29) should have 1 entry
    expect(screen.getByTestId('day-card-2026-03-29')).toHaveTextContent('1 entries')
    // Tomorrow (Mar 30) should have 1 entry
    expect(screen.getByTestId('day-card-2026-03-30')).toHaveTextContent('1 entries')
  })

  it('computes empty slots from expected meal types', () => {
    // No entries, so all expected slots should be empty
    render(<TimelineView {...defaultProps} />)

    // Today expects dinner (Sunday = weekend), should have 1 empty slot
    expect(screen.getByTestId('day-card-2026-03-29')).toHaveTextContent('0 entries, 1 empty')
  })

  it('shows fill days action when there are empty future slots', () => {
    render(<TimelineView {...defaultProps} />)

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

    render(<TimelineView {...defaultProps} entries={entries} />)

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

    render(<TimelineView {...defaultProps} entries={entries} />)

    // Past section should have days
    expect(screen.getByTestId('past-section')).toHaveTextContent('7 past days')

    // Past entry date should NOT be in the future day cards
    expect(screen.queryByTestId('day-card-2026-03-27')).not.toBeInTheDocument()
  })
})
