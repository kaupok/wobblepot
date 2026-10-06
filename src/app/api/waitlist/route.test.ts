import { describe, it, expect, vi, beforeEach } from 'vitest'

// `after()` callbacks are collected and run by the test, so a case can assert
// on the response before any of the work has happened, as in production.
const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback)
  }),
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot' },
  getServerBaseURL: () => 'https://wobblepot.com',
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 3600),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    waitlistRequest: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: vi.fn() } },
  isEmailConfigured: () => true,
  EMAIL_SENDERS: { auth: 'Wobblepot <auth@mail.wobblepot.com>' },
  envSubject: (subject: string) => subject,
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { POST } from './route'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { prisma } from '@/lib/prisma'
import { resend } from '@/lib/resend'
import { captureApiError } from '@/lib/errors'

const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockGetServerFlag = vi.mocked(getServerFlag)
const mockFindUser = vi.mocked(prisma.user.findUnique)
const mockUpsert = vi.mocked(prisma.waitlistRequest.upsert)
const mockSend = vi.mocked(resend!.emails.send)

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function runAfter() {
  const callbacks = afterCallbacks.splice(0)
  for (const callback of callbacks) await callback()
}

const ALLOWED = { allowed: true, limit: 3, remaining: 2, resetAt: new Date() }

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterCallbacks.length = 0
    mockCheckRateLimit.mockResolvedValue(ALLOWED)
    mockGetServerFlag.mockResolvedValue(true)
    mockFindUser.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({} as never)
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null } as never)
  })

  describe('rejections', () => {
    it.each([
      ['a malformed address', { email: 'not-an-email' }],
      ['a missing address', {}],
      ['a non-JSON body', 'not json'],
    ])('answers 400 for %s', async (_label, body) => {
      const response = await POST(req(body))

      expect(response.status).toBe(400)
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 429 with Retry-After over the per-IP limit', async () => {
      mockCheckRateLimit.mockResolvedValue({ ...ALLOWED, allowed: false, remaining: 0 })

      const response = await POST(req({ email: 'new@example.com' }))

      expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.7', 'waitlist')
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('3600')
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 500 with a JSON error when a dependency throws', async () => {
      const failure = new Error('flag service down')
      mockGetServerFlag.mockRejectedValue(failure)

      const response = await POST(req({ email: 'new@example.com' }))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Request failed' })
      expect(captureApiError).toHaveBeenCalledWith(failure, { route: '/api/waitlist' })
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 409 when sign-up is open', async () => {
      mockGetServerFlag.mockResolvedValue(false)

      const response = await POST(req({ email: 'new@example.com' }))

      expect(mockGetServerFlag).toHaveBeenCalledWith('invite_code_required', 'anonymous')
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'Sign-up is open' })
      expect(afterCallbacks).toHaveLength(0)
    })
  })

  describe('accepted requests', () => {
    it('answers before any lookup, upsert or send has run', async () => {
      const response = await POST(req({ email: 'new@example.com', locale: 'en' }))

      expect(response.status).toBe(200)
      expect(mockFindUser).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(1)
    })

    it('stores a new address trimmed and lowercased, with a token, and sends one email', async () => {
      await POST(req({ email: '  New.Person@Example.COM ', locale: 'en' }))
      await runAfter()

      expect(mockFindUser).toHaveBeenCalledWith({
        where: { email: 'new.person@example.com' },
        select: { id: true },
      })
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      const { where, create, update } = mockUpsert.mock.calls[0]![0]
      expect(where).toEqual({ email: 'new.person@example.com' })
      expect(create).toMatchObject({ email: 'new.person@example.com', locale: 'en' })
      expect(create.confirmToken).toMatch(/^[\w-]{32}$/)
      expect(update.confirmToken).toBe(create.confirmToken)
      expect(update.createdAt).toBeInstanceOf(Date)

      expect(mockSend).toHaveBeenCalledTimes(1)
      const email = mockSend.mock.calls[0]![0]
      expect(email).toMatchObject({
        from: 'Wobblepot <auth@mail.wobblepot.com>',
        to: 'new.person@example.com',
        subject: 'Confirm your Wobblepot invite request',
      })
      expect(email.text).toContain(
        `https://wobblepot.com/request-invite/confirm?token=${create.confirmToken}`,
      )
    })

    it('reissues the token on a repeat, so an unconfirmed or confirmed address gets a fresh link', async () => {
      await POST(req({ email: 'listed@example.com', locale: 'en' }))
      await POST(req({ email: 'listed@example.com', locale: 'en' }))
      await runAfter()

      expect(mockUpsert).toHaveBeenCalledTimes(2)
      const first = mockUpsert.mock.calls[0]![0].update.confirmToken
      const second = mockUpsert.mock.calls[1]![0].update.confirmToken
      expect(first).not.toBe(second)
      // `confirmedAt` is never part of the update: a confirmed row stays confirmed.
      expect(mockUpsert.mock.calls[1]![0].update).not.toHaveProperty('confirmedAt')
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('does nothing for an address with an account', async () => {
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never)

      await POST(req({ email: 'member@example.com', locale: 'en' }))
      await runAfter()

      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('answers the same status and body whether or not the address has an account', async () => {
      const fresh = await POST(req({ email: 'new@example.com' }))
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never)
      const member = await POST(req({ email: 'member@example.com' }))

      expect(fresh.status).toBe(200)
      expect(member.status).toBe(200)
      expect(await fresh.json()).toEqual({ ok: true })
      expect(await member.json()).toEqual({ ok: true })
    })

    it('sends the email in the page locale', async () => {
      await POST(req({ email: 'uus@example.com', locale: 'et' }))
      await runAfter()

      expect(mockUpsert.mock.calls[0]![0].create.locale).toBe('et')
      expect(mockSend.mock.calls[0]![0].subject).toBe('Kinnita oma Wobblepot kutsesoov')
    })

    it('falls back to Accept-Language when the body has no known locale', async () => {
      await POST(req({ email: 'uus@example.com', locale: 'xx' }, { 'accept-language': 'et-EE' }))
      await runAfter()

      expect(mockUpsert.mock.calls[0]![0].create.locale).toBe('et')
    })

    it('logs a send failure and still answers 200', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSend.mockRejectedValue(new Error('Resend down'))

      const response = await POST(req({ email: 'new@example.com' }))
      await runAfter()

      expect(response.status).toBe(200)
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to send waitlist confirmation email:',
        expect.any(Error),
      )
      consoleError.mockRestore()
    })

    it('reports a database failure instead of throwing', async () => {
      const failure = new Error('db down')
      mockUpsert.mockRejectedValue(failure)

      await POST(req({ email: 'new@example.com' }))
      await expect(runAfter()).resolves.toBeUndefined()

      expect(captureApiError).toHaveBeenCalledWith(failure, { route: '/api/waitlist' })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
