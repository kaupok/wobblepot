import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useIngredientAvailability } from './use-ingredient-availability'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useIngredientAvailability', () => {
  const mockOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('returns empty toggling set and overrides initially', () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
      wrapper,
    })

    expect(result.current.togglingIngredientIds.size).toBe(0)
    expect(result.current.optimisticOverrides.size).toBe(0)
  })

  describe('adding to pantry (hasIt=true)', () => {
    it('posts to /api/pantry and calls onRefresh on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', true)
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/pantry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientId: 'ing-1' }),
        })
        expect(mockOnRefresh).toHaveBeenCalledOnce()
      })
    })

    it('handles 409 conflict silently and still calls onRefresh', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Already exists' }),
      })

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', true)
      })

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalledOnce()
      })
    })

    it('shows toast on non-409 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })

      const { toast } = await import('sonner')
      const { wrapper } = createQueryWrapper()

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', true)
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server error')
        expect(mockOnRefresh).not.toHaveBeenCalled()
      })
    })
  })

  describe('removing from pantry (hasIt=false)', () => {
    it('sends DELETE to /api/pantry/by-ingredient/:id and calls onRefresh', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-2', false)
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/pantry/by-ingredient/ing-2', {
          method: 'DELETE',
        })
        expect(mockOnRefresh).toHaveBeenCalledOnce()
      })
    })

    it('handles 404 silently and still calls onRefresh', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 })

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-2', false)
      })

      await waitFor(() => {
        expect(mockOnRefresh).toHaveBeenCalledOnce()
      })
    })

    it('shows toast on non-404 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Delete failed' }),
      })

      const { toast } = await import('sonner')
      const { wrapper } = createQueryWrapper()

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-2', false)
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Delete failed')
        expect(mockOnRefresh).not.toHaveBeenCalled()
      })
    })
  })

  it('shows generic toast on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { toast } = await import('sonner')
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
      wrapper,
    })

    act(() => {
      result.current.handleToggleAvailability('ing-1', true)
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Network error')
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
  })

  describe('optimistic overrides', () => {
    it('sets optimistic override immediately on toggle', async () => {
      let resolvePromise: (value: Response) => void
      mockFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          resolvePromise = resolve
        }),
      )

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', true)
      })

      // Optimistic override should be set immediately
      expect(result.current.optimisticOverrides.get('ing-1')).toBe(true)

      // Resolve
      await act(async () => {
        resolvePromise!({ ok: true, json: () => Promise.resolve({}) } as Response)
      })

      // Override persists on success (server state will match via refresh)
      await waitFor(() => {
        expect(result.current.optimisticOverrides.get('ing-1')).toBe(true)
      })
    })

    it('reverts optimistic override on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', true)
      })

      // Override should be reverted on error
      await waitFor(() => {
        expect(result.current.optimisticOverrides.has('ing-1')).toBe(false)
      })
    })

    it('reverts optimistic override on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { wrapper } = createQueryWrapper()
      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }), {
        wrapper,
      })

      act(() => {
        result.current.handleToggleAvailability('ing-1', false)
      })

      await waitFor(() => {
        expect(result.current.optimisticOverrides.has('ing-1')).toBe(false)
      })
    })
  })
})
