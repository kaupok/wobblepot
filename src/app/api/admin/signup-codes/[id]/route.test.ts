import { describe, it, expect, vi, beforeEach } from 'vitest'

// The revoke query lives in `@/lib/signup-codes` (`revokeSignupCode`), tested
// against a database in `signup-codes.db.test.ts`. This file mocks it at the
// seam and asserts the admin gate and the status each refusal maps to
// (HON-1217).

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/signup-codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/signup-codes')>()),
  revokeSignupCode: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { revokeSignupCode, SignupCodeError } from '@/lib/signup-codes'
import { DELETE } from './route'

const getSession = vi.mocked(auth.api.getSession)
const mockRevoke = vi.mocked(revokeSignupCode)

// `ADMIN_EMAIL` is pinned to admin@example.com by the unit project's env in
// vitest.config.ts, so `isAdmin` recognises this session.
const adminSession = {
  user: { id: 'admin_1', email: 'admin@example.com', name: 'Admin' },
} as never
const userSession = {
  user: { id: 'user_1', email: 'someone@example.com', name: 'User' },
} as never

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = () => new Request('http://x', { method: 'DELETE' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/admin/signup-codes/[id]', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await DELETE(req(), params('c1'))).status).toBe(401)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('returns 404 for non-admin sessions without touching the code', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await DELETE(req(), params('c1'))).status).toBe(404)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('revokes the code and answers ok', async () => {
    getSession.mockResolvedValue(adminSession)
    mockRevoke.mockResolvedValue()

    const res = await DELETE(req(), params('c1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRevoke).toHaveBeenCalledWith('c1')
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue(adminSession)
    mockRevoke.mockRejectedValue(new SignupCodeError('notFound'))

    const res = await DELETE(req(), params('missing'))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Code not found' })
  })

  it('returns 409 for a claimed code', async () => {
    getSession.mockResolvedValue(adminSession)
    mockRevoke.mockRejectedValue(new SignupCodeError('alreadyUsed'))

    const res = await DELETE(req(), params('c1'))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Code has already been claimed and cannot be revoked.',
    })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports any other failure', async () => {
    getSession.mockResolvedValue(adminSession)
    const failure = new Error('db down')
    mockRevoke.mockRejectedValue(failure)

    const res = await DELETE(req(), params('c1'))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to revoke signup code' })
    expect(captureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/admin/signup-codes/[id]',
      userId: 'admin_1',
    })
  })
})
