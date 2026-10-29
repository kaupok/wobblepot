import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toDateString } from '@/lib/meal-planning/dates'

import enMessages from '../../../messages/en.json'
import PastMealsPage from './page'

// Resolve `getTranslations('pastMeals')` → (key) → en.json.pastMeals[key].
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => {
    let cursor: unknown = enMessages
    for (const segment of namespace.split('.')) {
      cursor = (cursor as Record<string, unknown>)?.[segment]
    }
    return (key: string) => (cursor as Record<string, string>)?.[key] ?? key
  }),
}))

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/household', () => ({ getHouseholdMembership: vi.fn() }))
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/meal-plans/past-logging', () => ({
  loadFrequentMeals: vi.fn(),
  loadRecentFridgeLabels: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// The list is a client component with rows; surface what the page hands it.
vi.mock('@/components/timeline', () => ({
  PastMealsList: ({
    days,
    householdServings,
    log,
    weeks,
    hasEarlierWeek,
  }: {
    days: { date: string; entries: { id: string }[]; emptySlots: string[] }[]
    householdServings: number
    log: { frequentMeals: { id: string }[]; recentLabels: string[] }
    weeks: number
    hasEarlierWeek: boolean
  }) => (
    <div
      data-testid="past-meals-list"
      data-days={days.map((d) => d.date).join(',')}
      data-entries={days.flatMap((d) => d.entries.map((e) => e.id)).join(',')}
      data-empty-slots={days.map((d) => `${d.date}:${d.emptySlots.join('+')}`).join(',')}
      data-household-servings={String(householdServings)}
      data-frequent={log.frequentMeals.map((m) => m.id).join(',')}
      data-labels={log.recentLabels.join(',')}
      data-weeks={String(weeks)}
      data-has-earlier-week={String(hasEarlierWeek)}
    />
  ),
}))

const session = { user: { id: 'user-123', name: 'Test User', email: 'test@example.com' } }

const household = {
  id: 'household-123',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  createdAt: new Date('2026-01-05T10:00:00Z'),
  preferences: null as null | { weekdayMealTypes: string[]; weekendMealTypes: string[] },
  _count: { members: 3 },
  // Two adults and a toddler: the list scales by 2.5 servings, not 3 (HON-1040).
  members: [
    { preferences: { portionMultiplier: 1 } },
    { preferences: { portionMultiplier: 1 } },
    { preferences: { portionMultiplier: 0.5 } },
  ],
}

const membership = { householdId: 'household-123', household }

const page = (searchParams: { weeks?: string } = {}) =>
  PastMealsPage({ searchParams: Promise.resolve(searchParams) })

type Entry = { id: string; date: string; mealType?: string; meal: object | null; kind?: string }

async function mockLoaders(entries: Entry[], planId: string | null = 'plan-1') {
  const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')
  const { loadPantry } = await import('@/lib/meal-planning/load-pantry')
  const { loadFrequentMeals, loadRecentFridgeLabels } =
    await import('@/lib/meal-plans/past-logging')
  vi.mocked(loadPlanEntries).mockResolvedValue({
    entries: entries.map((e) => ({ mealType: 'dinner', note: null, ...e })),
    planId,
  } as never)
  vi.mocked(loadPantry).mockResolvedValue({ items: [] } as never)
  vi.mocked(loadFrequentMeals).mockResolvedValue([{ id: 'meal-pasta', name: 'Pasta' }])
  vi.mocked(loadRecentFridgeLabels).mockResolvedValue(['Wolt'])
}

describe('PastMealsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // 23:59:59.9 on Thursday 2026-10-22 in Tallinn (UTC+3), a tenth of a
    // second before the household's day turns: the page and the assertions
    // read one instant.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T20:59:59.900Z'))
    household.preferences = null
    household.createdAt = new Date('2026-01-05T10:00:00Z')
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membership as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('redirects to sign-in without a session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
  })

  it('redirects to onboarding without a household', async () => {
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  it('loads the seven days before the household’s today, today excluded', async () => {
    await mockLoaders([])
    const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')

    render(await page())

    const [, query] = vi.mocked(loadPlanEntries).mock.calls[0]!
    expect(toDateString(query.startDate)).toBe('2026-10-15')
    expect(toDateString(query.endDate)).toBe('2026-10-22')
  })

  it('reaches back two weeks for ?weeks=2 and offers the week before', async () => {
    await mockLoaders([])
    const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')

    render(await page({ weeks: '2' }))

    const [, query] = vi.mocked(loadPlanEntries).mock.calls[0]!
    expect(toDateString(query.startDate)).toBe('2026-10-08')
    const list = screen.getByTestId('past-meals-list')
    expect(list.getAttribute('data-days')?.split(',')).toHaveLength(14)
    expect(list).toHaveAttribute('data-weeks', '2')
    expect(list).toHaveAttribute('data-has-earlier-week', 'true')
  })

  it('offers no week before the one that holds the creation day', async () => {
    // Noon on 18 October in Tallinn: inside the first week.
    household.createdAt = new Date('2026-10-18T09:00:00Z')
    await mockLoaders([])

    render(await page({ weeks: '3' }))

    const list = screen.getByTestId('past-meals-list')
    expect(list.getAttribute('data-days')?.split(',')).toHaveLength(7)
    expect(list).toHaveAttribute('data-weeks', '1')
    expect(list).toHaveAttribute('data-has-earlier-week', 'false')
  })

  it('titles the page and renders every past day, with empty slots and the log data', async () => {
    await mockLoaders([
      { id: 'e1', date: '2026-10-21', meal: {} },
      { id: 'e2', date: '2026-10-20', meal: {} },
    ])

    render(await page())

    expect(screen.getByRole('heading', { level: 1, name: 'Past meals' })).toBeInTheDocument()
    const list = screen.getByTestId('past-meals-list')
    expect(list).toHaveAttribute('data-entries', 'e1,e2')
    expect(list.getAttribute('data-empty-slots')).toContain('2026-10-19:dinner')
    expect(list.getAttribute('data-empty-slots')).toContain('2026-10-21:,')
    expect(list).toHaveAttribute('data-household-servings', '2.5')
    expect(list).toHaveAttribute('data-frequent', 'meal-pasta')
    expect(list).toHaveAttribute('data-labels', 'Wolt')
    expect(screen.queryByRole('link', { name: 'Back to the meal plan' })).not.toBeInTheDocument()
  })

  it('lists fridge meals', async () => {
    await mockLoaders([{ id: 'fridge', date: '2026-10-20', meal: null, kind: 'fridge' }])

    render(await page())

    expect(screen.getByTestId('past-meals-list')).toHaveAttribute('data-entries', 'fridge')
  })

  it('takes the empty slots from the household’s meal types', async () => {
    household.preferences = {
      weekdayMealTypes: ['lunch', 'dinner'],
      weekendMealTypes: ['breakfast'],
    }
    await mockLoaders([])

    render(await page())

    const slots = screen.getByTestId('past-meals-list').getAttribute('data-empty-slots')
    // The 21st is a Wednesday and the 18th a Sunday.
    expect(slots).toContain('2026-10-21:lunch+dinner')
    expect(slots).toContain('2026-10-18:breakfast')
  })

  it('lists the expected dinners of a household created today, not the empty state', async () => {
    household.createdAt = new Date('2026-10-22T08:00:00Z')
    await mockLoaders([])

    render(await page())

    const list = screen.getByTestId('past-meals-list')
    expect(list.getAttribute('data-empty-slots')).toContain('2026-10-21:dinner')
    expect(screen.queryByText(enMessages.pastMeals.empty)).not.toBeInTheDocument()
  })

  it('shows the empty state for a household with no plan yet', async () => {
    await mockLoaders([], null)

    render(await page())

    expect(screen.getByText(enMessages.pastMeals.empty)).toBeInTheDocument()
  })
})
