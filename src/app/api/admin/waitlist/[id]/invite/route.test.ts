import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The queries live in `@/lib/waitlist` (`prepareWaitlistInvite`,
// `discardWaitlistInviteCode`, `markWaitlistInvited`), tested against a
// database in `waitlist.db.test.ts`. This file mocks them at the seam and
// asserts what the route owns: the admin gate, the email, the order of the
// send and the link, and the status and body of each answer (HON-1217).

const { send, emailState } = vi.hoisted(() => ({
  send: vi.fn(),
  emailState: { configured: true },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot', ADMIN_EMAIL: 'admin@example.com' },
  getServerBaseURL: () => 'https://wobblepot.com',
}))
vi.mock('@/lib/resend', () => ({
  get resend() {
    return emailState.configured ? { emails: { send } } : null
  },
  isEmailConfigured: () => emailState.configured,
  EMAIL_SENDERS: { auth: 'Wobblepot <auth@mail.wobblepot.com>' },
  envSubject: (subject: string) => subject,
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/waitlist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waitlist')>()),
  prepareWaitlistInvite: vi.fn(),
  discardWaitlistInviteCode: vi.fn(),
  markWaitlistInvited: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import {
  discardWaitlistInviteCode,
  markWaitlistInvited,
  type PreparedWaitlistInvite,
  prepareWaitlistInvite,
  WaitlistError,
} from '@/lib/waitlist'

import { POST } from './route'

const getSession = vi.mocked(auth.api.getSession)
const mockPrepare = vi.mocked(prepareWaitlistInvite)
const mockDiscard = vi.mocked(discardWaitlistInviteCode)
const mockMark = vi.mocked(markWaitlistInvited)

const adminSession = { user: { id: 'admin_1', email: 'admin@example.com' } } as never
const userSession = { user: { id: 'user_1', email: 'someone@example.com' } } as never

const NOW = new Date('2026-10-07T10:00:00.000Z')

const invite = (overrides: Partial<PreparedWaitlistInvite> = {}): PreparedWaitlistInvite => ({
  email: 'anna@example.com',
  locale: 'et',
  previousCodeId: null,
  codeId: 'code_new',
  code: 'NEWCODE12345',
  ...overrides,
})

const call = (id = 'w1') =>
  POST(new Request(`http://localhost/api/admin/waitlist/${id}/invite`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: NOW })
  emailState.configured = true
  getSession.mockResolvedValue(adminSession)
  mockPrepare.mockResolvedValue(invite())
  mockDiscard.mockResolvedValue()
  mockMark.mockResolvedValue()
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/admin/waitlist/[id]/invite', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await call()).status).toBe(401)
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('returns 404 for a user who is not the admin and sends nothing', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await call()).status).toBe(404)
    expect(mockPrepare).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 503 before any write when email is not configured', async () => {
    emailState.configured = false

    const res = await call()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Email is not configured' })
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('mints a code as the admin, emails it once in the request locale, then links it', async () => {
    const res = await call('w1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ invitedAt: NOW.toISOString() })
    expect(mockPrepare).toHaveBeenCalledWith({ requestId: 'w1', createdById: 'admin_1', now: NOW })

    expect(send).toHaveBeenCalledTimes(1)
    const email = send.mock.calls[0]![0]
    expect(email.to).toBe('anna@example.com')
    expect(email.from).toBe('Wobblepot <auth@mail.wobblepot.com>')
    expect(email.subject).toBe('Sinu Wobblepot kutsekood')
    expect(email.text).toContain('NEWCODE12345')
    expect(email.text).toContain('https://wobblepot.com/sign-up')
    expect(email.text).toContain('14')

    // The link is written only after the send.
    expect(mockMark).toHaveBeenCalledWith({
      requestId: 'w1',
      previousCodeId: null,
      codeId: 'code_new',
      now: NOW,
    })
    expect(send.mock.invocationCallOrder[0]!).toBeLessThan(mockMark.mock.invocationCallOrder[0]!)
    expect(mockDiscard).not.toHaveBeenCalled()
  })

  it('passes the previous code on Send again, and emails in English for an English request', async () => {
    mockPrepare.mockResolvedValue(invite({ locale: 'en', previousCodeId: 'code_old' }))

    expect((await call('w1')).status).toBe(200)

    expect(mockMark).toHaveBeenCalledWith(expect.objectContaining({ previousCodeId: 'code_old' }))
    expect(send.mock.calls[0]![0].subject).toBe('Your Wobblepot invite code')
  })

  it('falls back to English for a locale the app does not know', async () => {
    mockPrepare.mockResolvedValue(invite({ locale: 'fr' }))

    await call()

    expect(send.mock.calls[0]![0].subject).toBe('Your Wobblepot invite code')
  })

  it('returns 502, discards the unsent code and links nothing when Resend reports an error', async () => {
    const resendError = { name: 'validation_error', message: 'bad' }
    send.mockResolvedValue({ data: null, error: resendError })

    const res = await call('w1')

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to send the invite email' })
    expect(captureApiError).toHaveBeenCalledWith(resendError, {
      route: expect.any(String),
      userId: 'admin_1',
    })
    expect(mockDiscard).toHaveBeenCalledWith('code_new')
    expect(mockMark).not.toHaveBeenCalled()
  })

  it('returns 502 when the send throws, and still answers 502 when the discard fails', async () => {
    send.mockRejectedValue(new Error('network'))
    mockDiscard.mockRejectedValue(new Error('db down'))

    expect((await call()).status).toBe(502)
    expect(captureApiError).toHaveBeenCalledTimes(2)
    expect(mockMark).not.toHaveBeenCalled()
  })

  it('returns 404 for a request that is unknown or not confirmed', async () => {
    mockPrepare.mockRejectedValue(new WaitlistError('notFound'))

    const res = await call('w1')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Request not found' })
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 409 ACCOUNT_EXISTS and sends nothing when the address has an account', async () => {
    mockPrepare.mockRejectedValue(new WaitlistError('accountExists'))

    const res = await call('w1')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'This address already has an account',
      code: 'ACCOUNT_EXISTS',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 409 INVITE_CONFLICT when another send linked first', async () => {
    mockMark.mockRejectedValue(new WaitlistError('inviteConflict'))

    const res = await call('w1')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Another invite was sent at the same time',
      code: 'INVITE_CONFLICT',
    })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 404 when the request is deleted during the send', async () => {
    mockMark.mockRejectedValue(new WaitlistError('notFound'))

    expect((await call('w1')).status).toBe(404)
  })

  it('returns 500 and reports any other failure', async () => {
    const failure = new Error('db down')
    mockPrepare.mockRejectedValue(failure)

    const res = await call('w1')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to send the invite' })
    expect(captureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/admin/waitlist/[id]/invite',
      userId: 'admin_1',
    })
  })
})
