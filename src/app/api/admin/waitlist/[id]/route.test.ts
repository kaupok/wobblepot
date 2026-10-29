import { beforeEach, describe, expect, it, vi } from 'vitest'

// The delete lives in `@/lib/waitlist` (`deleteWaitlistRequest`), tested
// against a database in `waitlist.db.test.ts`. This file mocks it at the seam
// and asserts the admin gate and the status of each answer (HON-1217).

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/waitlist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waitlist')>()),
  deleteWaitlistRequest: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { deleteWaitlistRequest, WaitlistError } from '@/lib/waitlist'

import { DELETE } from './route'

const getSession = vi.mocked(auth.api.getSession)
const mockDelete = vi.mocked(deleteWaitlistRequest)

const adminSession = { user: { id: 'admin_1', email: 'admin@example.com' } } as never
const userSession = { user: { id: 'user_1', email: 'someone@example.com' } } as never

const call = (id = 'w1') =>
  DELETE(new Request(`http://localhost/api/admin/waitlist/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/admin/waitlist/[id]', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await call()).status).toBe(401)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 for a user who is not the admin and deletes nothing', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await call()).status).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes the request', async () => {
    getSession.mockResolvedValue(adminSession)
    mockDelete.mockResolvedValue()

    const res = await call('w1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockDelete).toHaveBeenCalledWith('w1')
  })

  it('returns 404 for an unknown request', async () => {
    getSession.mockResolvedValue(adminSession)
    mockDelete.mockRejectedValue(new WaitlistError('notFound'))

    const res = await call('missing')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Request not found' })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports it when the delete fails', async () => {
    getSession.mockResolvedValue(adminSession)
    const failure = new Error('db down')
    mockDelete.mockRejectedValue(failure)

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to remove waitlist request' })
    expect(captureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/admin/waitlist/[id]',
      userId: 'admin_1',
    })
  })
})
