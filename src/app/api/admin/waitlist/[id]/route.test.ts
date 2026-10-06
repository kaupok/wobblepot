import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { waitlistRequest: { deleteMany: vi.fn() } },
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DELETE } from './route'

const getSession = vi.mocked(auth.api.getSession)
const deleteMany = prisma.waitlistRequest.deleteMany as unknown as ReturnType<typeof vi.fn>

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
  })

  it('returns 404 for a user who is not the admin and deletes nothing', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await call()).status).toBe(404)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('deletes the request', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockResolvedValue({ count: 1 })

    const res = await call('w1')

    expect(res.status).toBe(200)
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'w1' } })
  })

  it('returns 404 for an unknown request', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockResolvedValue({ count: 0 })
    expect((await call('missing')).status).toBe(404)
  })

  it('returns 500 when the delete fails', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockRejectedValue(new Error('db down'))
    expect((await call()).status).toBe(500)
  })
})
