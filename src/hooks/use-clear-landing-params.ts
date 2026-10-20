'use client'

import { useEffect } from 'react'

/**
 * Removes the params a redirect left in the URL once the page has read them,
 * so a reload does not show the landing message again. Used by the
 * `/account` landings: email verification, email change and Google connect.
 *
 * @param active - true when a landing was read; nothing is cleared otherwise
 * @param params - the param names to remove
 */
export function useClearLandingParams(active: boolean, params: readonly string[]) {
  const key = params.join('&')
  useEffect(() => {
    if (!active) return
    const url = new URL(window.location.href)
    for (const param of key.split('&')) url.searchParams.delete(param)
    // Native `replaceState`: the App Router syncs with it, and keeping
    // `history.state` keeps the router's own entry intact.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [active, key])
}
