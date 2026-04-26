import { describe, it, expect } from 'vitest'
import { isAdmin } from './auth-helpers'

const sessionFor = (email: string | undefined): Parameters<typeof isAdmin>[0] =>
  ({ user: { email } }) as never

describe('isAdmin', () => {
  it('returns false when there is no session', () => {
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })

  it('returns false when the session user has no email', () => {
    expect(isAdmin(sessionFor(undefined))).toBe(false)
  })

  it('returns false when the email does not match ADMIN_EMAIL', () => {
    expect(isAdmin(sessionFor('not-admin@example.com'))).toBe(false)
  })

  it('returns true when the email matches ADMIN_EMAIL exactly', () => {
    // ADMIN_EMAIL is set to admin@example.com via vitest.config.ts
    expect(isAdmin(sessionFor('admin@example.com'))).toBe(true)
  })

  it('matches case-insensitively (email casing is not user-meaningful)', () => {
    expect(isAdmin(sessionFor('ADMIN@EXAMPLE.COM'))).toBe(true)
    expect(isAdmin(sessionFor('Admin@Example.com'))).toBe(true)
  })
})
