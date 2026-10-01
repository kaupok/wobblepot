import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWakeLock } from './use-wake-lock'

interface FakeSentinel {
  release: ReturnType<typeof vi.fn>
}

let sentinels: FakeSentinel[]
let request: ReturnType<typeof vi.fn>
let visibility: DocumentVisibilityState

function installWakeLock() {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  })
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

// Lets the hook's awaited `request()` settle.
const flush = () => act(async () => {})

beforeEach(() => {
  sentinels = []
  request = vi.fn(async () => {
    const sentinel = { release: vi.fn(async () => {}) }
    sentinels.push(sentinel)
    return sentinel
  })
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  installWakeLock()
})

afterEach(() => {
  vi.restoreAllMocks()
  // `delete` rather than reassigning, so the next test sees a missing API.
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

describe('useWakeLock', () => {
  it('requests a screen lock when active', async () => {
    renderHook(() => useWakeLock(true))
    await flush()
    expect(request).toHaveBeenCalledExactlyOnceWith('screen')
  })

  it('requests nothing while inactive', async () => {
    renderHook(() => useWakeLock(false))
    await flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('releases the lock when it becomes inactive', async () => {
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    })
    await flush()
    rerender({ active: false })
    await flush()
    expect(sentinels[0]!.release).toHaveBeenCalledOnce()
  })

  it('releases the lock on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    unmount()
    expect(sentinels[0]!.release).toHaveBeenCalledOnce()
  })

  it('re-requests when the page becomes visible again', async () => {
    renderHook(() => useWakeLock(true))
    await flush()
    // The browser drops the lock on hide; nothing to request while hidden.
    act(() => setVisibility('hidden'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not request while the page is hidden', async () => {
    visibility = 'hidden'
    renderHook(() => useWakeLock(true))
    await flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('stops listening for visibility once inactive', async () => {
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    })
    await flush()
    rerender({ active: false })
    act(() => setVisibility('visible'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('gives back a lock granted after it was deactivated', async () => {
    let grant!: (sentinel: FakeSentinel) => void
    const late = { release: vi.fn(async () => {}) }
    request.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)))
    const { unmount } = renderHook(() => useWakeLock(true))
    unmount()
    await act(async () => grant(late))
    expect(late.release).toHaveBeenCalledOnce()
  })

  it('is a no-op where the Wake Lock API is missing', async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock
    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    expect(() => unmount()).not.toThrow()
  })

  it('swallows a refused request without logging', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    request.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    unmount()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
