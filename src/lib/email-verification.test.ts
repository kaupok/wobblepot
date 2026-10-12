import { describe, expect, it } from 'vitest'
import { EMAIL_VERIFICATION_CALLBACK_URL, parseVerificationLanding } from './email-verification'

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
    expect(url.pathname).toBe('/profile')
    expect(
      parseVerificationLanding({
        verified: url.searchParams.get('verified') ?? undefined,
        error: url.searchParams.get('error') ?? undefined,
      }),
    ).toBe('expired')
  })
})
