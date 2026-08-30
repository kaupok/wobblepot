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
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from './route'

const getSession = vi.mocked(auth.api.getSession)
// Cast Prisma mocks since they are mock functions, not the real client method shapes.
const findMany = prisma.signupCode.findMany as unknown as ReturnType<typeof vi.fn>
const create = prisma.signupCode.create as unknown as ReturnType<typeof vi.fn>

const adminSession = {
  user: { id: 'admin_1', email: 'admin@example.com', name: 'Admin' },
} as never
const userSession = {
  user: { id: 'user_1', email: 'someone@example.com', name: 'User' },
} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/signup-codes', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user is not the admin (no leakage of route existence)', async () => {
    getSession.mockResolvedValue(userSession)
    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('returns the list of codes for the admin (flattened wire shape)', async () => {
    getSession.mockResolvedValue(adminSession)
    findMany.mockResolvedValue([
      {
        id: 'c1',
        code: 'abc',
        createdAt: new Date('2026-04-25T12:00:00Z'),
        usedAt: new Date('2026-04-25T13:00:00Z'),
        expiresAt: null,
        note: 'For Anna',
        usedBy: { email: 'anna@example.com' },
      },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.codes).toHaveLength(1)
    // The wire shape MUST match SignupCodeRow (flat usedByEmail) — the client
    // refetches via useQuery and rendering breaks if the API returns the
    // nested usedBy.email shape Prisma produces.
    expect(body.codes[0]).toEqual({
      id: 'c1',
      code: 'abc',
      createdAt: '2026-04-25T12:00:00.000Z',
      usedAt: '2026-04-25T13:00:00.000Z',
      expiresAt: null,
      note: 'For Anna',
      usedByEmail: 'anna@example.com',
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { createdAt: 'desc' } }),
    )
  })

  it('returns 500 with the { error } JSON shape when the query throws', async () => {
    getSession.mockResolvedValue(adminSession)
    findMany.mockRejectedValue(new Error('db down'))

    const res = await GET()

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})

describe('POST /api/admin/signup-codes', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-admin sessions', async () => {
    getSession.mockResolvedValue(userSession)
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(404)
  })

  it('creates a code with a generated string and the admin as createdById', async () => {
    getSession.mockResolvedValue(adminSession)
    create.mockImplementation(async ({ data }) => ({
      id: 'c1',
      ...data,
      createdAt: new Date('2026-04-25T12:00:00Z'),
      usedAt: null,
      expiresAt: null,
      usedBy: null,
    }))

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ note: 'For Anna' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.code.code).toMatch(/^[\w-]{12}$/)
    expect(body.code.note).toBe('For Anna')
    // POST returns the same flat shape as GET — see the GET test above.
    expect(body.code.usedByEmail).toBeNull()
    expect(typeof body.code.createdAt).toBe('string')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: 'admin_1', note: 'For Anna' }),
      }),
    )
  })

  it('rejects oversized notes', async () => {
    getSession.mockResolvedValue(adminSession)
    const longNote = 'x'.repeat(1000)
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ note: longNote }) }),
    )
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('returns 500 with the { error } JSON shape when the insert throws', async () => {
    getSession.mockResolvedValue(adminSession)
    create.mockRejectedValue(new Error('db down'))

    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ note: 'For Anna' }) }),
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})
