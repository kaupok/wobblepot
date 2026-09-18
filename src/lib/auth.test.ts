import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  auth,
  assertTermsAccepted,
  hashPasswordWithBreachCheck,
  stampTermsConsent,
  TERMS_NOT_ACCEPTED_MESSAGE,
} from './auth'
import { CURRENT_TERMS_VERSION } from './consent'
import { isPasswordBreached } from './breached-password'

// Mock the prisma module
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('./breached-password', () => ({
  isPasswordBreached: vi.fn(),
}))

describe('hashPasswordWithBreachCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws PASSWORD_COMPROMISED when password is breached', async () => {
    vi.mocked(isPasswordBreached).mockResolvedValue(true)

    await expect(hashPasswordWithBreachCheck('password1234')).rejects.toMatchObject({
      message: 'That password appears in known data breaches. Please pick a different one.',
    })
  })

  it('returns a scrypt hash when password is not breached', async () => {
    vi.mocked(isPasswordBreached).mockResolvedValue(false)

    const hash = await hashPasswordWithBreachCheck('a-strong-unique-passphrase-2026')

    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
    expect(hash).not.toBe('a-strong-unique-passphrase-2026')
  })
})

describe('assertTermsAccepted', () => {
  it('passes when acceptedTerms is exactly true', () => {
    expect(() => assertTermsAccepted({ acceptedTerms: true })).not.toThrow()
  })

  it.each([
    ['missing field', {}],
    ['false', { acceptedTerms: false }],
    ['truthy string', { acceptedTerms: 'true' }],
    ['1', { acceptedTerms: 1 }],
    ['null body', null],
    ['non-object body', 'acceptedTerms=true'],
  ])('rejects %s with the friendly message', (_label, body) => {
    expect(() => assertTermsAccepted(body)).toThrowError(TERMS_NOT_ACCEPTED_MESSAGE)
  })
})

describe('stampTermsConsent', () => {
  it('stamps timestamp + CURRENT_TERMS_VERSION on the email sign-up path', () => {
    const now = new Date('2026-06-03T12:00:00Z')
    expect(stampTermsConsent('/sign-up/email', now)).toEqual({
      acceptedTermsAt: now,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    })
  })

  it.each([
    ['another auth path', '/sign-in/email'],
    ['a future OAuth callback', '/callback/google'],
    ['internal creation with no request context', undefined],
  ])('does not stamp for %s — consent is only validated on email sign-up', (_label, path) => {
    expect(stampTermsConsent(path)).toBeNull()
  })
})

describe('auth options wiring', () => {
  it('declares the consent columns as non-input additionalFields', () => {
    // `input: false` is the spoofing guard: without it, Better Auth would
    // accept `acceptedTermsAt` / `acceptedTermsVersion` from the request
    // body, letting clients backdate or forge consent (HON-457).
    const fields = auth.options.user?.additionalFields
    expect(fields?.acceptedTermsAt).toMatchObject({ type: 'date', input: false })
    expect(fields?.acceptedTermsVersion).toMatchObject({ type: 'number', input: false })
  })

  it('registers the user-create database hook that stamps consent', () => {
    expect(auth.options.databaseHooks?.user?.create?.before).toBeTypeOf('function')
  })

  it('wires hashPasswordWithBreachCheck into emailAndPassword.password.hash', () => {
    // Regression guard: Better Auth reads from `emailAndPassword.password.hash`
    // (see @better-auth/core create-context); placing `password` at the root
    // silently does nothing.
    expect(auth.options.emailAndPassword?.password?.hash).toBe(hashPasswordWithBreachCheck)
  })

  it('sets minPasswordLength to 12', () => {
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(12)
  })

  it('registers the invite-code hooks at the request-level (before + after)', () => {
    // The hooks are the load-bearing wiring for the HON-488 invite-only gate.
    // Better Auth only invokes `hooks.before` / `hooks.after` if they are
    // defined on the root options, so this regression guard catches a missing
    // or moved hook layer (e.g. accidentally placed under databaseHooks).
    expect(auth.options.hooks?.before).toBeTypeOf('function')
    expect(auth.options.hooks?.after).toBeTypeOf('function')
  })
})
