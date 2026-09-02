import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './use-debounced-value'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('tom'))

    expect(result.current).toBe('tom')
  })

  it('holds the previous value until the delay elapses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'tom' },
    })

    rerender({ value: 'tomato' })
    expect(result.current).toBe('tom')

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current).toBe('tom')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('tomato')
  })

  it('coalesces a burst of changes into the final value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: '' },
    })

    for (const value of ['t', 'to', 'tom', 'toma']) {
      rerender({ value })
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }

    // 400 ms of typing, but never 300 ms of quiet — still the initial value.
    expect(result.current).toBe('')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('toma')
  })

  it('honours a custom delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(result.current).toBe('b')
  })

  it('cancels the pending update on unmount', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'tom' },
    })

    rerender({ value: 'tomato' })
    unmount()

    // A leaked timer would call setState on an unmounted hook here.
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('debounces non-string values too', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: { page: 1 } },
    })

    rerender({ value: { page: 2 } })
    expect(result.current).toEqual({ page: 1 })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toEqual({ page: 2 })
  })
})
