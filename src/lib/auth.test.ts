import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getOAuthState } from 'better-auth/api'
import {
  afterEmailSignUp,
  afterOAuthSignUp,
  assertOAuthUserCreation,
  auth,
  assertTermsAccepted,
  beforeSocialSignIn,
  GOOGLE_EMAIL_NOT_VERIFIED_MESSAGE,
  ID_TOKEN_SIGN_IN_MESSAGE,
  isNewOAuthUser,
  assertValidAccountNameUpdate,
  INVALID_ACCOUNT_NAME_MESSAGE,
  hashPasswordWithBreachCheck,
  sendAccountVerificationEmail,
  stampTermsConsent,
  TERMS_NOT_ACCEPTED_MESSAGE,
} from './auth'
import { CURRENT_TERMS_VERSION } from './consent'
import { isPasswordBreached } from './breached-password'
import { claimInviteCode, linkUsedBy, releaseClaim, validateInviteCode } from '@/lib/signup-codes'
import { getPosthogServer } from '@/lib/posthog-server'
import { clearWaitlistForNewUser } from '@/lib/waitlist'
import { joinHouseholdFromSignUp } from '@/lib/household-invite'
import { resend, isEmailConfigured } from '@/lib/resend'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from '@/lib/email-verification'

vi.mock('./breached-password', () => ({
  isPasswordBreached: vi.fn(),
}))

vi.mock('@/lib/signup-codes', async (importOriginal) => ({
  getInviteCodeFromBody: (await importOriginal<typeof import('@/lib/signup-codes')>())
    .getInviteCodeFromBody,
  claimInviteCode: vi.fn(),
  linkUsedBy: vi.fn(),
  releaseClaim: vi.fn(),
  validateAndClaimInviteCode: vi.fn(),
  validateInviteCode: vi.fn(),
}))

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getOAuthState: vi.fn(),
}))

const posthogCapture = vi.fn()
vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: vi.fn(() => ({ capture: posthogCapture })),
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
    ['the OAuth callback without a state', '/callback/:id'],
    ['internal creation with no request context', undefined],
  ])('does not stamp for %s — consent is only validated on email sign-up', (_label, path) => {
    expect(stampTermsConsent(path)).toBeNull()
  })

  it('stamps the OAuth callback when its state carries sign-up consent (HON-1157)', () => {
    const now = new Date('2026-10-15T12:00:00Z')
    expect(
      stampTermsConsent('/callback/:id', now, { requestSignUp: true, acceptedTerms: true }),
    ).toEqual({ acceptedTermsAt: now, acceptedTermsVersion: CURRENT_TERMS_VERSION })
  })

  it.each([
    ['no consent flag', { requestSignUp: true }],
    ['a truthy non-boolean consent', { requestSignUp: true, acceptedTerms: 'true' }],
    ['a sign-in flow', { acceptedTerms: true }],
  ])('does not stamp the OAuth callback with %s', (_label, state) => {
    expect(stampTermsConsent('/callback/:id', new Date(), state)).toBeNull()
  })

  it('ignores an OAuth state on any other path', () => {
    const state = { requestSignUp: true, acceptedTerms: true }
    expect(stampTermsConsent('/sign-in/social', new Date(), state)).toBeNull()
  })
})

describe('beforeSocialSignIn (HON-1157)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes a plain sign-in with no checks', async () => {
    await expect(
      beforeSocialSignIn({ provider: 'google', callbackURL: '/' }),
    ).resolves.toBeUndefined()
    expect(validateInviteCode).not.toHaveBeenCalled()
  })

  it('rejects a sign-up without consent before validating the code', async () => {
    await expect(
      beforeSocialSignIn({
        provider: 'google',
        requestSignUp: true,
        additionalData: { inviteCode: 'good' },
      }),
    ).rejects.toMatchObject({ message: TERMS_NOT_ACCEPTED_MESSAGE })
    expect(validateInviteCode).not.toHaveBeenCalled()
  })

  it('rejects a sign-up whose code fails validation', async () => {
    vi.mocked(validateInviteCode).mockRejectedValueOnce(new Error('invite code is invalid'))
    const additionalData = { acceptedTerms: true, inviteCode: 'used' }

    await expect(
      beforeSocialSignIn({ provider: 'google', requestSignUp: true, additionalData }),
    ).rejects.toThrow('invite code is invalid')
    expect(validateInviteCode).toHaveBeenCalledWith(additionalData)
  })

  it('validates, but does not claim, the code of a consented sign-up', async () => {
    const additionalData = { acceptedTerms: true, inviteCode: 'good' }

    await beforeSocialSignIn({ provider: 'google', requestSignUp: true, additionalData })

    expect(validateInviteCode).toHaveBeenCalledWith(additionalData)
    expect(claimInviteCode).not.toHaveBeenCalled()
  })

  it('refuses an ID-token sign-in, which would create the user past the callback', async () => {
    await expect(
      beforeSocialSignIn({ provider: 'google', idToken: { token: 'eyJ' } }),
    ).rejects.toMatchObject({ message: ID_TOKEN_SIGN_IN_MESSAGE })
  })
})

describe('assertOAuthUserCreation (HON-1157)', () => {
  const consented = { requestSignUp: true, acceptedTerms: true }

  it('returns the consent stamp for a verified Google user with consent', () => {
    const now = new Date('2026-10-15T12:00:00Z')
    expect(assertOAuthUserCreation({ emailVerified: true }, consented, now)).toEqual({
      acceptedTermsAt: now,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    })
  })

  it('refuses a user row without consent in the state', () => {
    expect(() => assertOAuthUserCreation({ emailVerified: true }, { requestSignUp: true })).toThrow(
      TERMS_NOT_ACCEPTED_MESSAGE,
    )
  })

  it('refuses an address Google has not verified, with the callback error code', () => {
    let caught: unknown
    try {
      assertOAuthUserCreation({ emailVerified: false }, consented)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      message: GOOGLE_EMAIL_NOT_VERIFIED_MESSAGE,
      body: { code: 'email_not_verified' },
    })
  })
})

describe('databaseHooks.user.create.before', () => {
  const before = auth.options.databaseHooks!.user!.create!.before!
  const user = { name: 'Anna', email: 'anna@example.com', emailVerified: true }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps consent on a Google sign-up callback from its OAuth state', async () => {
    vi.mocked(getOAuthState).mockResolvedValue({
      requestSignUp: true,
      acceptedTerms: true,
    } as never)

    const result = await before(user as never, { path: '/callback/:id' } as never)

    expect(result).toEqual({
      data: expect.objectContaining({
        email: 'anna@example.com',
        acceptedTermsAt: expect.any(Date),
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      }),
    })
  })

  it('refuses a callback creation whose state has no consent', async () => {
    vi.mocked(getOAuthState).mockResolvedValue({ requestSignUp: true } as never)

    await expect(before(user as never, { path: '/callback/:id' } as never)).rejects.toThrow(
      TERMS_NOT_ACCEPTED_MESSAGE,
    )
  })

  it('leaves internal creation unstamped and does not read OAuth state', async () => {
    await expect(before(user as never, undefined as never)).resolves.toBeUndefined()
    expect(getOAuthState).not.toHaveBeenCalled()
  })
})

describe('isNewOAuthUser (HON-1157)', () => {
  const now = new Date('2026-10-15T12:00:00Z')
  const signUp = { requestSignUp: true, acceptedTerms: true }

  it('is true for a sign-up whose user row is seconds old', () => {
    expect(isNewOAuthUser(signUp, { createdAt: new Date('2026-10-15T11:59:58Z') }, now)).toBe(true)
  })

  it('is false for a returning user through the sign-up button', () => {
    expect(isNewOAuthUser(signUp, { createdAt: new Date('2026-10-01T09:00:00Z') }, now)).toBe(false)
  })

  it('is false for a sign-in flow, however new the user', () => {
    expect(isNewOAuthUser({}, { createdAt: new Date('2026-10-15T11:59:58Z') }, now)).toBe(false)
  })

  it('is false when the callback signed nobody in', () => {
    expect(isNewOAuthUser(signUp, undefined, now)).toBe(false)
  })
})

describe('afterOAuthSignUp (HON-1157)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims and links the code, clears the waitlist and captures the sign-up once', async () => {
    vi.mocked(claimInviteCode).mockResolvedValue(true)
    const state = { requestSignUp: true, acceptedTerms: true, inviteCode: 'good' }

    await afterOAuthSignUp(state, 'user_1')

    expect(claimInviteCode).toHaveBeenCalledTimes(1)
    expect(claimInviteCode).toHaveBeenCalledWith(state)
    expect(linkUsedBy).toHaveBeenCalledTimes(1)
    expect(linkUsedBy).toHaveBeenCalledWith(state, 'user_1')
    expect(clearWaitlistForNewUser).toHaveBeenCalledTimes(1)
    expect(clearWaitlistForNewUser).toHaveBeenCalledWith('user_1')
    expect(joinHouseholdFromSignUp).toHaveBeenCalledWith(state, 'user_1')
    expect(posthogCapture).toHaveBeenCalledTimes(1)
    expect(posthogCapture).toHaveBeenCalledWith({
      distinctId: 'user_1',
      event: 'auth:sign_up',
      properties: { method: 'google' },
    })
  })

  it('keeps the sign-up when another sign-up claimed the code first', async () => {
    vi.mocked(claimInviteCode).mockResolvedValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(afterOAuthSignUp({ inviteCode: 'raced' }, 'user_1')).resolves.toBeUndefined()

    expect(linkUsedBy).not.toHaveBeenCalled()
    expect(clearWaitlistForNewUser).toHaveBeenCalledWith('user_1')
    expect(warn).toHaveBeenCalledWith('[signup-code] Google sign-up lost the claim on its code', {
      code: 'raced',
      userId: 'user_1',
    })
    warn.mockRestore()
  })

  it('keeps the sign-up when the claim throws', async () => {
    vi.mocked(claimInviteCode).mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(afterOAuthSignUp({ inviteCode: 'good' }, 'user_1')).resolves.toBeUndefined()

    expect(clearWaitlistForNewUser).toHaveBeenCalledWith('user_1')
    warn.mockRestore()
  })

  it('joins the household from an invite-link sign-up and claims no code', async () => {
    vi.mocked(claimInviteCode).mockResolvedValue(false)
    const state = { householdInviteCode: 'Ab3_x-9Kq2Lm' }

    await afterOAuthSignUp(state, 'user_1')

    expect(linkUsedBy).not.toHaveBeenCalled()
    expect(joinHouseholdFromSignUp).toHaveBeenCalledWith(state, 'user_1')
  })

  it('keeps the sign-up when PostHog throws', async () => {
    vi.mocked(claimInviteCode).mockResolvedValue(false)
    vi.mocked(getPosthogServer).mockReturnValueOnce({
      capture: () => {
        throw new Error('posthog down')
      },
    } as never)

    await expect(afterOAuthSignUp({}, 'user_1')).resolves.toBeUndefined()
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

  it('registers no social provider without the Google env vars (HON-1157)', () => {
    expect(auth.options.socialProviders).not.toHaveProperty('google')
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

describe('Google provider wiring (HON-1157)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('registers Google behind the sign-up and verification gates when configured', async () => {
    vi.resetModules()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')

    const { auth: configured } = await import('./auth')
    const google = configured.options.socialProviders?.google as Record<string, unknown>

    expect(google).toMatchObject({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      prompt: 'select_account',
      disableImplicitSignUp: true,
      requireEmailVerification: true,
    })
    const map = google.mapProfileToUser as (p: unknown) => unknown
    expect(map({ name: 'Anna', picture: 'https://lh3.googleusercontent.com/a' })).toEqual({
      name: 'Anna',
      image: undefined,
    })
    // Better Auth's linking defaults: no trusted provider skips local verification.
    expect(configured.options).not.toHaveProperty('account')
  })
})
