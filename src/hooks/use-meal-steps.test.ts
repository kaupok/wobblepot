import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useMealSteps } from './use-meal-steps'
import type { PreparationSteps } from '@/components/meal-plan/types'
import enMessages from '../../messages/en.json'

const stepsErrors = enMessages['meal-plan'].steps.errors

const mockFetch = vi.fn()
global.fetch = mockFetch

const defaultOptions = {
  planId: 'plan-1',
  entryId: 'entry-1',
}

const mockTips: PreparationSteps = {
  equipment: ['Large skillet', 'Cutting board'],
  steps: ['Heat oil in skillet', 'Cook chicken at 180°C for 25 minutes'],
  pitfalls: ["Don't overcook the chicken"],
  tip: 'Let the chicken rest for 5 minutes before slicing',
}

const mockSupplementaryTips: PreparationSteps = {
  pitfalls: ["Don't overcook the chicken"],
  tip: 'Let the chicken rest for 5 minutes before slicing',
}

describe('useMealSteps', () => {
  let wrapper: ReturnType<typeof createQueryWrapper>['wrapper']

  beforeEach(() => {
    wrapper = createQueryWrapper().wrapper
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    mockFetch.mockReset()
    // The hook logs the route's prose as a breadcrumb on every API failure.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('returns correct defaults with no initialSteps', () => {
      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      expect(result.current.steps).toBeNull()
      expect(result.current.isLoadingSteps).toBe(false)
      expect(result.current.stepsError).toBeNull()
      expect(result.current.isStepsExpanded).toBe(false)
    })

    it('uses initialSteps when provided', () => {
      const { result } = renderHook(
        () => useMealSteps({ ...defaultOptions, initialSteps: mockTips }),
        { wrapper },
      )

      expect(result.current.steps).toEqual(mockTips)
    })
  })

  describe('fetchSteps', () => {
    it('fetches tips and updates state on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/meal-plans/plan-1/entries/entry-1/preparation-tips',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(result.current.steps).toEqual(mockTips)
      expect(result.current.isLoadingSteps).toBe(false)
      expect(result.current.isStepsExpanded).toBe(true)
      expect(result.current.stepsError).toBeNull()
    })

    it('sets error state on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: 'Rate limit exceeded', code: 'rate_limited' }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.steps).toBeNull()
      expect(result.current.stepsError).toBe(stepsErrors.rateLimited)
      expect(result.current.isLoadingSteps).toBe(false)
    })

    it('names the time the hourly limit lifts when the 429 carries resetAt', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error: 'Rate limit exceeded',
            code: 'rate_limited',
            // 18:40 on the device clock, whatever TZ the test runs in.
            resetAt: new Date(2026, 9, 9, 18, 40).toISOString(),
          }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBe(
        stepsErrors.rateLimitedUntil.replace('{time}', '6:40 PM'),
      )
    })

    it('sets generic error message on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'))

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBe(stepsErrors.tipsFailed)
      expect(result.current.isLoadingSteps).toBe(false)
    })

    it('sets generic fallback when error is not an Error instance', async () => {
      mockFetch.mockRejectedValue('something went wrong')

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBe(stepsErrors.tipsFailed)
    })

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: Response) => void
      mockFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          resolvePromise = resolve
        }),
      )

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      let fetchPromise: Promise<void>
      act(() => {
        fetchPromise = result.current.fetchSteps()
      })

      expect(result.current.isLoadingSteps).toBe(true)
      expect(result.current.isStepsExpanded).toBe(true)

      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ tips: mockSupplementaryTips }),
        } as Response)
        await fetchPromise
      })

      expect(result.current.isLoadingSteps).toBe(false)
    })

    it('auto-retries once on 500 and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tips: mockTips }),
        })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        const promise = result.current.fetchSteps()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.steps).toEqual(mockTips)
      expect(result.current.stepsError).toBeNull()
    })

    it('auto-retries once on 429 and shows error if retry also fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'AI service is busy', code: 'provider_busy' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'AI service is busy', code: 'provider_busy' }),
        })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        const promise = result.current.fetchSteps()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.stepsError).toBe(stepsErrors.providerBusy)
    })

    it('auto-retries once on a codeless 429', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'Too many requests' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tips: mockTips }),
        })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        const promise = result.current.fetchSteps()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.steps).toEqual(mockTips)
    })

    // The household's own hourly limit and monthly AI cap will not clear in 2s,
    // and a cap retry would spend another hourly token (HON-893).
    it.each([
      ['rate_limited', 'Rate limit exceeded', stepsErrors.rateLimited],
      ['ai_cap_exceeded', 'AI usage cap exceeded', stepsErrors.aiCapExceeded],
    ])('does not retry a %s 429', async (code, error, expected) => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error, code }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.stepsError).toBe(expected)
    })

    it('auto-retries once on 502 and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: () => Promise.resolve({ error: 'Upstream unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tips: mockTips }),
        })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        const promise = result.current.fetchSteps()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.steps).toEqual(mockTips)
      expect(result.current.stepsError).toBeNull()
    })

    it('does not retry on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Entry not found', code: 'entry_not_found' }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.stepsError).toBe(stepsErrors.entryNotFound)
    })

    // 504 is the one 5xx that must not retry: it means the route already spent
    // its full 45s AI budget, so a second attempt costs another 45s of spinner
    // (~92s total) to re-learn what the first one proved (HON-693). The other
    // 5xx codes fail fast, which is why they still retry.
    it('does not retry on 504, so a timeout fails fast instead of doubling the wait', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: () =>
          Promise.resolve({ error: 'Request timed out. Please try again.', code: 'tips_timeout' }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.stepsError).toBe(stepsErrors.tipsTimeout)
    })

    it('does not retry the kill-switch 503, and shows catalog copy rather than the server prose (HON-868)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({
            error: 'AI generation is temporarily disabled',
            code: 'generation_disabled',
          }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.stepsError).toBe(stepsErrors.generationDisabled)
    })

    // The route's `error` is English on every branch; rendering it would show
    // English to an Estonian household (HON-888).
    it('shows catalog copy, not the route prose, for a 500 and logs the prose', async () => {
      const serverError = {
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({ error: "Couldn't generate tips. Try again.", code: 'tips_failed' }),
      }
      mockFetch.mockResolvedValueOnce(serverError).mockResolvedValueOnce(serverError)

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        const promise = result.current.fetchSteps()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.stepsError).toBe(stepsErrors.tipsFailed)
      expect(result.current.stepsError).not.toBe("Couldn't generate tips. Try again.")
      expect(console.error).toHaveBeenCalledWith(
        '[preparation-tips] request failed',
        expect.objectContaining({
          status: 500,
          code: 'tips_failed',
          error: "Couldn't generate tips. Try again.",
        }),
      )
    })

    it('falls back to the generic copy for a code this build does not know', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Something new', code: 'code_from_a_newer_deploy' }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBe(stepsErrors.tipsFailed)
    })

    // The platform kills the function at `maxDuration` with a 504 whose body
    // the route never wrote, so there is no code — the status still picks the
    // timeout copy.
    it('shows the timeout copy for a codeless 504', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.stepsError).toBe(stepsErrors.tipsTimeout)
    })

    it('clears previous error on new fetch', async () => {
      // First call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBe(stepsErrors.tipsFailed)

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      await act(async () => {
        await result.current.fetchSteps()
      })

      expect(result.current.stepsError).toBeNull()
      expect(result.current.steps).toEqual(mockTips)
    })
  })

  describe('handleHowToPrepare', () => {
    it('fetches tips when none are cached', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      await act(async () => {
        await result.current.handleHowToPrepare()
      })

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(result.current.steps).toEqual(mockTips)
      expect(result.current.isStepsExpanded).toBe(true)
    })

    it('toggles expanded state when tips are already cached', async () => {
      const { result } = renderHook(
        () => useMealSteps({ ...defaultOptions, initialSteps: mockTips }),
        { wrapper },
      )

      // First call: expand
      act(() => {
        result.current.handleHowToPrepare()
      })

      expect(result.current.isStepsExpanded).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()

      // Second call: collapse
      act(() => {
        result.current.handleHowToPrepare()
      })

      expect(result.current.isStepsExpanded).toBe(false)
    })
  })

  // For a caller that has just changed one of the inputs the tips were built
  // from — the entry's serving count — which the server answers by nulling the
  // cached copy (HON-681). Clearing the state is only half of it.
  describe('cancelSteps', () => {
    it('clears tips, error and expansion', () => {
      const { result } = renderHook(
        () => useMealSteps({ ...defaultOptions, initialSteps: mockTips }),
        { wrapper },
      )

      act(() => {
        result.current.handleHowToPrepare()
      })
      expect(result.current.isStepsExpanded).toBe(true)

      act(() => {
        result.current.cancelSteps()
      })

      expect(result.current.steps).toBeNull()
      expect(result.current.stepsError).toBeNull()
      expect(result.current.isStepsExpanded).toBe(false)
    })

    it('aborts a generation in flight so it cannot repopulate the tips', async () => {
      // Generation takes up to 45s, and the serving control stays enabled
      // throughout. Without the abort the original request resolves after the
      // cancel and writes the stale tips back — after which handleHowToPrepare
      // short-circuits on them forever, while the stored row is null.
      let resolvePromise: (value: Response) => void
      mockFetch.mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            resolvePromise = resolve
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      )

      const { result } = renderHook(() => useMealSteps(defaultOptions), { wrapper })

      let fetchPromise: Promise<void>
      act(() => {
        fetchPromise = result.current.fetchSteps()
      })
      expect(result.current.isLoadingSteps).toBe(true)
      // The mutation hands the request to `fetch` a few microtasks later; the
      // cancel must land while it is genuinely in flight.
      await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())

      act(() => {
        result.current.cancelSteps()
      })

      await act(async () => {
        // The in-flight request answers after the cancel, as it would in the
        // browser — the abort is what keeps its payload out of the state.
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ tips: mockTips }),
        } as Response)
        await fetchPromise
      })

      expect(result.current.steps).toBeNull()
      expect(result.current.stepsError).toBeNull()
      expect(result.current.isStepsExpanded).toBe(false)
    })
  })
})
