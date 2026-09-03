import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimelineDayCard } from './TimelineDayCard'
import { Header } from '@/components/header'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import enMessages from '../../../messages/en.json'
import type { TimelineDay } from '@/components/meal-plan/types'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}))

// The heading-hierarchy test below renders the real `Header`, so this file
// carries its dependencies too. `next-intl/server` resolves against the real
// English catalog, matching `header.test.tsx`; the header's three child
// components are stubbed because none of them renders a heading, and pulling
// their trees in would only make this file fragile.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => {
    const segments = namespace.split('.')
    let cursor: unknown = enMessages
    for (const segment of segments) {
      cursor = (cursor as Record<string, unknown>)?.[segment]
    }
    return (key: string) => (cursor as Record<string, string>)?.[key] ?? key
  }),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  getHasHousehold: vi.fn(),
}))

vi.mock('@/components/header-actions', () => ({
  HeaderActions: () => <div data-testid="header-actions" />,
}))

vi.mock('@/components/navigation', () => ({
  NavigationLeft: () => <nav data-testid="navigation-left" />,
  NavigationRight: () => <nav data-testid="navigation-right" />,
}))

vi.mock('@/components/mobile-nav', () => ({
  MobileNav: () => <div data-testid="mobile-nav" />,
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
  it('renders day label as a heading', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    // The day name is the Section level of the type scale, and a real heading
    // so it lands in the document outline (HON-606). Which level it lands at is
    // asserted relative to the enclosing title in the hierarchy suite below,
    // rather than restated here as a second constant (HON-619).
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
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

/**
 * The day label's enclosing title lives in neither this component nor
 * `TimelineView`: the timeline route (`/`) renders no page title of its own, so
 * the heading that anchors the day labels is the header brand
 * (`src/components/header.tsx`, `variant="h4"`, no `as`, so `<h4>`). That holds
 * identically at all three mount points — `TimelineView.tsx:185`,
 * `TimelineView.tsx:201`, and `TimelinePastSection.tsx:61`, which mount only
 * under `src/app/page.tsx` — which is why the tag is fixed in the component
 * instead of being passed per consumer. See HON-619.
 *
 * The brand is not the only heading that can *precede* a day label, though:
 * `FillDaysAction` renders `GeneratingOverlay` inline between the planned and
 * empty day cards while a fill-days generation runs, so that heading is a
 * sibling of the day labels rather than a title enclosing them. It does not
 * vary per consumer, so it does not argue for a `dayHeadingTag` prop — but it
 * does have to stay within one level of the day label, which the second test
 * below pins (PR #700 review).
 *
 * The real `Header` is rendered here because the app shell is the only place
 * that relationship exists; asserting the level anywhere else would just
 * restate `h5` as a second constant. What it guards is invisible to axe's
 * `heading-order`, which only flags increases greater than one: dropping `as`
 * renders the `section` variant's default `<h2>`, putting the day label *above*
 * the brand, and axe reads that as a legal decrease.
 */
describe('TimelineDayCard - heading hierarchy', () => {
  it('renders the day label one level below the header brand', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    render(await Header())
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)

    const brand = screen.getByRole('heading', { name: 'Wobblepot' })
    const brandLevel = Number(brand.tagName.slice(1))

    expect(
      screen.getByRole('heading', { name: 'Today', level: brandLevel + 1 }),
    ).toBeInTheDocument()
  })

  it('brackets the generating overlay it can render beside, on both sides', async () => {
    // `FillDaysAction.tsx:103` emits `<GeneratingOverlay />` between the
    // planned and empty `TimelineDayCard`s, so this is the real document order
    // for up to the 45s client timeout of every fill-days generation. With no
    // planned days the heading before the overlay is the brand itself, which is
    // the tighter of the two cases — hence rendering the header here.
    //
    // axe's `heading-order` is `currLevel - prevLevel <= 1` applied to each
    // adjacent pair, so the overlay has to clear *two* bounds and a test that
    // checks one of them is not a guard. Too shallow (`h2`) skips into the day
    // label; too deep (`h6`) skips down from the brand. Together these pin the
    // overlay to `h4`-`h5`. No story composes the three, so the axe gate cannot
    // see either side (PR #700 review).
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    render(await Header())
    render(<GeneratingOverlay />)
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)

    const level = (name: string | RegExp) =>
      Number(screen.getByRole('heading', { name }).tagName.slice(1))
    const brandLevel = level('Wobblepot')
    const overlayLevel = level('Generating your meal plan…')
    const dayLevel = level('Today')

    expect(overlayLevel - brandLevel).toBeLessThanOrEqual(1)
    expect(dayLevel - overlayLevel).toBeLessThanOrEqual(1)
  })
})
