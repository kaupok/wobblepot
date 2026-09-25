import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrolled } from './use-scrolled'

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  window.dispatchEvent(new Event('scroll'))
}

describe('useScrolled', () => {
  beforeEach(() => {
    scrollTo(0)
    // Frames run synchronously, so a scroll event settles inside `act`.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false at the top of the page', () => {
    const { result } = renderHook(() => useScrolled())
    expect(result.current).toBe(false)
  })

  it('turns on only past the hide threshold', () => {
    const { result } = renderHook(() => useScrolled(48, 8))

    act(() => scrollTo(48))
    expect(result.current).toBe(false)

    act(() => scrollTo(49))
    expect(result.current).toBe(true)
  })

  it('stays on until the page is back near the top', () => {
    const { result } = renderHook(() => useScrolled(48, 8))

    act(() => scrollTo(200))
    expect(result.current).toBe(true)

    // Between the two thresholds: still on, so a finger resting here does
    // not flicker the logo.
    act(() => scrollTo(30))
    expect(result.current).toBe(true)

    act(() => scrollTo(8))
    expect(result.current).toBe(false)
  })

  it('reads the position on mount when the page is already scrolled', () => {
    scrollTo(300)
    const { result } = renderHook(() => useScrolled())
    expect(result.current).toBe(true)
  })

  it('stops listening on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useScrolled())
    unmount()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
