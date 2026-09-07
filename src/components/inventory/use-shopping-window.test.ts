import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  WINDOW_STORAGE_KEY,
  getStoredWindowDays,
  parseWindowDays,
  useShoppingWindow,
} from './use-shopping-window'

const push = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
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
  // Null rather than 7: "no preference" must stay distinguishable from "chose
  // 7", or the reconcile overrides an explicit `?days=14` for everyone who has
  // never used the picker.
  it('returns null when nothing is stored', () => {
    expect(getStoredWindowDays()).toBeNull()
  })

  it('returns the stored window', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    expect(getStoredWindowDays()).toBe(14)

    localStorage.setItem(WINDOW_STORAGE_KEY, '7')
    expect(getStoredWindowDays()).toBe(7)
  })

  it('treats an unrecognised value as no preference, not as 7', () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, 'banana')
    expect(getStoredWindowDays()).toBeNull()
  })
})

describe('useShoppingWindow', () => {
  describe('mount reconcile', () => {
    it('navigates to the stored window when the rendered window disagrees', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      renderHook(() => useShoppingWindow(7))

      expect(replace).toHaveBeenCalledWith('/shopping?days=14')
    })

    // `push` would leave the pre-reconcile URL in history; going Back to it
    // re-runs the effect and pushes forward again, trapping the user on
    // `/shopping`. Every in-app link to the list is a bare `/shopping`, so this
    // would fire on every visit for a 14-day user.
    it('replaces rather than pushes, so Back is not trapped', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      renderHook(() => useShoppingWindow(7))

      expect(push).not.toHaveBeenCalled()
    })

    it('stays put when the rendered window already matches', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      renderHook(() => useShoppingWindow(14))

      expect(replace).not.toHaveBeenCalled()
    })

    // A bookmark or a shared `/shopping?days=14` must survive for a user who
    // has never touched the picker. Before this guard the absent key read as an
    // explicit 7 and bounced them to the narrow window.
    it('leaves an explicit window alone when there is no stored preference', () => {
      renderHook(() => useShoppingWindow(14))

      expect(replace).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })

    it('leaves an explicit window alone when the stored value is unrecognised', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, 'banana')

      renderHook(() => useShoppingWindow(14))

      expect(replace).not.toHaveBeenCalled()
    })

    it('stays put on the default window with no stored preference', () => {
      renderHook(() => useShoppingWindow(7))

      expect(replace).not.toHaveBeenCalled()
    })

    // The populated list is the case HON-624 fixes: before the shared header it
    // never read the key at all, so a saved 14 was silently dropped on any
    // visit without `?days=`.
    it('reconciles a stored 14 back over an unparameterised visit', () => {
      localStorage.setItem(WINDOW_STORAGE_KEY, '14')

      const { rerender } = renderHook(({ days }) => useShoppingWindow(days), {
        initialProps: { days: 7 },
      })
      expect(replace).toHaveBeenCalledWith('/shopping?days=14')

      // The navigation lands: the page re-renders at 14 and the reconcile goes
      // quiet rather than bouncing.
      replace.mockClear()
      rerender({ days: 14 })
      expect(replace).not.toHaveBeenCalled()
    })
  })

  describe('setWindowDays', () => {
    it('persists the choice and pushes it, so Back undoes it', () => {
      const { result } = renderHook(() => useShoppingWindow(7))

      act(() => result.current.setWindowDays('14'))

      expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('14')
      expect(push).toHaveBeenCalledWith('/shopping?days=14')
      expect(replace).not.toHaveBeenCalled()
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
