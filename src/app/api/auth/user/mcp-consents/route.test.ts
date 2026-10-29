import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/mcp/consents', () => ({
  listMcpConsents: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { listMcpConsents } from '@/lib/mcp/consents'

import { GET } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockList = vi.mocked(listMcpConsents)

function signInAs(userId: string) {
  mockGetSession.mockResolvedValue({ user: { id: userId } } as never)
}

describe('GET /api/auth/user/mcp-consents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers 401 when signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('lists the signed-in user’s consents and no one else’s', async () => {
    signInAs('user-1')
    const consents = [
      {
        clientId: 'c1',
        clientName: 'Claude',
        scopes: ['mcp:read'],
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]
    mockList.mockResolvedValue(consents)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(consents)
    expect(mockList).toHaveBeenCalledWith('user-1')
  })

  it('answers 500 and reports the error when the read fails', async () => {
    signInAs('user-1')
    const error = new Error('db down')
    mockList.mockRejectedValue(error)

    const response = await GET()

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ userId: 'user-1' }),
    )
  })
})
