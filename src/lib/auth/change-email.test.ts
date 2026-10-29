import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createEmailVerificationToken } from 'better-auth/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveEmailLocale } from '@/lib/emails/locale'
import { isEmailConfigured, resend } from '@/lib/resend'
import { clearReminderConfirmation } from '@/lib/weekly-reminder'

import { afterAccountEmailChange, readChangeEmailToken } from './change-email'

vi.mock('@/lib/weekly-reminder', () => ({
  clearReminderConfirmation: vi.fn(),
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

vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot' },
}))

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const TTL = 60 * 60 * 24

function changeToken(email: string, updateTo: string) {
  return createEmailVerificationToken(SECRET, email, updateTo, TTL, {
    requestType: 'change-email-verification',
  })
}

function sentMails() {
  return vi
    .mocked(resend!.emails.send)
    .mock.calls.map(([mail]) => mail as { to: string; subject: string; text: string })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isEmailConfigured).mockReturnValue(true)
  vi.mocked(resolveEmailLocale).mockResolvedValue('en')
})

describe('readChangeEmailToken', () => {
  it('reads the old and the new address from a change token', async () => {
    const token = await changeToken('old@example.com', 'new@example.com')

    expect(readChangeEmailToken(token)).toEqual({
      email: 'old@example.com',
      updateTo: 'new@example.com',
    })
  })

  it('returns null for a sign-up verification token', async () => {
    const token = await createEmailVerificationToken(SECRET, 'old@example.com', undefined, TTL)

    expect(readChangeEmailToken(token)).toBeNull()
  })

  it('returns null for a token that is not a JWT', () => {
    expect(readChangeEmailToken('not-a-token')).toBeNull()
    expect(readChangeEmailToken('a.%%%.c')).toBeNull()
    expect(readChangeEmailToken(undefined)).toBeNull()
  })
})

describe('afterAccountEmailChange', () => {
  const user = { id: 'user-1', email: 'new@example.com' }

  it('clears the reminder confirmation and tells the old address', async () => {
    const token = await changeToken('old@example.com', 'new@example.com')

    await afterAccountEmailChange(user, { path: '/verify-email', query: { token } })

    expect(clearReminderConfirmation).toHaveBeenCalledWith('user-1')
    const mails = sentMails()
    expect(mails).toHaveLength(1)
    expect(mails[0]!.to).toBe('old@example.com')
    expect(mails[0]!.subject).toBe('Your Wobblepot email address changed')
    expect(mails[0]!.text).toContain('new@example.com')
    expect(mails[0]!.text).toContain('support@wobblepot.com')
  })

  it('does nothing for a name update', async () => {
    await afterAccountEmailChange(
      { id: 'user-1', email: 'old@example.com' },
      { path: '/update-user', query: null },
    )

    expect(clearReminderConfirmation).not.toHaveBeenCalled()
    expect(resend!.emails.send).not.toHaveBeenCalled()
  })

  it('does nothing for a sign-up verification', async () => {
    const token = await createEmailVerificationToken(SECRET, 'new@example.com', undefined, TTL)

    await afterAccountEmailChange(user, { path: '/verify-email', query: { token } })

    expect(clearReminderConfirmation).not.toHaveBeenCalled()
    expect(resend!.emails.send).not.toHaveBeenCalled()
  })

  it('does nothing when the stored address is not the one the token confirms', async () => {
    const token = await changeToken('old@example.com', 'other@example.com')

    await afterAccountEmailChange(user, { path: '/verify-email', query: { token } })

    expect(clearReminderConfirmation).not.toHaveBeenCalled()
    expect(resend!.emails.send).not.toHaveBeenCalled()
  })

  it('still sends the notice when the reminder clear fails, and never throws', async () => {
    vi.mocked(clearReminderConfirmation).mockRejectedValueOnce(new Error('db down'))
    vi.mocked(resend!.emails.send).mockRejectedValueOnce(new Error('provider down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await changeToken('old@example.com', 'new@example.com')

    await expect(
      afterAccountEmailChange(user, { path: '/verify-email', query: { token } }),
    ).resolves.toBeUndefined()
    expect(resend!.emails.send).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('does not send when email is not configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await changeToken('old@example.com', 'new@example.com')

    await afterAccountEmailChange(user, { path: '/verify-email', query: { token } })

    expect(clearReminderConfirmation).toHaveBeenCalledWith('user-1')
    expect(resend!.emails.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})

// The hook relies on Better Auth 1.7.7 internals: `/verify-email` applies the
// change through `updateUserByEmail`, which runs `databaseHooks.user.update`
// with the endpoint context (`path`, `query.token`). This drives the real flow
// on an in-memory database, so an upgrade that changes it fails here.
describe('Better Auth change-email flow', () => {
  function testAuth(links: { to: string; url: string; token: string }[]) {
    const db: Record<'user' | 'session' | 'account' | 'verification', Record<string, unknown>[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    }
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: SECRET,
      database: memoryAdapter(db),
      emailAndPassword: { enabled: true },
      emailVerification: {
        sendVerificationEmail: async ({ user, url, token }) => {
          links.push({ to: user.email, url, token })
        },
      },
      user: { changeEmail: { enabled: true } },
      databaseHooks: { user: { update: { after: (u, ctx) => afterAccountEmailChange(u, ctx) } } },
    })
    return { auth, db }
  }

  async function signUp(auth: ReturnType<typeof testAuth>['auth'], email: string) {
    const result = await auth.api.signUpEmail({
      body: { email, password: 'a-long-password-1', name: 'Ada' },
      returnHeaders: true,
    })
    return new Headers({ cookie: result.headers.get('set-cookie')!.split(';')[0]! })
  }

  // The form shows the same "Check <address>" for both, so nothing leaks.
  it('answers an address in use like a free one, and sends nothing', async () => {
    const links: { to: string; url: string; token: string }[] = []
    const { auth, db } = testAuth(links)
    await signUp(auth, 'taken@example.com')
    const headers = await signUp(auth, 'old@example.com')

    const taken = await auth.api.changeEmail({
      body: { newEmail: 'taken@example.com', callbackURL: '/account?emailChanged=1' },
      headers,
    })
    const free = await auth.api.changeEmail({
      body: { newEmail: 'free@example.com', callbackURL: '/account?emailChanged=1' },
      headers,
    })

    expect(taken).toEqual({ status: true })
    expect(free).toEqual({ status: true })
    expect(links.map((link) => link.to)).toEqual(['free@example.com'])
    expect(db.user.map((u) => u.email).sort()).toEqual(['old@example.com', 'taken@example.com'])
  })

  it('sends one link to the new address, changes nothing, and runs the hook on open', async () => {
    const links: { to: string; url: string; token: string }[] = []
    const { auth, db } = testAuth(links)
    const headers = await signUp(auth, 'old@example.com')

    await auth.api.changeEmail({
      body: { newEmail: 'new@example.com', callbackURL: '/account?emailChanged=1' },
      headers,
    })

    expect(links).toHaveLength(1)
    expect(links[0]!.to).toBe('new@example.com')
    expect(readChangeEmailToken(links[0]!.token)).toEqual({
      email: 'old@example.com',
      updateTo: 'new@example.com',
    })
    expect(db.user).toMatchObject([{ email: 'old@example.com' }])
    expect(clearReminderConfirmation).not.toHaveBeenCalled()

    const response = await auth.handler(new Request(links[0]!.url, { headers }))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/account?emailChanged=1')
    expect(db.user).toMatchObject([{ email: 'new@example.com', emailVerified: true }])
    const userId = db.user[0]!.id as string
    expect(clearReminderConfirmation).toHaveBeenCalledWith(userId)
    expect(sentMails().map((mail) => mail.to)).toEqual(['old@example.com'])

    // A used link: no user has the token's old address any more, signed in or
    // out. `parseChangeEmailLanding` reads the code as expired.
    const again = await auth.handler(new Request(links[0]!.url, { headers }))
    expect(again.headers.get('location')).toBe('/account?emailChanged=1&error=USER_NOT_FOUND')
    const signedOut = await auth.handler(new Request(links[0]!.url))
    expect(signedOut.headers.get('location')).toBe('/account?emailChanged=1&error=USER_NOT_FOUND')
    expect(clearReminderConfirmation).toHaveBeenCalledTimes(1)
  })
})
