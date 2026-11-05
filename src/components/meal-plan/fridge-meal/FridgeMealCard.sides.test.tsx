import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIngredient, createMealComponent } from '@/stories/fixtures'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import type { PlanEntrySide } from '../types'
import { FridgeMealCard } from './FridgeMealCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const ENTRY_URL = '/api/meal-plans/plan-1/entries/entry-1'
let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'entry-1', pantryDeducted: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = (id: string, name: string, quantityPerServing: number) =>
  createMealComponent({
    ingredientId: id,
    quantityPerServing,
    ingredient: createIngredient({ id, name, category: 'vegetable', defaultUnit: 'g' }),
  })

// A pepper salad for 3: paprika and the veg mix are pantry rows, so the
// sides' dialog lists both.
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
    components: [
      component('paprika', 'Paprika', 1),
      component('veg-mix', 'Cauliflower and broccoli mix', 50),
    ],
    ...overrides,
  }
}

function renderCard(props: { items?: typeof fridgeItems; sides?: PlanEntrySide[] } = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <FridgeMealCard
        householdServings={3}
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-21"
        mealType="dinner"
        status="planned"
        items={props.items ?? fridgeItems}
        pantryItems={fridgePantryItems}
        sides={props.sides ?? [side()]}
      />
    </Wrapper>,
  )
  return userEvent.setup()
}

const patches = () => requests.filter((r) => r.method === 'PATCH')
const trigger = () => screen.getByRole('button', { name: /^More actions: Fridge meal: / })

async function eaten(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  await user.click(await screen.findByRole('menuitem', { name: 'Eaten' }))
}

describe('FridgeMealCard with a side (HON-1616)', () => {
  it("asks about the side's pantry rows after the fridge items, and completes in one request", async () => {
    const user = renderCard()

    await eaten(user)
    const fridgeDialog = within(
      await screen.findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    await user.click(fridgeDialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await user.click(fridgeDialog.getByRole('button', { name: 'Done' }))

    const sidesDialog = within(await screen.findByRole('dialog', { name: 'Mark as cooked' }))
    expect(sidesDialog.getByText(/Pepper salad/)).toBeInTheDocument()
    const group = (name: string) =>
      sidesDialog.getByRole('radiogroup', { name: `What is left: ${name}` })
    await user.click(within(group('Paprika')).getByRole('radio', { name: 'Some left' }))
    await user.click(
      within(group('Cauliflower and broccoli mix')).getByRole('radio', { name: 'Running low' }),
    )
    // Nothing is sent until the sides' dialog is confirmed.
    expect(patches()).toEqual([])
    await user.click(sidesDialog.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([
      {
        method: 'PATCH',
        url: ENTRY_URL,
        body: {
          status: 'completed',
          deductPantry: true,
          usedUpIngredientIds: ['cucumber'],
          someLeftIngredientIds: ['paprika'],
          lowIngredientIds: ['veg-mix'],
        },
      },
    ])
    // Both dialogs open from the ⋯ menu, so focus goes back to its trigger.
    expect(trigger()).toHaveFocus()
  })

  it('opens the side rows straight away when no fridge item is from the pantry', async () => {
    const user = renderCard({ items: fridgeItems.filter((item) => item.ingredientId === null) })

    await eaten(user)
    const sidesDialog = within(await screen.findByRole('dialog', { name: 'Mark as cooked' }))
    expect(
      sidesDialog.getByRole('radiogroup', { name: 'What is left: Paprika' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Did you use anything up?' })).toBeNull()
    await user.click(sidesDialog.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toMatchObject({ status: 'completed', deductPantry: true })
  })

  it('sends nothing when the sides dialog is cancelled', async () => {
    const user = renderCard()

    await eaten(user)
    const fridgeDialog = within(
      await screen.findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    await user.click(fridgeDialog.getByRole('button', { name: 'Done' }))
    await screen.findByRole('dialog', { name: 'Mark as cooked' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([])
  })

  it('keeps the fridge-only body for a side charged before', async () => {
    const user = renderCard({ sides: [side({ pantryDeducted: true })] })

    await eaten(user)
    const fridgeDialog = within(
      await screen.findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    await user.click(fridgeDialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await user.click(fridgeDialog.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toEqual({
      status: 'completed',
      deductPantry: false,
      usedUpIngredientIds: ['cucumber'],
    })
  })
})
