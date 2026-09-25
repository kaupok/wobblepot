'use client'

import { useMemo, useSyncExternalStore } from 'react'

/**
 * Whether the page is scrolled past the top, with hysteresis: it turns on once
 * `window.scrollY` passes `hideAt` and off again only below `showAt`, so a
 * finger resting near the threshold cannot flicker the header's logo in and
 * out. Reads happen at most once a frame. The server snapshot is `false`, so
 * a page reloaded mid-scroll hydrates at rest and folds on the first frame.
 */
export function useScrolled(hideAt = 48, showAt = 8): boolean {
  const store = useMemo(() => createScrolledStore(hideAt, showAt), [hideAt, showAt])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot)
}

const getServerSnapshot = () => false

function createScrolledStore(hideAt: number, showAt: number) {
  let scrolled = false

  const read = () => {
    const y = window.scrollY
    scrolled = scrolled ? y > showAt : y > hideAt
    return scrolled
  }

  return {
    getSnapshot: read,
    subscribe(onChange: () => void) {
      // `pending` rather than testing the frame id: the callback clears it,
      // and a frame that ran before `requestAnimationFrame` returned (a
      // synchronous stub in tests) would otherwise leave the id set for good.
      let pending = false
      let frame = 0
      const onScroll = () => {
        if (pending) return
        pending = true
        frame = requestAnimationFrame(() => {
          pending = false
          const before = scrolled
          if (read() !== before) onChange()
        })
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      return () => {
        window.removeEventListener('scroll', onScroll)
        if (pending) cancelAnimationFrame(frame)
      }
    },
  }
}
