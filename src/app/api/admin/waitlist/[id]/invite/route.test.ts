import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'NEWCODE12345') }))
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
vi.mock('@/lib/prisma', () => {
  const prisma = {
    waitlistRequest: { findFirst: vi.fn(), update: vi.fn() },
    signupCode: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return { prisma }
})
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { POST } from './route'

type MockFn = ReturnType<typeof vi.fn>
const getSession = vi.mocked(auth.api.getSession)
const findFirst = prisma.waitlistRequest.findFirst as unknown as MockFn
const updateRequest = prisma.waitlistRequest.update as unknown as MockFn
const createCode = prisma.signupCode.create as unknown as MockFn
const expireCodes = prisma.signupCode.updateMany as unknown as MockFn
const transaction = prisma.$transaction as unknown as MockFn

const adminSession = { user: { id: 'admin_1', email: 'admin@example.com' } } as never
const userSession = { user: { id: 'user_1', email: 'someone@example.com' } } as never

const NOW = new Date('2026-10-07T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const call = (id = 'w1') =>
  POST(new Request(`http://localhost/api/admin/waitlist/${id}/invite`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: NOW })
  emailState.configured = true
  getSession.mockResolvedValue(adminSession)
  transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  createCode.mockResolvedValue({ id: 'code_new' })
  expireCodes.mockResolvedValue({ count: 1 })
  updateRequest.mockImplementation(async ({ data }: { data: { invitedAt?: Date } }) => ({
    invitedAt: data.invitedAt ?? null,
  }))
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
  findFirst.mockResolvedValue({ email: 'anna@example.com', locale: 'et', signupCodeId: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/admin/waitlist/[id]/invite', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await call()).status).toBe(401)
  })

  it('returns 404 for a user who is not the admin and sends nothing', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await call()).status).toBe(404)
    expect(createCode).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 404 for a request that is unknown or not confirmed', async () => {
    findFirst.mockResolvedValue(null)

    expect((await call('w1')).status).toBe(404)
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1', confirmedAt: { not: null } } }),
    )
    expect(createCode).not.toHaveBeenCalled()
  })

  it('mints a 14-day waitlist code, links it, and emails it once in the request locale', async () => {
    const res = await call('w1')

    expect(res.status).toBe(200)
    expect(createCode).toHaveBeenCalledWith({
      data: {
        code: 'NEWCODE12345',
        expiresAt: new Date(NOW.getTime() + 14 * DAY_MS),
        note: 'waitlist',
        createdById: 'admin_1',
      },
      select: { id: true },
    })
    expect(updateRequest).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { signupCodeId: 'code_new' },
    })
    expect(expireCodes).not.toHaveBeenCalled()

    expect(send).toHaveBeenCalledTimes(1)
    const email = send.mock.calls[0]![0]
    expect(email.to).toBe('anna@example.com')
    expect(email.from).toBe('Wobblepot <auth@mail.wobblepot.com>')
    expect(email.subject).toBe('Sinu Wobblepot kutsekood')
    expect(email.text).toContain('NEWCODE12345')
    expect(email.text).toContain('https://wobblepot.com/sign-up')

    expect(updateRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'w1' }, data: { invitedAt: NOW } }),
    )
    expect(await res.json()).toEqual({ invitedAt: NOW.toISOString() })
  })

  it('expires the previous unused code on Send again', async () => {
    findFirst.mockResolvedValue({
      email: 'anna@example.com',
      locale: 'en',
      signupCodeId: 'code_old',
    })

    expect((await call('w1')).status).toBe(200)

    expect(expireCodes).toHaveBeenCalledWith({
      where: { id: 'code_old', usedAt: null },
      data: { expiresAt: NOW },
    })
    expect(createCode).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].subject).toBe('Your Wobblepot invite code')
  })

  it('falls back to English for a locale the app does not know', async () => {
    findFirst.mockResolvedValue({ email: 'x@example.com', locale: 'fr', signupCodeId: null })

    await call()

    expect(send.mock.calls[0]![0].subject).toBe('Your Wobblepot invite code')
  })

  it('returns 502 and undoes the new code when Resend reports an error', async () => {
    findFirst.mockResolvedValue({
      email: 'anna@example.com',
      locale: 'en',
      signupCodeId: 'code_old',
    })
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad' } })

    const res = await call('w1')

    expect(res.status).toBe(502)
    expect(captureApiError).toHaveBeenCalled()
    // The unsent code is expired and the request points at the code the
    // person already has, which stays valid.
    expect(expireCodes).toHaveBeenCalledTimes(1)
    expect(expireCodes).toHaveBeenCalledWith({
      where: { code: 'NEWCODE12345' },
      data: { expiresAt: NOW },
    })
    expect(updateRequest).toHaveBeenLastCalledWith({
      where: { id: 'w1' },
      data: { signupCodeId: 'code_old' },
    })
    expect(updateRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { invitedAt: expect.anything() } }),
    )
  })

  it('returns 502 when the send throws', async () => {
    send.mockRejectedValue(new Error('network'))
    expect((await call()).status).toBe(502)
  })

  it('returns 503 before any write when email is not configured', async () => {
    emailState.configured = false

    expect((await call()).status).toBe(503)
    expect(findFirst).not.toHaveBeenCalled()
    expect(createCode).not.toHaveBeenCalled()
  })
})
