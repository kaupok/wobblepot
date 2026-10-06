import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearStoredPostHogIdentity, postHogCookieDomains } from '@/lib/posthog-identity-sweep'

const TOKEN = 'phc_sweep_test'
const NAME = `ph_${TOKEN}_posthog`

function clearCookies() {
  for (const cookie of document.cookie.split('; ').filter(Boolean)) {
    document.cookie = `${cookie.split('=')[0]}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

/** Every value written to `document.cookie` while `run` executes. */
function cookieWrites(run: () => void): string[] {
  const setter = vi.spyOn(Document.prototype, 'cookie', 'set')
  try {
    run()
    return setter.mock.calls.map(([value]) => value)
  } finally {
    setter.mockRestore()
  }
}

afterEach(() => {
  // Restore first: one test makes the localStorage getter throw.
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  clearCookies()
})

describe('postHogCookieDomains', () => {
  it('lists every suffix of two or more labels, so the one posthog-js chose is included', () => {
    expect(postHogCookieDomains('wobblepot.com')).toEqual(['wobblepot.com'])
    expect(postHogCookieDomains('www.wobblepot.com')).toEqual([
      'www.wobblepot.com',
      'wobblepot.com',
    ])
    expect(postHogCookieDomains('app.staging.wobblepot.dev')).toEqual([
      'app.staging.wobblepot.dev',
      'staging.wobblepot.dev',
      'wobblepot.dev',
    ])
  })

  it('lists no domain for hosts that only take host-only cookies', () => {
    expect(postHogCookieDomains('localhost')).toEqual([])
    expect(postHogCookieDomains('127.0.0.1')).toEqual([])
    expect(postHogCookieDomains('::1')).toEqual([])
    expect(postHogCookieDomains('intranet')).toEqual([])
  })
})

describe('clearStoredPostHogIdentity', () => {
  it('removes every ph_<token>_posthog entry and keeps the consent flag and other keys', () => {
    localStorage.setItem(NAME, '{"distinct_id":"user-1"}')
    localStorage.setItem(`${NAME}__flags`, '{}')
    localStorage.setItem(`${NAME}__surveys`, '{}')
    localStorage.setItem(`__ph_opt_in_out_${TOKEN}`, '0')
    localStorage.setItem('ph_other_token_posthog', '{}')
    localStorage.setItem('wobblepot-first-events', '{}')
    sessionStorage.setItem(NAME, '{"$sesid":[]}')
    sessionStorage.setItem(`${NAME}_cookie_identity_change_pending`, 'true')
    document.cookie = `${NAME}=${encodeURIComponent('{"distinct_id":"user-1"}')}; path=/`
    document.cookie = `${NAME}_cpm=1; path=/`

    clearStoredPostHogIdentity(TOKEN, 'localhost')

    expect(Object.keys(localStorage).sort()).toEqual(
      [`__ph_opt_in_out_${TOKEN}`, 'ph_other_token_posthog', 'wobblepot-first-events'].sort(),
    )
    expect(Object.keys(sessionStorage)).toEqual([])
    expect(document.cookie).toBe('')
  })

  it('expires the cookie host-only and on the parent domain', () => {
    document.cookie = `${NAME}=1; path=/`

    const writes = cookieWrites(() => clearStoredPostHogIdentity(TOKEN, 'www.wobblepot.com'))

    const expired = `${NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; path=/`
    expect(writes).toEqual([
      expired,
      `${expired}; domain=.www.wobblepot.com`,
      `${expired}; domain=.wobblepot.com`,
    ])
  })

  it('writes no cookie when no PostHog cookie is stored', () => {
    document.cookie = 'unrelated=1; path=/'

    const writes = cookieWrites(() => clearStoredPostHogIdentity(TOKEN, 'www.wobblepot.com'))

    expect(writes).toEqual([])
    expect(document.cookie).toBe('unrelated=1')
  })

  it('still clears sessionStorage and cookies when localStorage throws', () => {
    sessionStorage.setItem(NAME, '{}')
    document.cookie = `${NAME}=1; path=/`
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })

    expect(() => clearStoredPostHogIdentity(TOKEN, 'localhost')).not.toThrow()

    expect(sessionStorage.getItem(NAME)).toBeNull()
    expect(document.cookie).toBe('')
  })
})
