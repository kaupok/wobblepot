import { describe, expect, it } from 'vitest'
import {
  CHANGE_EMAIL_CALLBACK_URL,
  EMAIL_VERIFICATION_CALLBACK_URL,
  parseChangeEmailLanding,
  parseVerificationLanding,
  verificationLandingSearch,
  type VerificationLanding,
} from './email-verification'

describe('parseVerificationLanding', () => {
  it('reads a successful verification', () => {
    expect(parseVerificationLanding({ verified: '1' })).toBe('verified')
  })

  it('reads an expired link, even with verified=1 beside it', () => {
    expect(parseVerificationLanding({ verified: '1', error: 'TOKEN_EXPIRED' })).toBe('expired')
  })

  it('ignores the case of the error code', () => {
    expect(parseVerificationLanding({ error: 'token_expired' })).toBe('expired')
  })

  it.each(['INVALID_TOKEN', 'USER_NOT_FOUND', 'something_else'])(
    'reads %s as an invalid link',
    (error) => {
      expect(parseVerificationLanding({ verified: '1', error })).toBe('invalid')
    },
  )

  it('returns null with no params', () => {
    expect(parseVerificationLanding({})).toBeNull()
  })

  it('returns null for a verified value other than 1', () => {
    expect(parseVerificationLanding({ verified: 'yes' })).toBeNull()
  })

  it('takes the first value of a repeated param', () => {
    expect(parseVerificationLanding({ verified: ['1', '0'] })).toBe('verified')
  })

  it('matches the URL Better Auth redirects to', () => {
    const url = new URL(EMAIL_VERIFICATION_CALLBACK_URL, 'https://wobblepot.test')
    url.searchParams.set('error', 'TOKEN_EXPIRED')
    expect(url.pathname).toBe('/account')
    expect(
      parseVerificationLanding({
        verified: url.searchParams.get('verified') ?? undefined,
        error: url.searchParams.get('error') ?? undefined,
      }),
    ).toBe('expired')
  })
})

describe('verificationLandingSearch', () => {
  it.each<VerificationLanding>(['verified', 'expired', 'invalid'])(
    'round-trips %s through parseVerificationLanding',
    (landing) => {
      const params = Object.fromEntries(new URLSearchParams(verificationLandingSearch(landing)))
      expect(parseVerificationLanding(params)).toBe(landing)
    },
  )
})

describe('parseChangeEmailLanding (HON-1137)', () => {
  it('reads a successful change', () => {
    expect(parseChangeEmailLanding({ emailChanged: '1' })).toBe('changed')
  })

  it('reads an expired link and a used link as expired', () => {
    expect(parseChangeEmailLanding({ emailChanged: '1', error: 'TOKEN_EXPIRED' })).toBe('expired')
    // A used link: no user has the token's old address any more.
    expect(parseChangeEmailLanding({ emailChanged: '1', error: 'USER_NOT_FOUND' })).toBe('expired')
  })

  // A valid link opened while another account is signed in (PR #1331 review).
  it('reads a link opened in another account as wrongAccount', () => {
    expect(parseChangeEmailLanding({ emailChanged: '1', error: 'INVALID_USER' })).toBe(
      'wrongAccount',
    )
  })

  it('reads a broken token as invalid, in any case', () => {
    expect(parseChangeEmailLanding({ emailChanged: '1', error: 'invalid_token' })).toBe('invalid')
  })

  it('leaves the verification params alone', () => {
    expect(parseChangeEmailLanding({ verified: '1', error: 'TOKEN_EXPIRED' } as never)).toBeNull()
    expect(parseChangeEmailLanding({})).toBeNull()
  })

  it('takes the first value of a repeated param', () => {
    expect(parseChangeEmailLanding({ emailChanged: ['1', '0'] })).toBe('changed')
  })

  it('lands where the parser reads', () => {
    const params = Object.fromEntries(new URL(CHANGE_EMAIL_CALLBACK_URL, 'http://x').searchParams)
    expect(parseChangeEmailLanding(params)).toBe('changed')
  })
})
