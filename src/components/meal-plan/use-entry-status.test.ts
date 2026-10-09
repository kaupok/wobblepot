import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMeal, createPantryItem, lemonGarlicChickenPantryItems } from '@/stories/fixtures'
import type { MealStatus, PantryItemFull } from './types'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'sonner'
import { track } from '@/lib/analytics'
import { useEntryStatus } from './use-entry-status'

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

function patchBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

function renderStatusHook(
  options: {
    initialStatus?: MealStatus
    pantryDeducted?: boolean
    /** Defaults to a pantry holding the meal's chicken, so a completion has a deduction to preview. */
    pantryItems?: PantryItemFull[]
    onCompleted?: () => void
    onLeaveCompleted?: () => void
  } = {},
) {
  const pantryItems = options.pantryItems ?? lemonGarlicChickenPantryItems
  const { wrapper } = createQueryWrapper()
  return renderHook(
    () =>
      useEntryStatus({
        planId: 'plan-1',
        entryId: 'entry-1',
        meal,
        initialStatus: options.initialStatus ?? 'planned',
        pantryDeducted: options.pantryDeducted,
        servings: 4,
        pantryItems,
        source: 'past_meals',
        onCompleted: options.onCompleted,
        onLeaveCompleted: options.onLeaveCompleted,
      }),
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useEntryStatus', () => {
  it('previews the deduction for an uncharged entry and changes nothing until confirm', async () => {
    const onCompleted = vi.fn()
    const { result } = renderStatusHook({ onCompleted })

    act(() => result.current.handleStatusChange('completed'))

    expect(result.current.isDeductionModalOpen).toBe(true)
    expect(result.current.status).toBe('planned')
    expect(fetchMock).not.toHaveBeenCalled()

    respond(200, { pantryDeducted: true })
    act(() => result.current.handleDeductionConfirm())

    await waitFor(() => expect(result.current.isDeductionModalOpen).toBe(false))
    expect(result.current.status).toBe('completed')
    expect(patchBodies()).toEqual([{ status: 'completed', deductPantry: true }])
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'past_meals',
    })
  })

  it('completes an already-charged entry directly, with no deduction (HON-651)', async () => {
    const onCompleted = vi.fn()
    const { result } = renderStatusHook({ pantryDeducted: true, onCompleted })

    respond(200)
    act(() => result.current.handleStatusChange('completed'))

    expect(result.current.isDeductionModalOpen).toBe(false)
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('completed')
    expect(patchBodies()).toEqual([{ status: 'completed', deductPantry: false }])
  })

  // HON-1125: the dialog would only say "No pantry items will be affected".
  it.each([
    ['an empty pantry', []],
    [
      'a pantry with none of its ingredients',
      [createPantryItem({ ingredientId: 'salmon-fillet' })],
    ],
    [
      'a pantry with only staples of it',
      [createPantryItem({ ingredientId: 'chicken-thigh', isStaple: true })],
    ],
  ])('completes directly, uncharged, against %s', async (_label, pantryItems) => {
    const onCompleted = vi.fn()
    const { result } = renderStatusHook({ pantryItems, onCompleted })

    respond(200, { pantryDeducted: false })
    act(() => result.current.handleStatusChange('completed'))

    expect(result.current.isDeductionModalOpen).toBe(false)
    expect(result.current.status).toBe('completed')
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(patchBodies()).toEqual([{ status: 'completed', deductPantry: false }])
    expect(result.current.isPantryCharged).toBe(false)
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'past_meals',
    })
  })

  it('does not preview a second deduction after a revert in the same session', async () => {
    const { result } = renderStatusHook()

    act(() => result.current.handleStatusChange('completed'))
    respond(200, { pantryDeducted: true })
    act(() => result.current.handleDeductionConfirm())
    await waitFor(() => expect(result.current.isUpdating).toBe(false))

    respond(200)
    act(() => result.current.handleStatusChange('planned'))
    await waitFor(() => expect(result.current.status).toBe('planned'))
    await waitFor(() => expect(result.current.isUpdating).toBe(false))

    respond(200)
    act(() => result.current.handleStatusChange('completed'))
    expect(result.current.isDeductionModalOpen).toBe(false)
    await waitFor(() => expect(result.current.status).toBe('completed'))
  })

  it('skips with the source it was given', async () => {
    const { result } = renderStatusHook()

    respond(200)
    act(() => result.current.handleStatusChange('skipped'))

    expect(result.current.status).toBe('skipped')
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('meal_plan:meal_skipped', {
        plan_id: 'plan-1',
        meal_id: meal.id,
        source: 'past_meals',
      }),
    )
  })

  it('lets a call name its own source', async () => {
    const { result } = renderStatusHook({ pantryDeducted: true })

    respond(200)
    act(() => result.current.handleStatusChange('completed', 'cook_view'))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'meal_plan:meal_completed',
        expect.objectContaining({ source: 'cook_view' }),
      ),
    )
  })

  it('reverts and shows the toast when the request fails', async () => {
    const { result } = renderStatusHook()

    respond(500, { error: 'Nope' })
    act(() => result.current.handleStatusChange('skipped'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to update status. Please try again.'),
    )
    expect(result.current.status).toBe('planned')
    expect(track).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  // HON-1028: the header's past-meals dot is a server count, so every status
  // change has to re-render it, not only a confirmed deduction.
  it.each(['skipped', 'planned'] as const)('refreshes the router after %s', async (newStatus) => {
    const { result } = renderStatusHook({
      initialStatus: newStatus === 'planned' ? 'skipped' : 'planned',
    })

    respond(200)
    act(() => result.current.handleStatusChange(newStatus))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('refreshes the router after completing an already-charged entry', async () => {
    const { result } = renderStatusHook({ pantryDeducted: true })

    respond(200)
    act(() => result.current.handleStatusChange('completed'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('calls onLeaveCompleted only on the way out of completed', async () => {
    const onLeaveCompleted = vi.fn()
    const { result } = renderStatusHook({ initialStatus: 'completed', onLeaveCompleted })

    respond(200)
    act(() => result.current.handleStatusChange('planned'))
    await waitFor(() => expect(onLeaveCompleted).toHaveBeenCalledTimes(1))

    respond(200)
    act(() => result.current.handleStatusChange('skipped'))
    await waitFor(() => expect(result.current.isUpdating).toBe(false))
    expect(onLeaveCompleted).toHaveBeenCalledTimes(1)
  })
})
