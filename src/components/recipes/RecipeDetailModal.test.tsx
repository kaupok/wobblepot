import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MealData } from '@/components/meal-plan/types'
import type { MemberPortion } from '@/hooks/use-member-portions'
import { RECIPE_STEPS_DEBOUNCE_MS } from '@/hooks/use-recipe-steps'
import { createQueryWrapper } from '@/test/query-wrapper'

import { RecipeDetailModal } from './RecipeDetailModal'

vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: vi.fn() }))
// The members query has its own test; here it reports no members (HON-1475).
const { useMemberPortions } = vi.hoisted(() => ({
  useMemberPortions: vi.fn((_enabled: boolean): MemberPortion[] | undefined => undefined),
}))
vi.mock('@/hooks/use-member-portions', () => ({ useMemberPortions }))

const mockFetch = vi.fn()
global.fetch = mockFetch

const STEPS = {
  steps: ['Roast the chicken for 35 minutes.', 'Rest it for 5 minutes.'],
  pitfalls: ['Dry the skin well.'],
}

const meal: MealData = {
  id: 'meal-1',
  name: 'Roast chicken',
  kidFriendly: false,
  isCustom: true,
  components: [
    {
      ingredientId: 'ing-chicken',
      quantityPerServing: 150,
      ingredient: {
        id: 'ing-chicken',
        name: 'Chicken thigh',
        category: 'protein',
        defaultUnit: 'g',
      },
    },
  ],
  nutrition: { calories: 500, protein: 40, carbs: 10, fat: 20 },
}

function servingsSent(): unknown[] {
  return mockFetch.mock.calls
    .filter(([url]) => url === '/api/meals/meal-1/preparation-steps')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).servings)
}

function renderModal(
  open = true,
  shown: MealData = meal,
  history?: { lastCookedOn: string | null; cookedLast28Days: number },
) {
  const { wrapper } = createQueryWrapper()
  const props = { meal: shown, householdServings: 2.5, onOpenChange: vi.fn(), history }
  const view = render(<RecipeDetailModal {...props} open={open} />, { wrapper })
  return {
    ...view,
    setOpen: (next: boolean) => view.rerender(<RecipeDetailModal {...props} open={next} />),
  }
}

describe('RecipeDetailModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockReset()
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ tips: STEPS })))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows each member's portion chips once the members load (HON-1475)", async () => {
    useMemberPortions.mockImplementation((enabled) =>
      enabled
        ? [
            { id: 'm1', name: 'Kaupo', multiplier: 1.5, isSelf: false },
            { id: 'm2', name: 'Nora', multiplier: 0.5, isSelf: false },
          ]
        : undefined,
    )
    renderModal()

    const dialog = await screen.findByRole('dialog', { name: 'Roast chicken' })
    expect(within(dialog).getByRole('radiogroup', { name: 'Whose portion' })).toBeInTheDocument()
    expect(useMemberPortions).toHaveBeenLastCalledWith(true)
    useMemberPortions.mockReset()
  })

  it("opens at the household's servings, with the amounts scaled to them", async () => {
    renderModal()

    const dialog = await screen.findByRole('dialog', { name: 'Roast chicken' })
    // 150 g a serving × 2.5
    expect(within(dialog).getByText(/375\s*g/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Serves 2\.5/ })).toBeInTheDocument()
    expect(await within(dialog).findByText(STEPS.steps[0]!)).toBeInTheDocument()
    expect(servingsSent()).toEqual([2.5])
  })

  it('scales and asks for new steps on a serving change, and a reopen starts afresh', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { setOpen } = renderModal()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(STEPS.steps[0]!)

    await user.click(within(dialog).getByRole('button', { name: /Serves 2\.5/ }))
    const field = within(dialog).getByRole('textbox', { name: 'Number of servings' })
    await user.clear(field)
    await user.type(field, '4{Enter}')

    expect(within(dialog).getByText(/600\s*g/)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(RECIPE_STEPS_DEBOUNCE_MS))
    await waitFor(() => expect(servingsSent()).toEqual([2.5, 4]))
    // Only the steps route: the change is not saved anywhere.
    expect(mockFetch.mock.calls.every(([url]) => String(url).endsWith('/preparation-steps'))).toBe(
      true,
    )

    setOpen(false)
    setOpen(true)

    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).getByText(/375\s*g/)).toBeInTheDocument()
  })

  it('shows none of what belongs to a planned entry', async () => {
    renderModal()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(STEPS.steps[0]!)

    expect(within(dialog).queryByRole('button', { name: /Done cooking/i })).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /How to prepare/i })).toBeNull()
    // No conflict badges (`meal-plan.card.conflict`) …
    expect(
      within(dialog).queryByText(/^(Contains|Not suitable):|Has an avoided ingredient/),
    ).toBeNull()
    // … and no ingredient changes (`meal-plan.changes`): no badge, row menu or add.
    expect(within(dialog).queryByText('Changed')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Change Chicken thigh' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Add an ingredient' })).toBeNull()
  })

  // Ask is the one cook-view tool the recipe mode shares (HON-1339), behind a
  // ⋯ menu on each step (HON-1350).
  it('has the ⋯ menu with the ready-made questions on each step', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderModal()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(STEPS.steps[0]!)

    expect(within(dialog).getByRole('button', { name: 'Ask about step 1' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Ask about step 2' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      "How do I know it's done?",
      'What can I substitute here?',
      "I'm short on time",
      'Ask your own question',
    ])
  })

  it('holds Edit, a link to the edit page, in More actions', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderModal()
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: /More actions/ }))

    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Edit')
    expect(items[0]).toHaveAttribute('href', '/recipes/meal-1/edit')
  })

  // HON-1352: the picker opens library meals here, which are not the household's to edit.
  it('has no More actions for a library meal, whose only item would be Edit', async () => {
    renderModal(true, { ...meal, isCustom: false })
    const dialog = await screen.findByRole('dialog')

    expect(await within(dialog).findByText(STEPS.steps[0]!)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /More actions/ })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('ticks a step on screen only', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderModal()
    const dialog = await screen.findByRole('dialog')
    const step = await within(dialog).findByRole('button', { name: new RegExp(STEPS.steps[0]!) })
    const callsBefore = mockFetch.mock.calls.length

    await user.click(step)

    expect(step).toHaveAttribute('aria-pressed', 'true')
    expect(mockFetch.mock.calls.length).toBe(callsBefore)
  })

  // HON-1389: My recipes passes the row's history; the picker passes none.
  it.each([
    [
      { lastCookedOn: '2026-10-16', cookedLast28Days: 3 },
      'Cooked 3 times in 4 weeks, last on Fri, Oct 16',
    ],
    [
      { lastCookedOn: '2026-10-16', cookedLast28Days: 1 },
      'Cooked 1 time in 4 weeks, last on Fri, Oct 16',
    ],
    [{ lastCookedOn: '2026-08-01', cookedLast28Days: 0 }, 'Last cooked on Sat, Aug 1'],
    [{ lastCookedOn: null, cookedLast28Days: 0 }, 'Not cooked yet'],
  ])('shows the cook history %o as "%s"', async (history, expected) => {
    renderModal(true, meal, history)
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(expected)).toBeInTheDocument()
  })

  it('shows no cook history without one', async () => {
    renderModal()
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).queryByText(/cooked/i)).toBeNull()
  })
})
