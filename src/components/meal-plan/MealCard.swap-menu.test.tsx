import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast, type ExternalToast } from 'sonner'
import { track } from '@/lib/analytics'
import { createMeal } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'
import enMessages from '../../../messages/en.json'
import { MealCard } from './MealCard'

// A planned card's Swap group offers the open slot's routes (HON-1249).
// "Pick for me" asks the regenerate route, which ranks in swap mode, PATCHes
// the entry with the first meal, and Undo PATCHes the previous meal back, so
// the note stays.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
// The list is not under test here; a stub keeps the selector free of
// suggestion fixtures.
vi.mock('@/components/meal-plan/meal-selector/AlternativesList', () => ({
  AlternativesList: () => <div>alternatives</div>,
}))

const card = enMessages['meal-plan'].card
const meal = createMeal()
const ENTRY_URL = '/api/meal-plans/plan-1/entries/entry-1'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requests: { method: string; url: string; body: unknown }[]
let regenerateAnswer: () => Response

beforeEach(() => {
  requests = []
  regenerateAnswer = () =>
    json({
      alternatives: [
        { id: 'meal-7', name: 'Fish pie' },
        { id: 'meal-8', name: 'Lentil soup' },
      ],
    })
  refresh.mockClear()
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(track).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (method === 'POST' && url === `${ENTRY_URL}/regenerate`) {
        return Promise.resolve(regenerateAnswer())
      }
      return Promise.resolve(json({ success: true }))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(props: { status?: 'planned' | 'skipped'; servingOverride?: number } = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-10"
        mealType="dinner"
        status={props.status ?? 'planned'}
        householdServings={4}
        servingOverride={props.servingOverride}
        meal={meal}
        note="Use the big pan"
      />
    </Wrapper>,
  )
}

async function chooseRoute(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

async function pickedToast() {
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  return vi.mocked(toast).mock.calls[0]!
}

function clickUndo(options?: ExternalToast) {
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action)) {
    throw new Error('The toast has no Undo action')
  }
  action.onClick({} as React.MouseEvent<HTMLButtonElement>)
}

const patches = () => requests.filter((r) => r.method === 'PATCH')

describe('MealCard Swap group', () => {
  it('lists the three routes under a Swap label, with no single Swap item', async () => {
    renderCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))

    const group = within(await screen.findByRole('group', { name: 'Swap' }))
    expect(group.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
    ])
    expect(screen.queryByRole('menuitem', { name: 'Swap' })).not.toBeInTheDocument()
  })

  it('opens the swap picker on the library view from "Choose a recipe"', async () => {
    renderCard()
    await chooseRoute('Choose a recipe')

    const dialog = within(await screen.findByRole('dialog'))
    expect(
      dialog.getByRole('heading', { name: enMessages['meal-plan'].selector.swapTitle }),
    ).toBeInTheDocument()
    expect(dialog.getByRole('searchbox')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Imagine a meal' })).not.toBeInTheDocument()
  })

  it('opens the swap picker on the Imagine view from "Imagine a meal"', async () => {
    renderCard()
    await chooseRoute('Imagine a meal')

    const dialog = within(await screen.findByRole('dialog'))
    expect(
      dialog.getByRole('heading', { name: enMessages['meal-plan'].selector.swapTitle }),
    ).toBeInTheDocument()
    expect(
      dialog.getByRole('textbox', { name: enMessages['meal-plan'].selector.imagine.promptAria }),
    ).toBeInTheDocument()
    expect(dialog.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('MealCard Swap → "Pick for me"', () => {
  it('swaps in the top regenerate result with no dialog, and names it', async () => {
    renderCard()
    await chooseRoute('Pick for me')

    const [message] = await pickedToast()
    expect(message).toBe('Picked for you: Fish pie')
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${ENTRY_URL}/regenerate`,
      `PATCH ${ENTRY_URL}`,
    ])
    expect(patches()[0]!.body).toEqual({ mealId: 'meal-7' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('fires meal_swapped via pick_for_me, not slot_filled', async () => {
    renderCard()
    await chooseRoute('Pick for me')
    await pickedToast()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('meal_plan:meal_swapped', {
      plan_id: 'plan-1',
      from_meal_id: meal.id,
      to_meal_id: 'meal-7',
      source: 'meal_card',
      is_reselect: false,
      via: 'pick_for_me',
    })
  })

  it('puts the previous meal back on Undo with a PATCH, so the note stays', async () => {
    renderCard()
    await chooseRoute('Pick for me')
    const [, options] = await pickedToast()
    refresh.mockClear()

    clickUndo(options)

    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1]).toEqual({
      method: 'PATCH',
      url: ENTRY_URL,
      body: { mealId: meal.id },
    })
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('drops a serving override the swap reset on the server', async () => {
    renderCard({ servingOverride: 6 })
    expect(screen.getByText('6 servings')).toBeInTheDocument()

    await chooseRoute('Pick for me')
    await pickedToast()

    expect(screen.queryByText('6 servings')).not.toBeInTheDocument()
  })

  it('plans a skipped card that took a new meal', async () => {
    renderCard({ status: 'skipped' })
    await chooseRoute('Pick for me')
    await pickedToast()

    await waitFor(() =>
      expect(patches().map((p) => p.body)).toContainEqual(
        expect.objectContaining({ status: 'planned' }),
      ),
    )
  })

  it.each([
    ['an empty list', () => json({ alternatives: [] })],
    [
      'a 404 no_suggestions',
      () => json({ error: 'No alternative meals', code: 'no_suggestions' }, 404),
    ],
  ])('says no meal fits on %s, and changes nothing', async (_case, answer) => {
    regenerateAnswer = answer
    renderCard()
    await chooseRoute('Pick for me')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(card.pickForMeNoMatch))
    expect(patches()).toEqual([])
    expect(toast).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('says the swap failed, in catalog copy, when the PATCH fails', async () => {
    vi.mocked(fetch).mockImplementation((url, init) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url: String(url), body: null })
      if (method === 'POST') return Promise.resolve(regenerateAnswer())
      return Promise.resolve(json({ error: 'Entry not found or access denied' }, 404))
    })
    renderCard()
    await chooseRoute('Pick for me')

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(enMessages['meal-plan'].selector.updateMealFailed),
    )
    expect(toast).not.toHaveBeenCalled()
  })
})
