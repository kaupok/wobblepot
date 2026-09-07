import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  WINDOW_STORAGE_KEY,
  getStoredWindowDays,
  parseWindowDays,
  useShoppingWindow,
} from './use-shopping-window'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockClear()
  localStorage.clear()
})

describe('parseWindowDays', () => {
  it('accepts 14 as a string or a number', () => {
    expect(parseWindowDays('14')).toBe(14)
    expect(parseWindowDays(14)).toBe(14)
  })

  it('falls back to 7 for anything else', () => {
    expect(parseWindowDays('7')).toBe(7)
    expect(parseWindowDays(null)).toBe(7)
    expect(parseWindowDays(undefined)).toBe(7)
    expect(parseWindowDays('30')).toBe(7)
    expect(parseWindowDays('fourteen')).toBe(7)
  })
})

describe('getStoredWindowDays', () => {
  it('returns 7 when nothing is stored', () => {
    expect(getStoredWindowDays()).toBe(7)
  })

  it('returns the stored window', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    expect(getStoredWindowDays()).toBe(14)
  })

  it('ignores a value it does not recognise', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, 'banana')
    expect(getStoredWindowDays()).toBe(7)
  })
})

describe('useShoppingWindow', () => {
  describe('mount reconcile', () => {
    it('navigates to the stored window when the rendered window disagrees', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      renderHook(() => useShoppingWindow(7))

      expect(push).toHaveBeenCalledWith('/shopping?days=14')
    })

    it('stays put when the rendered window already matches', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      renderHook(() => useShoppingWindow(14))

      expect(push).not.toHaveBeenCalled()
    })

    it('stays put on the default window with no stored preference', () => {
      renderHook(() => useShoppingWindow(7))

      expect(push).not.toHaveBeenCalled()
    })

    // The populated list is the case HON-624 fixes: before the shared header it
    // never read the key at all, so a saved 14 was silently dropped on any
    // visit without `?days=`.
    it('reconciles a stored 14 back over an unparameterised visit', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      const { rerender } = renderHook(({ days }) => useShoppingWindow(days), {
        initialProps: { days: 7 },
      })
      expect(push).toHaveBeenCalledWith('/shopping?days=14')

      // The push lands: the page re-renders at 14 and the reconcile goes quiet
      // rather than bouncing.
      push.mockClear()
      rerender({ days: 14 })
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('setWindowDays', () => {
    it('persists the choice and navigates to it', () => {
      const { result } = renderHook(() => useShoppingWindow(7))

      act(() => result.current.setWindowDays('14'))

      expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('14')
      expect(push).toHaveBeenCalledWith('/shopping?days=14')
    })

    it('narrows back to 7 — the round trip the picker exists for', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')
      const { result } = renderHook(() => useShoppingWindow(14))

      act(() => result.current.setWindowDays('7'))

      expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('7')
      expect(push).toHaveBeenCalledWith('/shopping?days=7')
    })

    it('coerces an unexpected value to the default rather than routing to it', () => {
      const { result } = renderHook(() => useShoppingWindow(7))

      act(() => result.current.setWindowDays('30'))

      expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('7')
      expect(push).toHaveBeenCalledWith('/shopping?days=7')
    })
  })
})
