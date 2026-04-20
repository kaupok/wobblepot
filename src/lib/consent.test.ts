import { describe, expect, it } from 'vitest'
import { decisionToGranted, grantedToDecision, parseConsentDecision } from '@/lib/consent'

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

describe('decisionToGranted / grantedToDecision', () => {
  it('maps null ↔ undecided, all ↔ true, essential ↔ false', () => {
    expect(decisionToGranted(null)).toBe(null)
    expect(decisionToGranted('all')).toBe(true)
    expect(decisionToGranted('essential')).toBe(false)
    expect(grantedToDecision(true)).toBe('all')
    expect(grantedToDecision(false)).toBe('essential')
  })
})
