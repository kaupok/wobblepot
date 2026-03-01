import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMealTips } from './use-meal-tips'
import type { StructuredTips } from '@/components/meal-plan/types'

const mockFetch = vi.fn()
global.fetch = mockFetch

const defaultOptions = {
  planId: 'plan-1',
  entryId: 'entry-1',
}

const mockTips: StructuredTips = {
  equipment: ['Large skillet', 'Cutting board'],
  steps: ['Heat oil in skillet', 'Cook chicken at 180°C for 25 minutes'],
  pitfalls: ["Don't overcook the chicken"],
  tip: 'Let the chicken rest for 5 minutes before slicing',
}

const mockSupplementaryTips: StructuredTips = {
  pitfalls: ["Don't overcook the chicken"],
  tip: 'Let the chicken rest for 5 minutes before slicing',
}

describe('useMealTips', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('returns correct defaults with no initialTips', () => {
      const { result } = renderHook(() => useMealTips(defaultOptions))

      expect(result.current.tips).toBeNull()
      expect(result.current.isLoadingTips).toBe(false)
      expect(result.current.tipsError).toBeNull()
      expect(result.current.isTipsExpanded).toBe(false)
    })

    it('uses initialTips when provided', () => {
      const { result } = renderHook(() => useMealTips({ ...defaultOptions, initialTips: mockTips }))

      expect(result.current.tips).toEqual(mockTips)
    })
  })

  describe('fetchTips', () => {
    it('fetches tips and updates state on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/meal-plans/plan-1/entries/entry-1/preparation-tips',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(result.current.tips).toEqual(mockTips)
      expect(result.current.isLoadingTips).toBe(false)
      expect(result.current.isTipsExpanded).toBe(true)
      expect(result.current.tipsError).toBeNull()
    })

    it('sets error state on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
      })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(result.current.tips).toBeNull()
      expect(result.current.tipsError).toBe('Rate limit exceeded')
      expect(result.current.isLoadingTips).toBe(false)
    })

    it('sets generic error message on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'))

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(result.current.tipsError).toBe('Failed to fetch')
      expect(result.current.isLoadingTips).toBe(false)
    })

    it('sets generic fallback when error is not an Error instance', async () => {
      mockFetch.mockRejectedValue('something went wrong')

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(result.current.tipsError).toBe("Couldn't generate tips. Try again.")
    })

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: Response) => void
      mockFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          resolvePromise = resolve
        }),
      )

      const { result } = renderHook(() => useMealTips(defaultOptions))

      let fetchPromise: Promise<void>
      act(() => {
        fetchPromise = result.current.fetchTips()
      })

      expect(result.current.isLoadingTips).toBe(true)
      expect(result.current.isTipsExpanded).toBe(true)

      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ tips: mockSupplementaryTips }),
        } as Response)
        await fetchPromise
      })

      expect(result.current.isLoadingTips).toBe(false)
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

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        const promise = result.current.fetchTips()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.tips).toEqual(mockTips)
      expect(result.current.tipsError).toBeNull()
    })

    it('auto-retries once on 429 and shows error if retry also fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'AI service is busy' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'AI service is busy' }),
        })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        const promise = result.current.fetchTips()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.tipsError).toBe('AI service is busy')
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

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        const promise = result.current.fetchTips()
        await vi.advanceTimersByTimeAsync(2000)
        await promise
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.tips).toEqual(mockTips)
      expect(result.current.tipsError).toBeNull()
    })

    it('does not retry on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Entry not found' }),
      })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(result.current.tipsError).toBe('Entry not found')
    })

    it('clears previous error on new fetch', async () => {
      // First call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(result.current.tipsError).toBe('Failed')

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      await act(async () => {
        await result.current.fetchTips()
      })

      expect(result.current.tipsError).toBeNull()
      expect(result.current.tips).toEqual(mockTips)
    })
  })

  describe('handleHowToPrepare', () => {
    it('fetches tips when none are cached', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tips: mockTips }),
      })

      const { result } = renderHook(() => useMealTips(defaultOptions))

      await act(async () => {
        await result.current.handleHowToPrepare()
      })

      expect(mockFetch).toHaveBeenCalledOnce()
      expect(result.current.tips).toEqual(mockTips)
      expect(result.current.isTipsExpanded).toBe(true)
    })

    it('toggles expanded state when tips are already cached', async () => {
      const { result } = renderHook(() => useMealTips({ ...defaultOptions, initialTips: mockTips }))

      // First call: expand
      act(() => {
        result.current.handleHowToPrepare()
      })

      expect(result.current.isTipsExpanded).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()

      // Second call: collapse
      act(() => {
        result.current.handleHowToPrepare()
      })

      expect(result.current.isTipsExpanded).toBe(false)
    })
  })

  describe('hideTips', () => {
    it('sets expanded to false', () => {
      const { result } = renderHook(() =>
        useMealTips({ ...defaultOptions, initialTips: mockSupplementaryTips }),
      )

      // Expand first
      act(() => {
        result.current.handleHowToPrepare()
      })

      expect(result.current.isTipsExpanded).toBe(true)

      // Hide
      act(() => {
        result.current.hideTips()
      })

      expect(result.current.isTipsExpanded).toBe(false)
    })
  })
})
