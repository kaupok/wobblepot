'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Return focus to a control once a pending request has settled.
 *
 * A form that disables its controls while a request is pending loses focus:
 * Chromium blurs a focused element when it becomes disabled, so after a failed
 * submit focus sits on `<body>` and a keyboard user is sent back to the top of
 * the page. Call `requestRefocus()` on the failure path and attach `ref` to the
 * submit button; the button takes focus once `isPending` is false again, when
 * it can hold focus. Nothing happens on a path that did not request it, so a
 * successful submit keeps its own focus behaviour.
 *
 * See CLAUDE.md → Focus management.
 */
export function useRefocusAfterPending<T extends HTMLElement = HTMLButtonElement>(
  isPending: boolean,
) {
  const ref = useRef<T>(null)
  const refocusRequested = useRef(false)

  useEffect(() => {
    if (isPending || !refocusRequested.current) return
    refocusRequested.current = false
    ref.current?.focus()
  }, [isPending])

  const requestRefocus = useCallback(() => {
    refocusRequested.current = true
  }, [])

  return { ref, requestRefocus }
}
