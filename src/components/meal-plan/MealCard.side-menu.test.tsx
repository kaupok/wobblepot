// HON-1611: the planner's own side dish controls — "Add side", each side's
// menu, and "Made" in the Cooked dialog. The real next-intl, so the copy is
// the catalog's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { type ExternalToast, toast } from 'sonner'

import { createMeal, createMealComponent, createPantryItem } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import { MealCard } from './MealCard'
import type { PlanEntrySide } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// Chicken thigh at 150 g a serving, among others.
const meal = createMeal()

function side(overrides: Partial<PlanEntrySide> = {}): PlanEntrySide {
  return {
    entryId: 'side-salad',
    mealId: 'meal-salad',
    mealName: 'Cucumber salad',
    servings: 3,
    cookServings: 3,
    status: 'planned',
    rating: null,
    servingOverride: null,
    pantryDeducted: false,
    components: [createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 100 })],
    ...overrides,
  }
}

/** A recipe as `/api/meals` lists it. */
function libraryMeal(id: string, name: string, course: 'main' | 'side') {
  return {
    ...createMeal({ id, name }),
    description: null,
    primaryProteinType: 'none',
    suitableFor: ['dinner'],
    course,
    isCustom: true,
    lastCookedOn: null,
    nextPlannedOn: null,
    imageUrl: null,
    imageStatus: null,
    imageHue: null,
  }
}

let requests: { method: string; url: string; body: unknown }[]
/** What the create route answers a side with: `completed` on a cooked main (Q7). */
let createdSideStatus: 'planned' | 'completed'

beforeEach(() => {
  requests = []
  createdSideStatus = 'planned'
  vi.mocked(toast).mockClear()
  vi.mocked(toast.success).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body = url.startsWith('/api/meals?')
        ? {
            // The server's side-first order: the side recipe, then the mains.
            meals: [
              libraryMeal('meal-cucumber', 'Cucumber salad', 'side'),
              libraryMeal(meal.id, meal.name, 'main'),
            ],
            hasMore: false,
            total: 2,
          }
        : method === 'POST'
          ? { id: 'side-new', mainEntryId: 'entry-1', status: createdSideStatus, servings: 3 }
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

function renderCard(props: Partial<Parameters<typeof MealCard>[0]> = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Wrapper>
        <MealCard
          entryId="entry-1"
          planId="plan-1"
          date="2026-10-12"
          meal={meal}
          mealType="dinner"
          status="planned"
          householdServings={3}
          cookServings={3}
          pantryItems={[
            createPantryItem({ ingredientId: 'chicken-thigh', quantity: 1000, isStaple: false }),
          ]}
          sides={[side()]}
          {...props}
        />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

const writes = () => requests.filter((r) => r.method !== 'GET')

async function openMainMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
}

describe('Add side', () => {
  it('lists side recipes first, refuses the main, and posts the pick as a side', async () => {
    const user = userEvent.setup()
    renderCard({ sides: [] })

    await openMainMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Add side' }))
    const picker = await screen.findByRole('dialog', { name: 'Add a side dish' })
    expect(within(picker).getByText(`Served with: ${meal.name}`)).toBeInTheDocument()

    const headings = await within(picker).findAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent?.trim())).toEqual(['Cucumber salad', meal.name])
    expect(requests.find((r) => r.url.startsWith('/api/meals?'))?.url).toContain('order=sideFirst')
    // The main's own recipe is listed, without Select.
    expect(within(picker).getAllByRole('button', { name: 'Select' })).toHaveLength(1)
    expect(within(picker).getByText('Already in this meal')).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: 'Select' }))

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: 'POST',
          url: '/api/meal-plans/plan-1/entries',
          body: { date: '2026-10-12', mealType: 'dinner', mealId: 'meal-cucumber', side: true },
        },
      ]),
    )
    expect(toast.success).toHaveBeenCalledWith('Side added: Cucumber salad')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `More actions: ${meal.name}` })).toHaveFocus(),
    )
  })

  it('says a side added to a cooked main is saved as eaten', async () => {
    const user = userEvent.setup()
    createdSideStatus = 'completed'
    renderCard({ status: 'completed', sides: [] })

    await openMainMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Add side' }))
    const picker = await screen.findByRole('dialog', { name: 'Add a side dish' })
    await user.click(await within(picker).findByRole('button', { name: 'Select' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Side added as eaten: Cucumber salad. Your pantry did not change.',
      ),
    )
  })

  it('is not offered on a skipped main', async () => {
    const user = userEvent.setup()
    renderCard({ status: 'skipped' })

    await openMainMenu(user)

    expect(await screen.findByRole('menuitem', { name: 'Not skipped' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add side' })).toBeNull()
  })
})

describe("A side's menu", () => {
  it('changes the side’s servings', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: '+ Cucumber salad · 3' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Servings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Side dish servings' })
    await user.click(within(dialog).getByRole('button', { name: 'Serves 3. Click to edit.' }))
    const input = within(dialog).getByRole('textbox', { name: 'Number of servings' })
    await user.clear(input)
    await user.type(input, '5{Enter}')

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: 'PATCH',
          url: '/api/meal-plans/plan-1/entries/side-salad',
          body: { servingOverride: 5 },
        },
      ]),
    )
  })

  it('removes the side, and Undo posts it back with its servings and rating', async () => {
    const user = userEvent.setup()
    renderCard({ sides: [side({ servingOverride: 2, servings: 2 })] })

    await user.click(screen.getByRole('button', { name: '+ Cucumber salad · 2' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Servings',
      'Swap',
      'Remove',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast).mock.calls[0]![0]).toBe('Side removed: Cucumber salad')
    expect(writes()).toEqual([
      { method: 'DELETE', url: '/api/meal-plans/plan-1/entries/side-salad', body: null },
    ])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `More actions: ${meal.name}` })).toHaveFocus(),
    )

    const options = vi.mocked(toast).mock.calls[0]![1] as ExternalToast
    const action = options.action as { onClick: (event: unknown) => void }
    action.onClick({ currentTarget: null })

    await waitFor(() =>
      expect(writes()[1]).toEqual({
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-10-12',
          mealType: 'dinner',
          mealId: 'meal-salad',
          side: true,
          servingOverride: 2,
          rating: null,
        },
      }),
    )
  })

  it('offers the thumbs on a cooked side, not Servings or Swap', async () => {
    const user = userEvent.setup()
    renderCard({ status: 'completed', sides: [side({ status: 'completed' })] })

    await user.click(screen.getByRole('button', { name: '+ Cucumber salad · 3' }))

    expect(
      (await screen.findAllByRole('menuitemcheckbox')).map((item) => item.textContent),
    ).toEqual(['Thumbs up', 'Thumbs down'])
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove'])
  })
})

describe('A side’s conflicts', () => {
  it('marks a planned side that breaks a preference, and not a cooked one', () => {
    const conflicts = [{ kind: 'allergen' as const, constraint: 'dairy' }]
    const { unmount } = renderCard({ sides: [side({ conflicts })] })
    expect(screen.getByText('Contains: Dairy')).toBeInTheDocument()
    unmount()

    renderCard({ status: 'completed', sides: [side({ conflicts, status: 'completed' })] })
    expect(screen.queryByText('Contains: Dairy')).toBeNull()
  })
})

describe('Made in the Cooked dialog', () => {
  it('drops an unchecked side’s amounts at once and sends it as skipped', async () => {
    const user = userEvent.setup()
    renderCard({
      sides: [
        side(),
        side({ entryId: 'side-slaw', mealId: 'meal-slaw', mealName: 'Cabbage slaw' }),
      ],
    })

    await openMainMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Cooked' }))
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    const made = within(deduction).getByRole('group', { name: 'Made' })
    expect(within(made).getAllByRole('checkbox', { checked: true })).toHaveLength(2)
    // 150 g × 3 for the main, 100 g × 3 for each side: 1050 g of 1000 g.
    const amount = () => within(deduction).getByText('Chicken thigh').nextElementSibling
    expect(amount()).toHaveTextContent('1000g → Ran out')

    await user.click(within(made).getByRole('checkbox', { name: 'Cucumber salad' }))

    // Without the salad: 450 g + 300 g.
    expect(amount()).toHaveTextContent('1000g → 250g')
    await user.click(within(deduction).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/meal-plans/plan-1/entries/entry-1',
      body: { status: 'completed', deductPantry: true, skippedSideIds: ['side-salad'] },
    })
  })

  it('opens for a side even when the pantry holds none of the slot', async () => {
    const user = userEvent.setup()
    renderCard({ pantryItems: [] })

    await openMainMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Cooked' }))

    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(within(deduction).getByRole('checkbox', { name: 'Cucumber salad' })).toBeChecked()
  })
})
