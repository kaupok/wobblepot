import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every query lives in `@/lib/signup-codes`, tested against a database in
// `signup-codes.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the admin gate, body parsing and validation,
// and the status and body of each answer (HON-1217).

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/signup-codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/signup-codes')>()),
  listSignupCodes: vi.fn(),
  createSignupCode: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { createSignupCode, listSignupCodes, type SignupCodeRow } from '@/lib/signup-codes'

import { GET, POST } from './route'

const getSession = vi.mocked(auth.api.getSession)
const mockList = vi.mocked(listSignupCodes)
const mockCreate = vi.mocked(createSignupCode)

const adminSession = {
  user: { id: 'admin_1', email: 'admin@example.com', name: 'Admin' },
} as never
const userSession = {
  user: { id: 'user_1', email: 'someone@example.com', name: 'User' },
} as never

const usedRow: SignupCodeRow = {
  id: 'c1',
  code: 'abc',
  createdAt: '2026-04-25T12:00:00.000Z',
  usedAt: '2026-04-25T13:00:00.000Z',
  expiresAt: null,
  note: 'For Anna',
  usedByEmail: 'anna@example.com',
}

const post = (body: string) => new Request('http://x', { method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/signup-codes', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await GET()).status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 when the user is not the admin (no leakage of route existence)', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await GET()).status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns the codes for the admin', async () => {
    getSession.mockResolvedValue(adminSession)
    mockList.mockResolvedValue([usedRow])

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ codes: [usedRow] })
  })

  it('returns 500 with an error and reports it when the query throws', async () => {
    getSession.mockResolvedValue(adminSession)
    const failure = new Error('db down')
    mockList.mockRejectedValue(failure)

    const res = await GET()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to fetch signup codes' })
    expect(captureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/admin/signup-codes',
      userId: 'admin_1',
    })
  })
})

describe('POST /api/admin/signup-codes', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await POST(post('{}'))).status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 404 for non-admin sessions', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await POST(post('{}'))).status).toBe(404)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a code with the trimmed note and the admin as creator, and returns it', async () => {
    getSession.mockResolvedValue(adminSession)
    const created = { ...usedRow, usedAt: null, usedByEmail: null }
    mockCreate.mockResolvedValue(created)

    const res = await POST(post(JSON.stringify({ note: '  For Anna  ' })))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ code: created })
    expect(mockCreate).toHaveBeenCalledWith({ createdById: 'admin_1', note: 'For Anna' })
  })

  it('creates a code with no note for an empty body', async () => {
    getSession.mockResolvedValue(adminSession)
    mockCreate.mockResolvedValue({ ...usedRow, note: null })

    const res = await POST(post(''))

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({ createdById: 'admin_1', note: null })
  })

  it('rejects a body that is not JSON', async () => {
    getSession.mockResolvedValue(adminSession)

    const res = await POST(post('{not json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects oversized notes', async () => {
    getSession.mockResolvedValue(adminSession)

    const res = await POST(post(JSON.stringify({ note: 'x'.repeat(1000) })))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid request')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 500 with an error when the insert throws', async () => {
    getSession.mockResolvedValue(adminSession)
    mockCreate.mockRejectedValue(new Error('db down'))

    const res = await POST(post(JSON.stringify({ note: 'For Anna' })))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to create signup code' })
  })
})
