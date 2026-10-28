import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMeal } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealCard } from './MealCard'

// "Fridge meal" on a card turns the entry into a fridge meal (HON-1277): under
// Swap on a planned recipe, and from "Add meal" on a note-only card. Both
// PATCH the entry's items, and the note stays.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const meal = createMeal()
const ENTRY_URL = '/api/meal-plans/plan-1/entries/entry-1'

let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body = url.startsWith('/api/entries/recent')
        ? { meals: [], defaultServings: 2 }
        : { success: true }
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(props: { meal: typeof meal | null; onPicked?: () => void }) {
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
        meal={props.meal}
        note="Use the big pan"
        onPicked={props.onPicked}
      />
    </Wrapper>,
  )
}

async function addTextAndSave(user: ReturnType<typeof userEvent.setup>) {
  const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
  await user.type(dialog.getByLabelText('Something else'), 'store meatballs')
  await user.click(dialog.getByRole('button', { name: 'Add' }))
  await user.click(dialog.getByRole('button', { name: 'Save' }))
}

describe('MealCard fridge meal route', () => {
  it('replaces a planned recipe with a fridge meal from Swap', async () => {
    const onPicked = vi.fn()
    renderCard({ meal, onPicked })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    const swap = within(await screen.findByRole('group', { name: 'Swap' }))
    await user.click(swap.getByRole('menuitem', { name: 'Fridge meal' }))
    await addTextAndSave(user)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests.filter((r) => r.method === 'PATCH')).toEqual([
      { method: 'PATCH', url: ENTRY_URL, body: { fridgeItems: [{ label: 'store meatballs' }] } },
    ])
    // The card becomes a fridge-meal card, so the page focuses the day.
    expect(onPicked).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fills a note-only card with a fridge meal from "Add meal"', async () => {
    renderCard({ meal: null })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Add meal' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Fridge meal' }))
    await addTextAndSave(user)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'PATCH', url: ENTRY_URL, body: { fridgeItems: [{ label: 'store meatballs' }] } },
    ])
  })

  it('returns focus to the ⋯ trigger when the picker closes without a save', async () => {
    renderCard({ meal })
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })

    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Fridge meal' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(requests.filter((r) => r.method === 'PATCH')).toEqual([])
  })
})
