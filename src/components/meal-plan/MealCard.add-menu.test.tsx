import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealCard } from './MealCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The list is not under test here; a stub keeps the selector free of
// suggestion fixtures.
vi.mock('@/components/meal-plan/meal-selector/AlternativesList', () => ({
  AlternativesList: () => <div>alternatives</div>,
}))

let requests: { method: string; url: string }[]

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      requests.push({ method: init?.method ?? 'GET', url })
      return Promise.resolve(
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// A cleared card that kept its note: "Add meal" opens the same routes as an
// empty slot, and the entry exists, so a route opens the selector at once
// (HON-1247).
function renderClearedCard() {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-10"
        mealType="dinner"
        status="planned"
        householdServings={4}
        meal={null}
        note="Leftovers from Sunday"
      />
    </Wrapper>,
  )
}

const entryCreates = () =>
  requests.filter((r) => r.method === 'POST' && r.url === '/api/meal-plans/plan-1/entries')

describe('MealCard cleared card add menu', () => {
  it('lists the same routes as an empty slot', async () => {
    const user = userEvent.setup()
    renderClearedCard()

    await user.click(screen.getByRole('button', { name: 'Add meal' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
      'Fridge meal',
    ])
  })

  it('opens the library view from "Choose a recipe" with no create request', async () => {
    const user = userEvent.setup()
    renderClearedCard()

    await user.click(screen.getByRole('button', { name: 'Add meal' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Choose a recipe' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('searchbox', { name: 'Search meal library' })).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Imagine a meal' })).toBeNull()
    expect(entryCreates()).toEqual([])
  })

  it('opens the imagine view from "Imagine a meal" with no Back and no create request', async () => {
    const user = userEvent.setup()
    renderClearedCard()

    await user.click(screen.getByRole('button', { name: 'Add meal' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Imagine a meal' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('textbox', { name: "Describe the meal you're in the mood for" }),
    ).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Back to library' })).toBeNull()
    expect(within(dialog).queryByRole('searchbox')).toBeNull()
    expect(entryCreates()).toEqual([])
  })
})
