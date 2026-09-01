import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useIngredientSearch, type IngredientResult } from './use-ingredient-search'

const ingredients: IngredientResult[] = [
  { id: '1', name: 'Tomato', category: 'vegetable', defaultUnit: 'g' },
  { id: '2', name: 'Tofu', category: 'protein', defaultUnit: 'g' },
]

const mockFetch = vi.fn()
global.fetch = mockFetch

function renderSearch(initialQuery = '') {
  const { wrapper } = createQueryWrapper()
  return renderHook(({ query }) => useIngredientSearch(query), {
    initialProps: { query: initialQuery },
    wrapper,
  })
}

/** Advance past the 300 ms debounce and let the query settle. */
async function flushDebounce(ms = 350) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function searchUrlsCalled() {
  return mockFetch.mock.calls.map(([url]) => String(url))
}

describe('useIngredientSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ingredients }) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not fetch for an empty query', async () => {
    const { result } = renderSearch('')

    await flushDebounce()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
  })

  it('does not fetch for a whitespace-only query', async () => {
    const { rerender } = renderSearch('')

    rerender({ query: '   ' })
    await flushDebounce()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fires exactly one request per debounce window', async () => {
    const { result, rerender } = renderSearch('')

    // A burst of keystrokes inside a single window.
    for (const query of ['t', 'to', 'tom']) {
      rerender({ query })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
    }

    expect(mockFetch).not.toHaveBeenCalled()

    await flushDebounce()

    await waitFor(() => expect(result.current.data).toEqual(ingredients))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(searchUrlsCalled()).toEqual(['/api/ingredients?search=tom'])

    // A new window fires its own single request.
    rerender({ query: 'tofu' })
    await flushDebounce()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(searchUrlsCalled()[1]).toBe('/api/ingredients?search=tofu')
  })

  it('unwraps the ingredients array from the response envelope', async () => {
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()

    await waitFor(() => expect(result.current.data).toEqual(ingredients))
  })

  it('trims and encodes the search term', async () => {
    const { rerender } = renderSearch('')

    rerender({ query: '  cottage cheese & co  ' })
    await flushDebounce()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(searchUrlsCalled()[0]).toBe('/api/ingredients?search=cottage%20cheese%20%26%20co')
  })

  it('clears results without waiting for the debounce when the query empties', async () => {
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()
    await waitFor(() => expect(result.current.data).toEqual(ingredients))

    rerender({ query: '' })

    // No timer advance — the empty query disables the query immediately.
    await waitFor(() => expect(result.current.data).toBeUndefined())
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('drops the previous term instead of reopening it under a new query', async () => {
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()
    await waitFor(() => expect(result.current.data).toEqual(ingredients))

    // Selecting a result clears the field, then the user types something
    // unrelated inside the same debounce window — `debounced` still holds
    // 'tom', and serving its cached results would let Enter re-pick them.
    rerender({ query: '' })
    rerender({ query: 'b' })

    await waitFor(() => expect(result.current.data).toBeUndefined())
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await flushDebounce()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(searchUrlsCalled()[1]).toBe('/api/ingredients?search=b')
  })

  it('keeps the current results while the user extends the term', async () => {
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()
    await waitFor(() => expect(result.current.data).toEqual(ingredients))

    // 'toma' extends 'tom', so the dropdown shouldn't blank out mid-typing.
    rerender({ query: 'toma' })
    expect(result.current.data).toEqual(ingredients)
  })

  it('drops the results when the user deletes back to a shorter term', async () => {
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()
    await waitFor(() => expect(result.current.data).toEqual(ingredients))

    rerender({ query: 'to' })

    await waitFor(() => expect(result.current.data).toBeUndefined())
  })

  it('surfaces the error from a failed request', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Failed to search ingredients' }),
    })
    const { result, rerender } = renderSearch('')

    rerender({ query: 'tom' })
    await flushDebounce()

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.error?.message).toBe('Failed to search ingredients')
  })
})
