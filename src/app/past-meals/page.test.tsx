import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PastMealsPage from './page'
import enMessages from '../../../messages/en.json'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

// Resolve `getTranslations('pastMeals')` → (key) → en.json.pastMeals[key].
vi.mock('next-intl/server', () => ({
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

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

// The list is a client component with day cards; surface what the page hands it.
vi.mock('@/components/timeline', () => ({
  PastMealsList: ({
    entries,
    todayDate,
    householdSize,
  }: {
    entries: { id: string }[]
    todayDate: string
    householdSize: number
  }) => (
    <div
      data-testid="past-meals-list"
      data-entries={entries.map((e) => e.id).join(',')}
      data-today={todayDate}
      data-household-size={String(householdSize)}
    />
  ),
}))

const session = { user: { id: 'user-123', name: 'Test User', email: 'test@example.com' } }

const membership = {
  householdId: 'household-123',
  household: {
    id: 'household-123',
    timezone: 'Europe/Tallinn',
    locale: 'en',
    _count: { members: 3 },
  },
}

async function mockLoaders(entries: { id: string }[], planId: string | null = 'plan-1') {
  const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')
  const { loadPantry } = await import('@/lib/meal-planning/load-pantry')
  vi.mocked(loadPlanEntries).mockResolvedValue({ entries, planId } as never)
  vi.mocked(loadPantry).mockResolvedValue({ items: [] } as never)
}

describe('PastMealsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(membership as never)
  })

  it('redirects to sign-in without a session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(PastMealsPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
  })

  it('redirects to onboarding without a household', async () => {
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(PastMealsPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  it('loads the seven days before the household’s today, today excluded', async () => {
    await mockLoaders([{ id: 'e1' }])
    const { loadPlanEntries } = await import('@/lib/meal-planning/load-plan-entries')

    render(await PastMealsPage())

    const today = getTodayInTimezone('Europe/Tallinn')
    const [, query] = vi.mocked(loadPlanEntries).mock.calls[0]!
    const expectedStart = parseLocalDate(today)
    expectedStart.setDate(expectedStart.getDate() - 7)
    expect(toDateString(query.startDate)).toBe(toDateString(expectedStart))
    expect(toDateString(query.endDate)).toBe(today)
  })

  it('titles the page and renders the list', async () => {
    await mockLoaders([{ id: 'e1' }, { id: 'e2' }])

    render(await PastMealsPage())

    expect(screen.getByRole('heading', { level: 1, name: 'Past meals' })).toBeInTheDocument()
    const list = screen.getByTestId('past-meals-list')
    expect(list).toHaveAttribute('data-entries', 'e1,e2')
    expect(list).toHaveAttribute('data-today', getTodayInTimezone('Europe/Tallinn'))
    expect(list).toHaveAttribute('data-household-size', '3')
    expect(screen.queryByRole('link', { name: 'Back to the meal plan' })).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no past entries', async () => {
    await mockLoaders([])

    render(await PastMealsPage())

    expect(screen.getByText('Nothing was planned in the last 7 days.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the meal plan' })).toHaveAttribute('href', '/')
    expect(screen.queryByTestId('past-meals-list')).not.toBeInTheDocument()
  })

  it('shows the empty state for a household with no plan yet', async () => {
    await mockLoaders([], null)

    render(await PastMealsPage())

    expect(screen.getByText('Nothing was planned in the last 7 days.')).toBeInTheDocument()
  })
})
