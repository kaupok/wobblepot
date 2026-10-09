import { describe, it, expect } from 'vitest'
import { getHouseholdInviteCodeFromParams, householdInvitePath } from './household-invite-link'

describe('getHouseholdInviteCodeFromParams', () => {
  it('reads ?invite=<code> from the invite page link', () => {
    expect(getHouseholdInviteCodeFromParams({ invite: 'Ab3_x-9Kq2Lm' })).toBe('Ab3_x-9Kq2Lm')
  })

  it('reads the code from a returnUrl of the form /invite/<code> (Sign in → Sign up)', () => {
    expect(getHouseholdInviteCodeFromParams({ returnUrl: '/invite/Ab3_x-9Kq2Lm' })).toBe(
      'Ab3_x-9Kq2Lm',
    )
  })

  it('prefers ?invite= over returnUrl when both are present', () => {
    expect(
      getHouseholdInviteCodeFromParams({ invite: 'from-invite', returnUrl: '/invite/from-return' }),
    ).toBe('from-invite')
  })

  it('returns null without a code', () => {
    expect(getHouseholdInviteCodeFromParams({})).toBeNull()
    expect(getHouseholdInviteCodeFromParams({ invite: '', returnUrl: null })).toBeNull()
    expect(getHouseholdInviteCodeFromParams({ returnUrl: '/profile' })).toBeNull()
  })

  it('rejects values that are not a code', () => {
    expect(getHouseholdInviteCodeFromParams({ invite: '../admin' })).toBeNull()
    expect(getHouseholdInviteCodeFromParams({ invite: 'a b' })).toBeNull()
    expect(getHouseholdInviteCodeFromParams({ invite: 'x'.repeat(65) })).toBeNull()
    expect(getHouseholdInviteCodeFromParams({ returnUrl: '/invite/abc/join' })).toBeNull()
    expect(
      getHouseholdInviteCodeFromParams({ returnUrl: 'https://evil.test/invite/abc' }),
    ).toBeNull()
  })
})

describe('householdInvitePath', () => {
  it('builds the invite page path', () => {
    expect(householdInvitePath('Ab3_x-9Kq2Lm')).toBe('/invite/Ab3_x-9Kq2Lm')
  })
})
