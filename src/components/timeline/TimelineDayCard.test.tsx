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

// The heading-hierarchy tests below render the real `Header`, so this file
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
  TimelineEmptySlot: vi.fn(({ mealType, dayLabel, relativeDay }) => (
    <div data-testid={`empty-slot-${mealType}`} data-relative-day={relativeDay}>
      Empty {mealType} on {dayLabel}
    </div>
  )),
}))

const baseDay: TimelineDay = {
  date: '2026-03-29',
  label: 'Today',
  isToday: true,
  isTomorrow: false,
  entries: [],
  emptySlots: ['dinner'],
}

const defaultProps = {
  planId: 'plan-1',
  householdServings: 3,
  pantryIngredients: [],
  pantryItems: [],
  onEntryUpdated: vi.fn(),
}

function dayWithDinnerAnd(emptySlots: TimelineDay['emptySlots']): TimelineDay {
  return {
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
    emptySlots,
  }
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

  // The slot's button is named after its day (HON-807): the heading's text,
  // with the date when the day has one.
  it('passes the day to empty slots', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.getByTestId('empty-slot-dinner')).toHaveTextContent('Empty dinner on Today')
  })

  it('passes the day with its date to empty slots', () => {
    const saturday: TimelineDay = {
      ...baseDay,
      label: 'Saturday',
      dateLabel: 'Oct 3',
      isToday: false,
    }
    render(<TimelineDayCard day={saturday} {...defaultProps} />)
    expect(screen.getByTestId('empty-slot-dinner')).toHaveTextContent(
      'Empty dinner on Saturday Oct 3',
    )
  })

  // The selector's title says "today" or "tomorrow" instead of the date, as
  // the heading does (HON-941).
  it.each([
    ['today', { isToday: true, isTomorrow: false }],
    ['tomorrow', { isToday: false, isTomorrow: true }],
    [undefined, { isToday: false, isTomorrow: false, label: 'Saturday', dateLabel: 'Oct 3' }],
  ] as const)('passes relativeDay %s to empty slots', (relativeDay, overrides) => {
    render(<TimelineDayCard day={{ ...baseDay, ...overrides }} {...defaultProps} />)
    const slot = screen.getByTestId('empty-slot-dinner')
    if (relativeDay) expect(slot).toHaveAttribute('data-relative-day', relativeDay)
    else expect(slot).not.toHaveAttribute('data-relative-day')
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

  // An empty slot is a button on the heading's line, not a row in the entry
  // list, so an empty day takes one line (HON-1111).
  it('renders an empty slot in the heading row, not in the entry list', () => {
    render(<TimelineDayCard day={dayWithDinnerAnd(['breakfast'])} {...defaultProps} />)

    const headingRow = screen.getByRole('heading', { name: 'Today' }).parentElement
    const slot = screen.getByTestId('empty-slot-breakfast')
    const card = screen.getByTestId('meal-card-dinner')
    expect(headingRow).toContainElement(slot)
    expect(headingRow).not.toContainElement(card)
    // The heading row comes first, so the slot precedes the dinner card.
    expect(slot.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the button out of the heading, so the outline reads the day alone', () => {
    render(<TimelineDayCard day={dayWithDinnerAnd(['breakfast'])} {...defaultProps} />)
    const heading = screen.getByRole('heading', { name: 'Today' })
    expect(heading).not.toContainElement(screen.getByTestId('empty-slot-breakfast'))
  })

  it('orders empty slots breakfast, lunch, dinner', () => {
    const day: TimelineDay = { ...baseDay, emptySlots: ['dinner', 'breakfast', 'lunch'] }
    render(<TimelineDayCard day={day} {...defaultProps} />)

    const slots = screen.getAllByTestId(/^empty-slot-/).map((el) => el.dataset.testid)
    expect(slots).toEqual(['empty-slot-breakfast', 'empty-slot-lunch', 'empty-slot-dinner'])
  })

  it('does not show "No meals planned" when the day has only empty slots', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.queryByText('No meals planned')).not.toBeInTheDocument()
  })

  // The slot label is the card's own first row (`MealTypeBadge` inside
  // `MealCard`) and the empty slot's button text (`TimelineEmptySlot`), both
  // mocked here, so the day card renders none of its own and passes each
  // slot's `mealType` down instead.
  it('leaves the meal type label to the cards', () => {
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

    expect(screen.queryByText('Dinner')).not.toBeInTheDocument()
    expect(screen.queryByText('Breakfast')).not.toBeInTheDocument()
    expect(screen.getByTestId('meal-card-dinner')).toBeInTheDocument()
    expect(screen.getByTestId('empty-slot-breakfast')).toBeInTheDocument()
  })
})

/**
 * The timeline route (`/`) renders no page title of its own, and the header
 * wordmark is not a heading (HON-806), so the day labels open the page's
 * outline. They are `h2` — the level they keep if the route later gains an
 * `h1` — and the tag is fixed in the component rather than passed per consumer
 * because both mount points sit one level under a page `h1`: `TimelineView`'s
 * `renderDay` under `/` (a hidden h1), and `PastMealsList` under `/past-meals`.
 *
 * Until HON-806 the wordmark was an `<h4>` and these labels were `h5`, one
 * below it (HON-619). The real `Header` is still rendered here so that a
 * heading reappearing in the app shell fails this file rather than silently
 * re-parenting the day labels.
 *
 * The day labels are not the only headings near that part of the page:
 * `FillDaysAction` renders `GeneratingOverlay` between the planned and empty
 * day cards while a fill-days generation runs. The overlay is a modal dialog
 * in a portal at the end of `<body>` (HON-1130), so its heading follows the
 * page's last heading, but the second test still pins it within one level of
 * a day label before it (PR #700 review).
 */
describe('TimelineDayCard - heading hierarchy', () => {
  it('opens the outline with the day label at h2, with no heading from the header', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    render(await Header())
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)

    const [first] = screen.getAllByRole('heading')
    expect(first).toBe(screen.getByRole('heading', { name: 'Today', level: 2 }))
  })

  it('keeps the generating overlay within one level of the day label before it', async () => {
    // `FillDaysAction` emits `<GeneratingOverlay />` after the planned
    // `TimelineDayCard`s, and its portal puts the heading after a day label
    // for up to the 65s client timeout of every fill-days generation. axe's
    // `heading-order` is `currLevel - prevLevel <= 1` on each adjacent pair,
    // so an overlay deeper than `h3` skips a level after a day's `h2`. No
    // story composes the two, so the axe gate cannot see it. The modal hides
    // the page from the accessibility tree, hence `hidden: true`.
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    render(await Header())
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    render(<GeneratingOverlay />)

    const level = (name: string) =>
      Number(screen.getByRole('heading', { name, hidden: true }).tagName.slice(1))

    expect(level('Generating your meal plan…') - level('Today')).toBeLessThanOrEqual(1)
  })
})
