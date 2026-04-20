import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAnalyticsCookies,
  notifyPosthogGranted,
  notifyPosthogWithdrawn,
  readConsentCookieClient,
  writeConsentCookieClient,
} from '@/lib/consent.client'

function clearAllCookies() {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0]
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
}

beforeEach(() => {
  clearAllCookies()
  window.localStorage.clear()
})

afterEach(() => {
  delete (window as unknown as { posthog?: unknown }).posthog
})

describe('readConsentCookieClient', () => {
  it('returns null when no cookie is set', () => {
    expect(readConsentCookieClient()).toBe(null)
  })

  it('returns the decision literal when the cookie is set', () => {
    document.cookie = 'consent-v1=all; Path=/'
    expect(readConsentCookieClient()).toBe('all')

    clearAllCookies()
    document.cookie = 'consent-v1=essential; Path=/'
    expect(readConsentCookieClient()).toBe('essential')
  })

  it('returns null when the cookie contains an unknown value', () => {
    document.cookie = 'consent-v1=maybe; Path=/'
    expect(readConsentCookieClient()).toBe(null)
  })
})

describe('writeConsentCookieClient', () => {
  it('writes the cookie and mirrors to localStorage', () => {
    writeConsentCookieClient('all')
    expect(document.cookie).toContain('consent-v1=all')
    expect(window.localStorage.getItem('consent-v1')).toBe('all')
  })

  it('overwrites a prior decision', () => {
    writeConsentCookieClient('all')
    writeConsentCookieClient('essential')
    expect(readConsentCookieClient()).toBe('essential')
    expect(window.localStorage.getItem('consent-v1')).toBe('essential')
  })
})

describe('clearAnalyticsCookies', () => {
  it('expires every cookie whose name starts with ph_', () => {
    document.cookie = 'ph_test_posthog=abc; Path=/'
    document.cookie = 'ph_other=xyz; Path=/'
    document.cookie = 'keep_this=ok; Path=/'

    clearAnalyticsCookies()

    expect(document.cookie).not.toContain('ph_test_posthog=abc')
    expect(document.cookie).not.toContain('ph_other=xyz')
    expect(document.cookie).toContain('keep_this=ok')
  })

  it('is a safe no-op when no ph_ cookies exist', () => {
    expect(() => clearAnalyticsCookies()).not.toThrow()
  })
})

describe('notifyPosthogGranted / notifyPosthogWithdrawn', () => {
  it('calls window.posthog.opt_in_capturing if present', () => {
    const optIn = vi.fn()
    ;(window as unknown as { posthog: unknown }).posthog = { opt_in_capturing: optIn }
    notifyPosthogGranted()
    expect(optIn).toHaveBeenCalledTimes(1)
  })

  it('calls window.posthog.opt_out_capturing and clears ph_* cookies on withdraw', () => {
    const optOut = vi.fn()
    ;(window as unknown as { posthog: unknown }).posthog = { opt_out_capturing: optOut }
    document.cookie = 'ph_seeded=1; Path=/'

    notifyPosthogWithdrawn()

    expect(optOut).toHaveBeenCalledTimes(1)
    expect(document.cookie).not.toContain('ph_seeded=1')
  })

  it('is a no-op when posthog is not loaded', () => {
    expect(() => notifyPosthogGranted()).not.toThrow()
    expect(() => notifyPosthogWithdrawn()).not.toThrow()
  })
})
