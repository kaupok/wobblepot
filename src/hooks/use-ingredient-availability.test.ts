import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useIngredientAvailability } from './use-ingredient-availability'

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

  it('returns empty toggling set initially', () => {
    const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

    expect(result.current.togglingIngredientIds.size).toBe(0)
  })

  describe('adding to pantry (hasIt=true)', () => {
    it('posts to /api/pantry and calls onRefresh on success', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-1', true)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: 'ing-1' }),
      })
      expect(mockOnRefresh).toHaveBeenCalledOnce()
    })

    it('handles 409 conflict silently and still calls onRefresh', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Already exists' }),
      })

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-1', true)
      })

      expect(mockOnRefresh).toHaveBeenCalledOnce()
    })

    it('shows toast on non-409 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })

      const { toast } = await import('sonner')

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-1', true)
      })

      expect(toast.error).toHaveBeenCalledWith('Server error')
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
  })

  describe('removing from pantry (hasIt=false)', () => {
    it('sends DELETE to /api/pantry/by-ingredient/:id and calls onRefresh', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-2', false)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/pantry/by-ingredient/ing-2', {
        method: 'DELETE',
      })
      expect(mockOnRefresh).toHaveBeenCalledOnce()
    })

    it('handles 404 silently and still calls onRefresh', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 })

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-2', false)
      })

      expect(mockOnRefresh).toHaveBeenCalledOnce()
    })

    it('shows toast on non-404 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Delete failed' }),
      })

      const { toast } = await import('sonner')

      const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

      await act(async () => {
        await result.current.handleToggleAvailability('ing-2', false)
      })

      expect(toast.error).toHaveBeenCalledWith('Delete failed')
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
  })

  it('shows generic toast on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { toast } = await import('sonner')

    const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

    await act(async () => {
      await result.current.handleToggleAvailability('ing-1', true)
    })

    expect(toast.error).toHaveBeenCalledWith('Network error')
    expect(mockOnRefresh).not.toHaveBeenCalled()
  })

  it('tracks toggling state during request', async () => {
    let resolvePromise: (value: Response) => void
    mockFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePromise = resolve
      }),
    )

    const { result } = renderHook(() => useIngredientAvailability({ onRefresh: mockOnRefresh }))

    // Start the toggle (don't await)
    let togglePromise: Promise<void>
    act(() => {
      togglePromise = result.current.handleToggleAvailability('ing-3', true)
    })

    // While in-flight, the ingredient should be in the toggling set
    expect(result.current.togglingIngredientIds.has('ing-3')).toBe(true)

    // Resolve the fetch
    await act(async () => {
      resolvePromise!({ ok: true, json: () => Promise.resolve({}) } as Response)
      await togglePromise
    })

    // After completion, the ingredient should be removed from toggling set
    await waitFor(() => {
      expect(result.current.togglingIngredientIds.has('ing-3')).toBe(false)
    })
  })
})
