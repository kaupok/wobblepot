import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { fridgePantryItems } from '@/stories/fridge-fixtures'
import { TimelineEmptySlot } from './TimelineEmptySlot'

// "Fridge meal" in an open slot (HON-1277): the picker creates the entry as it
// saves, so no placeholder is posted first and none is left behind.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body = url === '/api/entries/recent' ? { meals: [] } : { id: 'entry-new' }
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSlot() {
  const onPicked = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <TimelineEmptySlot
        planId="plan-1"
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        mealType="dinner"
        householdServings={4}
        pantryItems={fridgePantryItems}
        onPicked={onPicked}
      />
    </Wrapper>,
  )
  return { onPicked, user: userEvent.setup() }
}

const slotButton = () =>
  screen.getByRole('button', { name: 'Dinner: pick a meal, Thursday Apr 16' })
const writes = () => requests.filter((r) => r.method !== 'GET')

describe('TimelineEmptySlot fridge meal', () => {
  it('opens the picker with no placeholder, and creates the fridge meal on Save', async () => {
    const { onPicked, user } = renderSlot()

    await user.click(slotButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Fridge meal' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
    expect(writes()).toEqual([])

    await user.click(dialog.getByRole('button', { name: 'Add: Cucumber' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(writes()).toEqual([
      {
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-04-16',
          mealType: 'dinner',
          fridgeItems: [{ ingredientId: 'cucumber' }],
        },
      },
    ])
    // The slot leaves with the refresh, so the page focuses the day.
    expect(onPicked).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the slot button when the picker closes without a save', async () => {
    const { user } = renderSlot()

    await user.click(slotButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Fridge meal' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(slotButton()).toHaveFocus())
    expect(writes()).toEqual([])
  })
})
