// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClearLandingParams } from './use-clear-landing-params'

describe('useClearLandingParams', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/account?emailChanged=1&error=TOKEN_EXPIRED&tab=x#top')
  })

  it('removes the named params and keeps the rest of the URL', () => {
    renderHook(() => useClearLandingParams(true, ['emailChanged', 'error']))

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/account?tab=x#top',
    )
  })

  it('leaves the URL alone when no landing was read', () => {
    renderHook(() => useClearLandingParams(false, ['emailChanged', 'error']))

    expect(window.location.search).toBe('?emailChanged=1&error=TOKEN_EXPIRED&tab=x')
  })
})
