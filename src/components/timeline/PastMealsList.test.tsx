import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import { createExpectedMealTypes, createPlanEntry } from '@/stories/fixtures'
import type { PlanEntry } from '@/components/meal-plan/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { buildPastDays } from './past-days'
import { PastMealsList } from './PastMealsList'

// Wednesday 15 April 2026 is today.
const days = (entries: PlanEntry[], startDate = '2026-04-08') =>
  buildPastDays(entries, {
    startDate,
    todayDate: '2026-04-15',
    expectedMealTypes: createExpectedMealTypes(),
    locale: 'en',
  })

const yesterdayDinner = createPlanEntry({ id: 'e1', date: '2026-04-14', status: 'planned' })

function renderList(props: Partial<ComponentProps<typeof PastMealsList>> = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  const base: ComponentProps<typeof PastMealsList> = {
    days: days([yesterdayDinner]),
    planId: 'plan-1',
    householdServings: 4,
    pantryItems: [],
    log: { frequentMeals: [], recentLabels: [] },
    weeks: 1,
    hasEarlierWeek: true,
    ...props,
  }
  const view = render(<PastMealsList {...base} />, { wrapper: Wrapper })
  return {
    user: userEvent.setup(),
    rerender: (next: Partial<ComponentProps<typeof PastMealsList>>) =>
      view.rerender(<PastMealsList {...base} {...next} />),
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PastMealsList', () => {
  it('shows an empty day as its expected dinner with Add', () => {
    renderList()

    const add = screen.getByRole('button', { name: 'Add to Monday Apr 13' })
    expect(add).toHaveAccessibleDescription('Dinner')
  })

  it('reaches a week further back, then focuses the first new day', async () => {
    const { user, rerender } = renderList()

    await user.click(screen.getByRole('button', { name: 'Show the week before' }))
    expect(push).toHaveBeenCalledWith('/past-meals?weeks=2', { scroll: false })

    // The server answers with the next week, and the first household day: no
    // earlier week to offer.
    rerender({ days: days([yesterdayDinner], '2026-04-01'), weeks: 2, hasEarlierWeek: false })

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Tuesday Apr 7' })).toHaveFocus(),
    )
    expect(screen.queryByRole('button', { name: 'Show the week before' })).not.toBeInTheDocument()
  })

  it('moves focus to Add once a removed meal leaves its slot empty', async () => {
    const { user, rerender } = renderList()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // The refresh lands: the row is gone, and focus with it.
    dropFocusToBody()
    rerender({ days: days([]) })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to Tuesday Apr 14' })).toHaveFocus(),
    )
  })

  it('moves focus to Undo on the row that replaces a logged slot', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.startsWith('/api/meals')
              ? { meals: [{ id: 'meal-soup', name: 'Lentil soup' }], hasMore: false, total: 1 }
              : { id: 'logged' },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const { user, rerender } = renderList({ days: days([]) })

    await user.click(screen.getByRole('button', { name: 'Add to Tuesday Apr 14' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Choose a recipe' }))
    await user.click(await screen.findByRole('button', { name: 'Lentil soup' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The refresh lands: Add is gone, and a cooked row is in its place.
    dropFocusToBody()
    const logged = createPlanEntry({ id: 'logged', date: '2026-04-14', status: 'completed' })
    rerender({ days: days([logged]) })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Undo: ${logged.meal!.name}` })).toHaveFocus(),
    )
  })
})
