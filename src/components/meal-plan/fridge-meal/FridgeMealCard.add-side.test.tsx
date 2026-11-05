// HON-1617: "Add side" and each side line's menu on a fridge card, as on a
// recipe card (HON-1611). The real next-intl, so the copy is the catalog's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { type ExternalToast, toast } from 'sonner'

import { createMeal, createMealComponent } from '@/stories/fixtures'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../../messages/en.json'
import type { MealStatus, PlanEntrySide } from '../types'
import { FridgeMealCard } from './FridgeMealCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

function side(overrides: Partial<PlanEntrySide> = {}): PlanEntrySide {
  return {
    entryId: 'side-salad',
    mealId: 'meal-salad',
    mealName: 'Pepper salad',
    servings: 3,
    cookServings: 3,
    status: 'planned',
    rating: null,
    servingOverride: null,
    pantryDeducted: false,
    components: [createMealComponent({ ingredientId: 'paprika', quantityPerServing: 1 })],
    ...overrides,
  }
}

/** A recipe as `/api/meals` lists it. */
function libraryMeal(id: string, name: string) {
  return {
    ...createMeal({ id, name }),
    description: null,
    primaryProteinType: 'none',
    suitableFor: ['dinner'],
    course: 'side',
    isCustom: true,
    lastCookedOn: null,
    nextPlannedOn: null,
    imageUrl: null,
    imageStatus: null,
    imageHue: null,
  }
}

let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  vi.mocked(toast).mockClear()
  vi.mocked(toast.success).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body = url.startsWith('/api/meals?')
        ? {
            meals: [
              libraryMeal('meal-cucumber', 'Cucumber salad'),
              libraryMeal('meal-salad', 'Pepper salad'),
            ],
            hasMore: false,
            total: 2,
          }
        : method === 'POST'
          ? { id: 'side-new', mainEntryId: 'entry-1', status: 'planned', servings: 3 }
          : { id: 'entry-1', success: true }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
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

function renderCard(props: { status?: MealStatus; sides?: PlanEntrySide[] } = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Wrapper>
        <FridgeMealCard
          entryId="entry-1"
          planId="plan-1"
          date="2026-10-21"
          mealType="dinner"
          status={props.status ?? 'planned'}
          items={fridgeItems}
          pantryItems={fridgePantryItems}
          householdServings={3}
          sides={props.sides ?? [side()]}
        />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

const writes = () => requests.filter((r) => r.method !== 'GET')
const moreActions = () => screen.getByRole('button', { name: /^More actions: Fridge meal/ })

describe('Add side', () => {
  it('posts the pick as a side of the fridge meal and refuses the slot’s own side', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(moreActions())
    await user.click(await screen.findByRole('menuitem', { name: 'Add side' }))
    const picker = await screen.findByRole('dialog', { name: 'Add a side dish' })
    expect(within(picker).getByText('Served with: Mash')).toBeInTheDocument()

    // Pepper salad is already a side, so only Cucumber salad has Select.
    await within(picker).findByText('Already in this meal')
    const select = within(picker).getAllByRole('button', { name: 'Select' })
    expect(select).toHaveLength(1)
    await user.click(select[0]!)

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/api/meal-plans/plan-1/entries',
          body: { date: '2026-10-21', mealType: 'dinner', mealId: 'meal-cucumber', side: true },
        },
      ]),
    )
    expect(toast.success).toHaveBeenCalledWith('Side added: Cucumber salad')
    await waitFor(() => expect(moreActions()).toHaveFocus())
  })

  it('is not offered on a skipped fridge meal', async () => {
    const user = userEvent.setup()
    renderCard({ status: 'skipped' })

    await user.click(moreActions())

    expect(await screen.findByRole('menuitem', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add side' })).toBeNull()
  })
})

describe("A side's menu", () => {
  it('removes the side, and Undo posts it back', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: '+ Pepper salad · 3' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Servings',
      'Swap',
      'Remove',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast).mock.calls[0]![0]).toBe('Side removed: Pepper salad')
    expect(writes()).toEqual([
      { method: 'DELETE', url: '/api/meal-plans/plan-1/entries/side-salad', body: null },
    ])
    await waitFor(() => expect(moreActions()).toHaveFocus())

    const options = vi.mocked(toast).mock.calls[0]![1] as ExternalToast
    const action = options.action as { onClick: (event: unknown) => void }
    action.onClick({ currentTarget: null })

    await waitFor(() =>
      expect(writes()[1]).toEqual({
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-10-21',
          mealType: 'dinner',
          mealId: 'meal-salad',
          side: true,
          servingOverride: null,
          rating: null,
        },
      }),
    )
  })
})
