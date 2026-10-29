import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Header } from '@/components/header'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import type { TimelineDay } from '@/components/meal-plan/types'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import { TimelineDayCard } from './TimelineDayCard'

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

// The real "+ Add" menu renders; only each slot's controller, which owns the
// requests and dialogs, is stubbed.
vi.mock('./EmptySlotController', () => ({
  EmptySlotController: vi.fn(({ mealType, relativeDay }) => (
    <div data-testid={`empty-slot-${mealType}`} data-relative-day={relativeDay} />
  )),
}))

const baseDay: TimelineDay = {
  date: '2026-03-29',
  label: 'Today',
  isToday: true,
  isTomorrow: false,
  entries: [],
  emptySlots: ['dinner'],
  extras: [],
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

  it('renders one "+ Add" button for a day with empty slots', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Add to Today' })).toHaveTextContent(/^Add$/)
    expect(screen.getByTestId('empty-slot-dinner')).toBeInTheDocument()
  })

  // The button is named after its day (HON-807): the heading's text, with the
  // date when the day has one.
  it('names the day with its date on the "+ Add" button', () => {
    const saturday: TimelineDay = {
      ...baseDay,
      label: 'Saturday',
      dateLabel: 'Oct 3',
      isToday: false,
    }
    render(<TimelineDayCard day={saturday} {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Add to Saturday Oct 3' })).toBeInTheDocument()
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

  // The "+ Add" button is on the heading's line, not a row in the entry list,
  // so an empty day takes one line (HON-1111, HON-1335).
  it('renders "+ Add" in the heading row, not in the entry list', () => {
    render(<TimelineDayCard day={dayWithDinnerAnd(['breakfast'])} {...defaultProps} />)

    const headingRow = screen.getByRole('heading', { name: 'Today' }).parentElement
    const add = screen.getByRole('button', { name: 'Add to Today' })
    const card = screen.getByTestId('meal-card-dinner')
    expect(headingRow).toContainElement(add)
    expect(headingRow).not.toContainElement(card)
    // The heading row comes first, so the button precedes the dinner card.
    expect(add.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the button out of the heading, so the outline reads the day alone', () => {
    render(<TimelineDayCard day={dayWithDinnerAnd(['breakfast'])} {...defaultProps} />)
    const heading = screen.getByRole('heading', { name: 'Today' })
    expect(heading).not.toContainElement(screen.getByRole('button', { name: 'Add to Today' }))
  })

  it('orders the menu breakfast, lunch, dinner', async () => {
    const user = userEvent.setup()
    const day: TimelineDay = { ...baseDay, emptySlots: ['dinner', 'breakfast', 'lunch'] }
    render(<TimelineDayCard day={day} {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Add to Today' }))

    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Extra'])
  })

  // Extras (HON-1309): a full day shows "+ Extra" alone; a day with an empty
  // slot offers Extra in its "+ Add" menu (HON-1335). The day's extras sit in
  // one row under its meals.
  it('shows "+ Extra" in the heading row when every slot is full', () => {
    render(<TimelineDayCard day={dayWithDinnerAnd([])} {...defaultProps} />)

    const headingRow = screen.getByRole('heading', { name: 'Today' }).parentElement
    const addExtra = screen.getByRole('button', { name: 'Add an extra: Today' })
    expect(headingRow).toContainElement(addExtra)
    expect(screen.queryByTestId(/^empty-slot-/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Today' })).not.toBeInTheDocument()
  })

  it('shows no "+ Extra" button beside "+ Add"', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)

    expect(screen.getByRole('button', { name: 'Add to Today' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an extra: Today' })).not.toBeInTheDocument()
  })

  it("lists the day's extras under its meals", () => {
    const day: TimelineDay = {
      ...dayWithDinnerAnd([]),
      extras: [
        {
          id: 'x1',
          date: '2026-03-29',
          ingredientId: null,
          name: 'chips',
          quantity: null,
          unit: null,
        },
      ],
    }
    render(<TimelineDayCard day={day} {...defaultProps} />)

    const extras = screen.getByRole('list', { name: 'Extras' })
    const card = screen.getByTestId('meal-card-dinner')
    expect(screen.getByRole('button', { name: 'Edit extra: chips' })).toBeInTheDocument()
    expect(card.compareDocumentPosition(extras) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // The removed extra's button leaves with the refresh, so focus goes to the
  // day's one add button, "+ Add" here, not to the body (HON-1309, HON-1335).
  it('focuses "+ Add" after an extra is removed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    )
    const user = userEvent.setup()
    const day: TimelineDay = {
      ...baseDay,
      extras: [
        {
          id: 'x1',
          date: '2026-03-29',
          ingredientId: null,
          name: 'chips',
          quantity: null,
          unit: null,
        },
      ],
    }
    const { wrapper: Wrapper } = createQueryWrapper()
    render(
      <Wrapper>
        <TimelineDayCard day={day} {...defaultProps} />
      </Wrapper>,
    )

    await user.click(screen.getByRole('button', { name: 'Edit extra: chips' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Today' })).toHaveFocus())
    vi.unstubAllGlobals()
  })

  it('shows no extras row on a day with none', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.queryByRole('list', { name: 'Extras' })).not.toBeInTheDocument()
  })

  it('does not show "No meals planned" when the day has only empty slots', () => {
    render(<TimelineDayCard day={baseDay} {...defaultProps} />)
    expect(screen.queryByText('No meals planned')).not.toBeInTheDocument()
  })

  // The slot label is the card's own first row (`MealTypeBadge` inside
  // `MealCard`, mocked here) and a group label in the closed "+ Add" menu, so
  // the day card renders none of its own.
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
