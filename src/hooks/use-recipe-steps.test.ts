// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { RECIPE_STEPS_DEBOUNCE_MS, useRecipeSteps } from './use-recipe-steps'
import enMessages from '../../messages/en.json'

const stepsErrors = enMessages['meal-plan'].steps.errors

const mockFetch = vi.fn()
global.fetch = mockFetch

const STEPS = { steps: ['Boil the pasta.'], pitfalls: [] }

function ok(tips: unknown) {
  return new Response(JSON.stringify({ tips }), { status: 200 })
}

function sentServings(call: number): unknown {
  const init = mockFetch.mock.calls[call]?.[1] as RequestInit
  return JSON.parse(init.body as string).servings
}

describe('useRecipeSteps', () => {
  let wrapper: ReturnType<typeof createQueryWrapper>['wrapper']

  beforeEach(() => {
    wrapper = createQueryWrapper().wrapper
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches nothing while the view is closed', () => {
    const { result } = renderHook(
      () => useRecipeSteps({ mealId: 'meal-1', servings: 2, enabled: false }),
      { wrapper },
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.isLoadingSteps).toBe(false)
  })

  it("posts the servings to the recipe's route and returns its steps", async () => {
    mockFetch.mockImplementation(async () => ok(STEPS))

    const { result } = renderHook(
      () => useRecipeSteps({ mealId: 'meal-1', servings: 2.5, enabled: true }),
      { wrapper },
    )

    expect(result.current.isLoadingSteps).toBe(true)
    await waitFor(() => expect(result.current.steps).toEqual(STEPS))
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/api/meals/meal-1/preparation-steps')
    expect(sentServings(0)).toBe(2.5)
    expect(result.current.isLoadingSteps).toBe(false)
  })

  it('asks once for the count the servings settle on, and drops the old steps meanwhile', async () => {
    mockFetch.mockImplementation(async () => ok(STEPS))
    const { result, rerender } = renderHook(
      ({ servings }) => useRecipeSteps({ mealId: 'meal-1', servings, enabled: true }),
      { wrapper, initialProps: { servings: 2 } },
    )
    await waitFor(() => expect(result.current.steps).toEqual(STEPS))

    rerender({ servings: 3 })
    rerender({ servings: 4 })

    expect(result.current.steps).toBeNull()
    expect(result.current.isLoadingSteps).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(RECIPE_STEPS_DEBOUNCE_MS))
    await waitFor(() => expect(result.current.steps).toEqual(STEPS))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sentServings(1)).toBe(4)
  })

  it('shows catalog copy, not the English route error', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'AI generation is off', code: 'generation_disabled' }), {
        status: 503,
      }),
    )

    const { result } = renderHook(
      () => useRecipeSteps({ mealId: 'meal-1', servings: 2, enabled: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.stepsError).toBe(stepsErrors.generationDisabled))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
