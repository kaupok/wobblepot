import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { RefreshOnResume } from './RefreshOnResume'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Move the clock without firing timers, as a suspended app sees it. */
function jumpTo(iso: string) {
  vi.setSystemTime(new Date(iso))
}

function renderAt(iso: string, renderedDate: string, timezone = 'Europe/Tallinn') {
  jumpTo(iso)
  const { wrapper, queryClient } = createQueryWrapper()
  const view = render(<RefreshOnResume renderedDate={renderedDate} timezone={timezone} />, {
    wrapper,
  })
  return { ...view, queryClient }
}

describe('RefreshOnResume', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    router.refresh.mockClear()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Europe/Tallinn is UTC+2 in November, so 20:00Z is 22:00 on 2026-11-01.
  it('refreshes once when the app comes back on the next household day', () => {
    renderAt('2026-11-01T20:00:00Z', '2026-11-01')

    setVisibility('hidden')
    jumpTo('2026-11-02T06:00:00Z') // 08:00 household time
    setVisibility('visible')

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes after a short absence that crosses the household midnight', () => {
    renderAt('2026-11-01T21:58:00Z', '2026-11-01') // 23:58

    setVisibility('hidden')
    jumpTo('2026-11-01T22:01:00Z') // 00:01, three minutes later
    setVisibility('visible')

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh after 3 minutes away on the same day', () => {
    renderAt('2026-11-01T10:00:00Z', '2026-11-01')

    setVisibility('hidden')
    jumpTo('2026-11-01T10:03:00Z')
    setVisibility('visible')

    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('refreshes once after 11 minutes away on the same day', () => {
    renderAt('2026-11-01T10:00:00Z', '2026-11-01')

    setVisibility('hidden')
    jumpTo('2026-11-01T10:11:00Z')
    setVisibility('visible')

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on a back-forward cache restore, not on a fresh page show', () => {
    renderAt('2026-11-01T10:00:00Z', '2026-11-01')

    setVisibility('hidden')
    jumpTo('2026-11-01T10:11:00Z')
    visibility = 'visible'
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    })
    expect(router.refresh).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes at the household midnight while visible, with no visibility event', () => {
    renderAt('2026-11-01T21:59:30Z', '2026-11-01') // 23:59:30

    act(() => {
      vi.advanceTimersByTime(29_000)
    })
    expect(router.refresh).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not fire the midnight timer while hidden', () => {
    renderAt('2026-11-01T21:59:30Z', '2026-11-01')

    setVisibility('hidden')
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    })

    expect(router.refresh).not.toHaveBeenCalled()
  })

  // Pacific/Auckland is UTC+13 in November: its day turns at 11:00Z, while
  // the device's UTC or Tallinn date stays 2026-11-01.
  it('follows the household timezone, not the device clock, for the day boundary', () => {
    renderAt('2026-11-01T10:59:30Z', '2026-11-01', 'Pacific/Auckland')

    act(() => {
      vi.advanceTimersByTime(31_000)
    })

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  // America/Los_Angeles is UTC-8 after 2026-11-01, so UTC midnight is 16:00 there.
  it('does not refresh at the device midnight when the household day has not changed', () => {
    renderAt('2026-11-02T23:59:30Z', '2026-11-02', 'America/Los_Angeles')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('waits for an in-flight mutation to settle, then refreshes once', async () => {
    const { queryClient } = renderAt('2026-11-01T10:00:00Z', '2026-11-01')

    let settle!: () => void
    const saving = new Promise<void>((resolve) => {
      settle = resolve
    })
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: () => saving })
    let done!: Promise<unknown>
    await act(async () => {
      done = mutation.execute(undefined)
      // TanStack's notify manager batches on a timer, which is faked here.
      await vi.advanceTimersByTimeAsync(0)
    })

    setVisibility('hidden')
    jumpTo('2026-11-02T06:00:00Z')
    setVisibility('visible')
    expect(router.refresh).not.toHaveBeenCalled()

    await act(async () => {
      settle()
      await done
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('stops listening on unmount', () => {
    const { unmount } = renderAt('2026-11-01T21:59:30Z', '2026-11-01')
    unmount()

    setVisibility('hidden')
    jumpTo('2026-11-02T06:00:00Z')
    setVisibility('visible')
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)

    expect(router.refresh).not.toHaveBeenCalled()
  })
})
