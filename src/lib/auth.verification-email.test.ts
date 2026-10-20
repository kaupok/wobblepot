import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEmailVerificationToken } from 'better-auth/api'
import { sendAccountVerificationEmail } from './auth'
import { resend, isEmailConfigured } from '@/lib/resend'
import { resolveEmailLocale } from '@/lib/emails/locale'

// Split from `auth.test.ts` (file-size cap). The mail callback behind
// `emailVerification.sendVerificationEmail`: sign-up verification (HON-1155)
// and the link to a new address on an email change (HON-1137).

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: vi.fn() } },
  isEmailConfigured: vi.fn(() => true),
  EMAIL_SENDERS: { auth: 'Wobblepot <auth@mail.wobblepot.test>' },
  envSubject: (subject: string) => subject,
}))

vi.mock('@/lib/emails/locale', () => ({
  resolveEmailLocale: vi.fn(async () => 'en'),
}))

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

  // HON-1137: Better Auth sends the change link through this callback too.
  it('sends the change-email copy for a change token, to the new address', async () => {
    const token = await createEmailVerificationToken(
      'test-secret-that-is-at-least-32-characters-long',
      'old@example.com',
      'new@example.com',
      60,
      { requestType: 'change-email-verification' },
    )

    await sendAccountVerificationEmail({ user, url, token })

    const sent = vi.mocked(resend!.emails.send).mock.calls[0]![0] as { to: string; subject: string }
    expect(sent.to).toBe('new@example.com')
    expect(sent.subject).toBe('Confirm your new TestApp email address')
  })

  it('sends the sign-up copy for a plain verification token', async () => {
    await sendAccountVerificationEmail({ user, url, token: 'header.e30.signature' })

    const sent = vi.mocked(resend!.emails.send).mock.calls[0]![0] as { subject: string }
    expect(sent.subject).toBe('Confirm your TestApp email address')
  })

  // A throw here would fail the sign-up request that triggered the send.
  it('logs a failed send and does not throw', async () => {
    vi.mocked(resend!.emails.send).mockRejectedValue(new Error('provider down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendAccountVerificationEmail({ user, url })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})
