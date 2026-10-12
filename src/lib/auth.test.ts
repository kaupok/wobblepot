import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  afterEmailSignUp,
  auth,
  assertTermsAccepted,
  assertValidAccountNameUpdate,
  INVALID_ACCOUNT_NAME_MESSAGE,
  hashPasswordWithBreachCheck,
  sendAccountVerificationEmail,
  stampTermsConsent,
  TERMS_NOT_ACCEPTED_MESSAGE,
} from './auth'
import { CURRENT_TERMS_VERSION } from './consent'
import { isPasswordBreached } from './breached-password'
import { linkUsedBy, releaseClaim } from '@/lib/signup-codes'
import { clearWaitlistForNewUser } from '@/lib/waitlist'
import { joinHouseholdFromSignUp } from '@/lib/household-invite'
import { resend, isEmailConfigured } from '@/lib/resend'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from '@/lib/email-verification'

// Mock the prisma module
vi.mock('@/lib/prisma', () => ({
  // The `mcp()` plugin seeds its resource row at init (HON-1150).
  prisma: { oauthResource: { findFirst: vi.fn().mockResolvedValue({ id: 'seeded' }) } },
}))

vi.mock('./breached-password', () => ({
  isPasswordBreached: vi.fn(),
}))

vi.mock('@/lib/signup-codes', () => ({
  linkUsedBy: vi.fn(),
  releaseClaim: vi.fn(),
  validateAndClaimInviteCode: vi.fn(),
}))

vi.mock('@/lib/waitlist', () => ({
  clearWaitlistForNewUser: vi.fn(),
}))

vi.mock('@/lib/household-invite', () => ({
  joinHouseholdFromSignUp: vi.fn(),
}))

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: vi.fn() } },
  isEmailConfigured: vi.fn(() => true),
  EMAIL_SENDERS: { auth: 'Wobblepot <auth@mail.wobblepot.test>' },
  envSubject: (subject: string) => subject,
}))

vi.mock('@/lib/emails/locale', () => ({
  resolveEmailLocale: vi.fn(async () => 'en'),
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

describe('assertValidAccountNameUpdate', () => {
  it.each([
    ['a name', { name: 'Mari Maasikas' }],
    ['exactly 100 characters', { name: 'a'.repeat(100) }],
    ['an update without a name', { image: null }],
    ['an explicit undefined name', { name: undefined }],
  ])('passes %s', (_label, body) => {
    expect(() => assertValidAccountNameUpdate(body)).not.toThrow()
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['101 characters', { name: 'a'.repeat(101) }],
    // Better Auth stores the name untrimmed, so padding counts (PR #1202 review).
    ['a short name padded past 100 characters', { name: `a${' '.repeat(100)}` }],
    ['a non-string name', { name: 42 }],
    ['a null name', { name: null }],
  ])('rejects %s', (_label, body) => {
    expect(() => assertValidAccountNameUpdate(body)).toThrowError(INVALID_ACCOUNT_NAME_MESSAGE)
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

describe('afterEmailSignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes the new user's waitlist request when the sign-up has no invite code (HON-1102)", async () => {
    await afterEmailSignUp({ email: 'anna@example.com' }, 'user_1')

    expect(clearWaitlistForNewUser).toHaveBeenCalledWith('user_1')
    expect(releaseClaim).not.toHaveBeenCalled()
  })

  it('links the used invite code, then deletes the waitlist request', async () => {
    const body = { inviteCode: 'good' }

    await afterEmailSignUp(body, 'user_1')

    expect(linkUsedBy).toHaveBeenCalledWith(body, 'user_1')
    expect(clearWaitlistForNewUser).toHaveBeenCalledWith('user_1')
    expect(vi.mocked(linkUsedBy).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(clearWaitlistForNewUser).mock.invocationCallOrder[0]!,
    )
  })

  it('joins the household from an invite-link sign-up (HON-1131)', async () => {
    const body = { householdInviteCode: 'Ab3_x-9Kq2Lm' }

    await afterEmailSignUp(body, 'user_1')

    expect(joinHouseholdFromSignUp).toHaveBeenCalledWith(body, 'user_1')
  })

  it('does not try to join a household when sign-up failed', async () => {
    await afterEmailSignUp({ householdInviteCode: 'Ab3_x-9Kq2Lm' }, undefined)

    expect(joinHouseholdFromSignUp).not.toHaveBeenCalled()
  })

  it('releases the claimed code and touches no waitlist request when sign-up failed', async () => {
    const body = { inviteCode: 'good' }

    await afterEmailSignUp(body, undefined)

    expect(releaseClaim).toHaveBeenCalledWith(body)
    expect(linkUsedBy).not.toHaveBeenCalled()
    expect(clearWaitlistForNewUser).not.toHaveBeenCalled()
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

  // Soft verification (HON-1155): the mail goes out on sign-up, and sign-in
  // stays open before the link is clicked.
  it('sends a verification mail on sign-up without blocking sign-in', () => {
    expect(auth.options.emailVerification?.sendOnSignUp).toBe(true)
    expect(auth.options.emailVerification?.expiresIn).toBe(EMAIL_VERIFICATION_EXPIRES_IN_SECONDS)
    expect(auth.options.emailVerification?.sendVerificationEmail).toBeTypeOf('function')
    expect(auth.options.emailAndPassword).not.toHaveProperty('requireEmailVerification')
    expect(auth.options.emailVerification).not.toHaveProperty('autoSignInAfterVerification')
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

describe('sendAccountVerificationEmail', () => {
  const user = { id: 'user-1', email: 'new@example.com' }
  const url = 'https://wobblepot.test/api/auth/verify-email?token=t&callbackURL=%2Fprofile'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isEmailConfigured).mockReturnValue(true)
    vi.mocked(resolveEmailLocale).mockResolvedValue('en')
  })

  it('sends the mail to the user from the auth sender with the link', async () => {
    await sendAccountVerificationEmail({ user, url })

    expect(resend!.emails.send).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(resend!.emails.send).mock.calls[0]![0] as {
      from: string
      to: string
      text: string
    }
    expect(sent.from).toBe('Wobblepot <auth@mail.wobblepot.test>')
    expect(sent.to).toBe('new@example.com')
    expect(sent.text).toContain(url)
  })

  it("falls back to the visitor's Accept-Language when the user has no household", async () => {
    const request = new Request('https://wobblepot.test/api/auth/sign-up/email', {
      headers: { 'accept-language': 'et-EE,et;q=0.9,en;q=0.8' },
    })

    await sendAccountVerificationEmail({ user, url }, request)

    expect(resolveEmailLocale).toHaveBeenCalledWith('user-1', 'et')
  })

  it('falls back to English without a request', async () => {
    await sendAccountVerificationEmail({ user, url })

    expect(resolveEmailLocale).toHaveBeenCalledWith('user-1', 'en')
  })

  it('does not send when email is not configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendAccountVerificationEmail({ user, url })

    expect(resend!.emails.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  // A throw here would fail the sign-up request that triggered the send.
  it('logs a failed send and does not throw', async () => {
    vi.mocked(resend!.emails.send).mockRejectedValue(new Error('provider down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendAccountVerificationEmail({ user, url })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})
