import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MealStatus, PantryItemFull } from '@/components/meal-plan/types'
import { createMeal, lemonGarlicChickenPantryItems } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { toast } from 'sonner'

import { track } from '@/lib/analytics'

import { PastMealRow } from './PastMealRow'

const meal = createMeal()
const fetchMock = vi.fn()

function respond(status: number, body: object = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderRow(
  props: {
    status?: MealStatus
    pantryDeducted?: boolean
    pantryItems?: PantryItemFull[]
    autoFocus?: boolean
    onFocused?: () => void
    onCleared?: () => void
  } = {},
) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <PastMealRow
        entryId="entry-1"
        planId="plan-1"
        date="2026-04-14"
        meal={meal}
        mealType="dinner"
        status="planned"
        householdServings={4}
        // The meal's chicken is in the pantry, so Cooked has a deduction to preview.
        pantryItems={lemonGarlicChickenPantryItems}
        {...props}
      />
    </Wrapper>,
  )
}

const cooked = () => screen.getByRole('button', { name: 'Cooked' })
const skipped = () => screen.getByRole('button', { name: 'Skipped' })
const undo = () => screen.getByRole('button', { name: `Undo: ${meal.name}` })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PastMealRow', () => {
  it('shows the slot and the name, with Cooked and Skipped while planned', () => {
    renderRow()

    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText(meal.name)).toBeInTheDocument()
    expect(cooked()).toHaveAccessibleDescription(meal.name)
    expect(skipped()).toHaveAccessibleDescription(meal.name)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows Cooked, the thumbs and Undo once cooked', () => {
    renderRow({ status: 'completed' })

    expect(screen.getByText('Cooked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeInTheDocument()
    expect(undo()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cooked' })).not.toBeInTheDocument()
  })

  it('shows Skipped and Undo once skipped', () => {
    renderRow({ status: 'skipped' })

    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(undo()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thumbs up' })).not.toBeInTheDocument()
  })

  it('opens the deduction for an uncharged entry, and focuses Undo after confirm', async () => {
    const user = userEvent.setup()
    renderRow()

    await user.click(cooked())
    const dialog = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(fetchMock).not.toHaveBeenCalled()

    respond(200, { pantryDeducted: true })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(undo()).toHaveFocus())
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'past_meals',
      used_up_count: 0,
      some_left_count: 1,
    })
  })

  it('leaves the row planned and focuses Cooked after a cancel', async () => {
    const user = userEvent.setup()
    renderRow()

    await user.click(cooked())
    await screen.findByRole('dialog', { name: 'Mark as cooked' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(cooked()).toHaveFocus())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('completes an already-charged entry with no dialog', async () => {
    const user = userEvent.setup()
    renderRow({ pantryDeducted: true })

    respond(200)
    await user.click(cooked())

    await waitFor(() => expect(undo()).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // HON-1125: the dialog would only say "No pantry items will be affected".
  it('completes with no dialog when the pantry holds none of the meal', async () => {
    const user = userEvent.setup()
    renderRow({ pantryItems: [] })

    respond(200, { pantryDeducted: true })
    await user.click(cooked())

    await waitFor(() => expect(undo()).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      status: 'completed',
      deductPantry: true,
    })
  })

  it('focuses Undo after Skipped, and Cooked after Undo', async () => {
    const user = userEvent.setup()
    renderRow()

    respond(200)
    await user.click(skipped())
    await waitFor(() => expect(undo()).toHaveFocus())
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'meal_plan:meal_skipped',
        expect.objectContaining({ source: 'past_meals' }),
      ),
    )

    respond(200)
    await user.click(undo())
    await waitFor(() => expect(cooked()).toHaveFocus())
  })

  it('reverts the row and shows the toast when the request fails', async () => {
    const user = userEvent.setup()
    renderRow()

    respond(500, { error: 'Nope' })
    await user.click(skipped())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to update status. Please try again.'),
    )
    await waitFor(() => expect(cooked()).toHaveFocus())
    expect(skipped()).toBeInTheDocument()
  })

  describe('Remove (HON-1383)', () => {
    it('clears a planned row as Clear does, with the entry for Undo', async () => {
      const user = userEvent.setup()
      const onCleared = vi.fn()
      renderRow({ onCleared })

      const remove = screen.getByRole('button', { name: 'Remove' })
      expect(remove).toHaveAccessibleDescription(meal.name)
      respond(200, { success: true })
      await user.click(remove)

      await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/meal-plans/plan-1/entries/entry-1',
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(toast).toHaveBeenCalledWith(
        `Cleared: ${meal.name}`,
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
      )
    })

    // HON-1444: the page still holds `pantryDeducted: false` from its load, but
    // Cooked charged the pantry since. Undo after Remove must keep that charge.
    it('keeps a charge made in this session when the row is removed and restored', async () => {
      const user = userEvent.setup()
      const onCleared = vi.fn()
      renderRow({ onCleared })

      await user.click(cooked())
      await screen.findByRole('dialog', { name: 'Mark as cooked' })
      respond(200, { pantryDeducted: true })
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(undo()).toHaveFocus())

      respond(200)
      await user.click(undo())
      await waitFor(() => expect(cooked()).toHaveFocus())

      respond(200, { success: true })
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))

      const [, options] = vi.mocked(toast).mock.calls[0]!
      respond(200, { id: 'restored' })
      ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
      const [url, init] = fetchMock.mock.calls[3]!
      expect(url).toBe('/api/meal-plans/plan-1/entries')
      expect(JSON.parse(init.body)).toMatchObject({ status: 'planned', pantryDeducted: true })
    })

    it('offers Remove on a skipped row', () => {
      renderRow({ status: 'skipped' })

      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })

    it('offers no Remove on a cooked row', () => {
      renderRow({ status: 'completed' })

      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    })
  })

  it('takes focus on Undo when it replaces a logged slot', async () => {
    const onFocused = vi.fn()
    renderRow({ status: 'completed', autoFocus: true, onFocused })

    await waitFor(() => expect(undo()).toHaveFocus())
    expect(onFocused).toHaveBeenCalledTimes(1)
  })
})
