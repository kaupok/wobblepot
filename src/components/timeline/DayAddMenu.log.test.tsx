import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MealType } from '@/generated/prisma/enums'
import { fridgePantryItems } from '@/stories/fridge-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { DayAddMenu } from './DayAddMenu'

// Add on an empty slot of Past meals (HON-1383): a log of a meal the household
// already ate. A recipe or a fridge meal only, each saved as cooked in one
// request, with no placeholder. The day heading's Add logs a meal type the day
// does not expect (HON-1519).

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

let requests: { method: string; url: string; body: unknown }[]

const library = [
  { id: 'meal-porridge', name: 'Porridge' },
  { id: 'meal-soup', name: 'Lentil soup' },
]

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
        : url.startsWith('/api/meals')
          ? { meals: library, hasMore: false, total: library.length }
          : { id: 'entry-new' }
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A day heading's Add on Past meals: the other meal types only, no row to describe it. */
function renderHeading(otherSlots: MealType[]) {
  const onPicked = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <DayAddMenu
        planId="plan-1"
        date="2026-04-14"
        dayLabel="Tuesday Apr 14"
        emptySlots={[]}
        otherSlots={otherSlots}
        householdServings={4}
        pantryItems={fridgePantryItems}
        onPicked={onPicked}
        buttonStyle="heading"
        log={{ frequentMeals: [], recentLabels: ['Wolt'] }}
      />
    </Wrapper>,
  )
  return { onPicked, user: userEvent.setup() }
}

function renderSlot() {
  const onPicked = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <p id="slot-label">Dinner</p>
      <DayAddMenu
        planId="plan-1"
        date="2026-04-14"
        dayLabel="Tuesday Apr 14"
        emptySlots={['dinner']}
        householdServings={4}
        pantryItems={fridgePantryItems}
        onPicked={onPicked}
        describedBy="slot-label"
        log={{
          // Lentil soup was cooked most in the last 30 days.
          frequentMeals: [{ id: 'meal-soup', name: 'Lentil soup' }],
          recentLabels: ['Wolt', 'pelmeenid'],
        }}
      />
    </Wrapper>,
  )
  return { onPicked, user: userEvent.setup() }
}

const addButton = () => screen.getByRole('button', { name: 'Add to Tuesday Apr 14' })
const writes = () => requests.filter((r) => r.method !== 'GET')

describe('DayAddMenu log mode', () => {
  it('describes Add by its slot and offers a recipe or a fridge meal only', async () => {
    const { user } = renderSlot()

    expect(addButton()).toHaveAccessibleDescription('Dinner')
    await user.click(addButton())
    const menu = within(await screen.findByRole('menu'))

    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Fridge meal',
    ])
  })

  it('lists the most-cooked recipe first and saves the pick as cooked', async () => {
    const { onPicked, user } = renderSlot()

    await user.click(addButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Choose a recipe' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose a recipe' }))
    expect(writes()).toEqual([])

    await dialog.findByRole('button', { name: 'Porridge' })
    const choices = dialog
      .getAllByRole('button')
      .filter((b) => !['Cancel', 'Close'].includes(b.textContent ?? ''))
    // Lentil soup leads; the library leaves out what is listed above it.
    expect(choices.map((b) => b.textContent)).toEqual(['Lentil soup', 'Porridge'])

    await user.click(dialog.getByRole('button', { name: 'Lentil soup' }))

    await waitFor(() => expect(onPicked).toHaveBeenCalledTimes(1))
    expect(writes()).toEqual([
      {
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: { date: '2026-04-14', mealType: 'dinner', mealId: 'meal-soup', status: 'completed' },
      },
    ])
    // The library is not filtered by meal type: the meal was already eaten.
    const libraryUrls = requests.filter((r) => r.url.startsWith('/api/meals')).map((r) => r.url)
    expect(libraryUrls).toEqual(['/api/meals?limit=20&offset=0&source=custom'])
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Not back to Add: the logged row takes focus once the refresh lands, and
    // only from the body (HON-1519).
    expect(document.body).toHaveFocus()
  })

  it('returns focus to Add when the recipe picker closes with no pick', async () => {
    const { user } = renderSlot()

    await user.click(addButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Choose a recipe' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose a recipe' }))
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(addButton()).toHaveFocus())
    expect(writes()).toEqual([])
  })

  it('saves a fridge meal from a recent label as cooked', async () => {
    const { onPicked, user } = renderSlot()

    await user.click(addButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Fridge meal' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))

    await user.click(dialog.getByRole('button', { name: 'Add: Wolt' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onPicked).toHaveBeenCalledTimes(1))
    expect(writes()).toEqual([
      {
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-04-14',
          mealType: 'dinner',
          fridgeItems: [{ label: 'Wolt' }],
          status: 'completed',
        },
      },
    ])
  })

  it("offers each other meal type's log routes in a submenu and saves the log under that type", async () => {
    const { onPicked, user } = renderHeading(['breakfast', 'lunch'])

    expect(addButton()).not.toHaveAccessibleDescription()
    // By keyboard: jsdom does not finish a pointer click inside a Radix
    // submenu.
    addButton().focus()
    await user.keyboard('{Enter}')
    const menu = within(await screen.findByRole('menu'))
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Breakfast',
      'Lunch',
    ])
    await waitFor(() => expect(menu.getByRole('menuitem', { name: 'Breakfast' })).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    const submenu = within(await screen.findByRole('menu', { name: 'Breakfast' }))
    expect(submenu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Fridge meal',
    ])
    await waitFor(() =>
      expect(submenu.getByRole('menuitem', { name: 'Choose a recipe' })).toHaveFocus(),
    )
    await user.keyboard('{Enter}')
    const dialog = within(await screen.findByRole('dialog', { name: 'Choose a recipe' }))
    await user.click(await dialog.findByRole('button', { name: 'Porridge' }))

    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('breakfast'))
    expect(writes()).toEqual([
      {
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-04-14',
          mealType: 'breakfast',
          mealId: 'meal-porridge',
          status: 'completed',
        },
      },
    ])
  })

  it('shows the only other meal type flat, its routes under its label', async () => {
    const { user } = renderHeading(['lunch'])

    await user.click(addButton())
    const menu = within(await screen.findByRole('menu'))

    expect(menu.getByRole('group', { name: 'Lunch' })).toBeInTheDocument()
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Fridge meal',
    ])
  })
})
