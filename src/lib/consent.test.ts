import { describe, expect, it } from 'vitest'
import {
  CURRENT_TERMS_VERSION,
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

describe('decisionToGranted / grantedToDecision', () => {
  it('maps null ↔ undecided, all ↔ true, essential ↔ false', () => {
    expect(decisionToGranted(null)).toBe(null)
    expect(decisionToGranted('all')).toBe(true)
    expect(decisionToGranted('essential')).toBe(false)
    expect(grantedToDecision(true)).toBe('all')
    expect(grantedToDecision(false)).toBe('essential')
  })
})
