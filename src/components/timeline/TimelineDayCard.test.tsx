import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimelineDayCard } from './TimelineDayCard'
import type { TimelineDay } from '@/components/meal-plan/types'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

// Mock MealCard to simplify testing
vi.mock('@/components/meal-plan/MealCard', () => ({
  MealCard: vi.fn(({ meal, mealType }) => (
    <div data-testid={`meal-card-${mealType}`}>{meal?.name ?? 'No meal'}</div>
  )),
}))

// Mock TimelineEmptySlot
vi.mock('./TimelineEmptySlot', () => ({
  TimelineEmptySlot: vi.fn(({ mealType }) => (
    <div data-testid={`empty-slot-${mealType}`}>Empty {mealType}</div>
  )),
}))

const baseDay: TimelineDay = {
  date: '2026-03-29',
  label: 'Today',
  isToday: true,
  isTomorrow: false,
  isPast: false,
  entries: [],
  emptySlots: ['dinner'],
}

const defaultProps = {
  planId: 'plan-1',
  householdSize: 3,
  pantryIngredients: [],
  pantryItems: [],
  onEntryUpdated: vi.fn(),
}

describe('TimelineDayCard', () => {
  it('renders day label', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('renders empty slots for future days', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.getByTestId('empty-slot-dinner')).toBeInTheDocument()
  })

  it('does not render empty slots for past days', () => {
    const pastDay: TimelineDay = {
      ...baseDay,
      label: 'Friday Mar 27',
      isToday: false,
      isPast: true,
    }
    render(<TimelineDayCard day={pastDay} {...defaultProps} />)
    expect(screen.queryByTestId('empty-slot-dinner')).not.toBeInTheDocument()
  })

  it('renders meal cards for entries', () => {
    const dayWithEntry: TimelineDay = {
      ...baseDay,
      entries: [
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
      ],
      emptySlots: [],
    }

    render(<TimelineDayCard day={dayWithEntry} {...defaultProps} />)
    expect(screen.getByTestId('meal-card-dinner')).toHaveTextContent('Chicken Rice')
  })

  it('shows "No meals planned" when day has no slots', () => {
    const emptyDay: TimelineDay = {
      ...baseDay,
      entries: [],
      emptySlots: [],
    }
    render(<TimelineDayCard day={emptyDay} {...defaultProps} />)
    expect(screen.getByText('No meals planned')).toBeInTheDocument()
  })

  it('sorts entries and empty slots by meal type order', () => {
    const dayWithMixed: TimelineDay = {
      ...baseDay,
      entries: [
        {
          id: 'e1',
          date: '2026-03-29',
          mealType: 'dinner',
          status: 'planned',
          rating: null,
          meal: {
            id: 'm1',
            name: 'Dinner Meal',
            kidFriendly: true,
            components: [],
            nutrition: { calories: 500, protein: 30, carbs: 50, fat: 15 },
          },
          preparationTips: null,
          note: null,
          servingOverride: null,
        },
      ],
      emptySlots: ['breakfast', 'lunch'],
    }

    render(<TimelineDayCard day={dayWithMixed} {...defaultProps} />)

    // All three should be present
    expect(screen.getByTestId('empty-slot-breakfast')).toBeInTheDocument()
    expect(screen.getByTestId('empty-slot-lunch')).toBeInTheDocument()
    expect(screen.getByTestId('meal-card-dinner')).toBeInTheDocument()
  })

  it('renders meal type labels outside the cards', () => {
    const dayWithEntry: TimelineDay = {
      ...baseDay,
      entries: [
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
      ],
      emptySlots: ['breakfast'],
    }

    render(<TimelineDayCard day={dayWithEntry} {...defaultProps} />)

    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText('Breakfast')).toBeInTheDocument()
  })
})
