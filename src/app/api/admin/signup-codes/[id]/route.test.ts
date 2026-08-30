import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    signupCode: {
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DELETE } from './route'

const getSession = vi.mocked(auth.api.getSession)
// Cast Prisma mocks since they are mock functions, not the real client method shapes.
const deleteMany = prisma.signupCode.deleteMany as unknown as ReturnType<typeof vi.fn>
const findUnique = prisma.signupCode.findUnique as unknown as ReturnType<typeof vi.fn>

// `ADMIN_EMAIL` is pinned to admin@example.com by the unit project's env in
// vitest.config.ts, so `isAdmin` recognises this session.
const adminSession = {
  user: { id: 'admin_1', email: 'admin@example.com', name: 'Admin' },
} as never
const userSession = {
  user: { id: 'user_1', email: 'someone@example.com', name: 'User' },
} as never

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/admin/signup-codes/[id]', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))

    expect(res.status).toBe(401)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the user is not the admin (no leakage of route existence)', async () => {
    getSession.mockResolvedValue(userSession)

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))

    expect(res.status).toBe(404)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('revokes an unused code', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockResolvedValue({ count: 1 })

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', usedAt: null } })
  })

  it('returns 404 when the code does not exist', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue(null)

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('missing'))

    expect(res.status).toBe(404)
  })

  it('returns 409 when the code has already been claimed', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockResolvedValue({ count: 0 })
    findUnique.mockResolvedValue({ usedAt: new Date('2026-04-25T13:00:00Z') })

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))

    expect(res.status).toBe(409)
  })

  it('returns 500 with the { error } JSON shape when the delete throws', async () => {
    getSession.mockResolvedValue(adminSession)
    deleteMany.mockRejectedValue(new Error('db down'))

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))

    expect(res.status).toBe(500)
    const body = await res.json()
    // `apiFetch` parses the body and surfaces `error` — a bare Next.js 500
    // would not be JSON at all, which is the regression this guards.
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})
