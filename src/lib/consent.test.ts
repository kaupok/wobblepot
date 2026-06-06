import { describe, expect, it } from 'vitest'
import {
  CURRENT_TERMS_VERSION,
  POLICY_LAST_UPDATED,
  POLICY_LAST_UPDATED_DISPLAY,
  decisionToGranted,
  grantedToDecision,
  parseConsentDecision,
} from '@/lib/consent'

describe('parseConsentDecision', () => {
  it('returns the literal for valid values', () => {
    expect(parseConsentDecision('essential')).toBe('essential')
    expect(parseConsentDecision('all')).toBe('all')
  })

  it('returns null for unknown, empty, null, or undefined input', () => {
    expect(parseConsentDecision(undefined)).toBe(null)
    expect(parseConsentDecision(null)).toBe(null)
    expect(parseConsentDecision('')).toBe(null)
    expect(parseConsentDecision('yes')).toBe(null)
    expect(parseConsentDecision('some')).toBe(null)
  })
})

describe('CURRENT_TERMS_VERSION', () => {
  // AC (HON-457): the constant exists, is non-null, and is a positive
  // integer — it is the value stamped onto User.acceptedTermsVersion.
  it('is a non-null positive integer', () => {
    expect(CURRENT_TERMS_VERSION).not.toBeNull()
    expect(Number.isInteger(CURRENT_TERMS_VERSION)).toBe(true)
    expect(CURRENT_TERMS_VERSION).toBeGreaterThanOrEqual(1)
  })
})

describe('POLICY_LAST_UPDATED', () => {
  // HON-559: drives the sitemap lastModified for /privacy and /terms and
  // the "Last updated" line on both legal pages.
  it('is a valid ISO YYYY-MM-DD date', () => {
    expect(POLICY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(new Date(POLICY_LAST_UPDATED).getTime())).toBe(false)
  })

  it('display form derives from the ISO date', () => {
    const expected = new Date(POLICY_LAST_UPDATED).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    expect(POLICY_LAST_UPDATED_DISPLAY).toBe(expected)
  })
})

describe('decisionToGranted / grantedToDecision', () => {
  it('maps null ↔ undecided, all ↔ true, essential ↔ false', () => {
    expect(decisionToGranted(null)).toBe(null)
    expect(decisionToGranted('all')).toBe(true)
    expect(decisionToGranted('essential')).toBe(false)
    expect(grantedToDecision(true)).toBe('all')
    expect(grantedToDecision(false)).toBe('essential')
  })
})
