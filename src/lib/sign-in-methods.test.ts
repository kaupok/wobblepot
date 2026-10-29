import { describe, expect, it } from 'vitest'

import {
  findGoogleAccount,
  hasPasswordAccount,
  parseGoogleLinkLanding,
  toSignInAccounts,
} from './sign-in-methods'

const password = { id: 'a1', providerId: 'credential' }
const google = { id: 'a2', providerId: 'google' }

describe('parseGoogleLinkLanding', () => {
  it('reads a successful Connect', () => {
    expect(parseGoogleLinkLanding({ linked: 'google' })).toEqual({ kind: 'linked' })
  })

  it('reads a failed Connect as catalog copy', () => {
    expect(parseGoogleLinkLanding({ linked: 'google', error: 'email_does_not_match' })).toEqual({
      kind: 'failed',
      errorKey: 'googleLinkEmailMismatch',
    })
    expect(parseGoogleLinkLanding({ linked: 'google', error: 'access_denied' })).toEqual({
      kind: 'failed',
      errorKey: 'googleLinkFailed',
    })
  })

  // A bare `error` is the verification link's (`?verified=1&error=…`).
  it('leaves a bare error alone', () => {
    expect(parseGoogleLinkLanding({ error: 'TOKEN_EXPIRED' })).toBeNull()
    expect(parseGoogleLinkLanding({ verified: '1', error: 'TOKEN_EXPIRED' } as never)).toBeNull()
  })

  it('ignores any other provider', () => {
    expect(parseGoogleLinkLanding({ linked: 'github' })).toBeNull()
    expect(parseGoogleLinkLanding({})).toBeNull()
  })

  it('reads the first value of a repeated param', () => {
    expect(parseGoogleLinkLanding({ linked: ['google', 'x'], error: ['', 'x'] })).toEqual({
      kind: 'linked',
    })
  })
})

describe('account helpers', () => {
  it('keeps only the id and the provider', () => {
    const row = { ...google, accountId: '1093', userId: 'u1', scopes: ['email'] }
    expect(toSignInAccounts([row])).toEqual([{ id: 'a2', providerId: 'google' }])
  })

  it('finds the password and the Google account', () => {
    expect(hasPasswordAccount([password, google])).toBe(true)
    expect(hasPasswordAccount([google])).toBe(false)
    expect(findGoogleAccount([password, google])).toEqual(google)
    expect(findGoogleAccount([password])).toBeNull()
  })
})
