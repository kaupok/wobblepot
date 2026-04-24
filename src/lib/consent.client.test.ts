import { beforeEach, describe, expect, it } from 'vitest'
import { readConsentCookieClient, writeConsentCookieClient } from '@/lib/consent.client'

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

  it('does not throw on a malformed cookie value (e.g. bare %)', () => {
    document.cookie = 'consent-v1=%; Path=/'
    expect(() => readConsentCookieClient()).not.toThrow()
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
