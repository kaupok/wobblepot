import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  disconnectMcpClient: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { disconnectMcpClient } from '@/lib/mcp/consents'
import { DELETE } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockDisconnect = vi.mocked(disconnectMcpClient)

function callDelete(clientId: string) {
  return DELETE(
    new Request(`http://localhost/api/auth/user/mcp-consents/${clientId}`, { method: 'DELETE' }),
    {
      params: Promise.resolve({ clientId }),
    },
  )
}

describe('DELETE /api/auth/user/mcp-consents/[clientId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
  })

  it('answers 401 when signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callDelete('c1')

    expect(response.status).toBe(401)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('disconnects the signed-in user’s client and answers 204', async () => {
    mockDisconnect.mockResolvedValue(true)

    const response = await callDelete('c1')

    expect(response.status).toBe(204)
    expect(mockDisconnect).toHaveBeenCalledWith('user-1', 'c1')
  })

  it('answers 404, not 403, for a client only another user connected', async () => {
    // `disconnectMcpClient` scopes every read and delete to the caller's id,
    // so another user's grant matches nothing and comes back false.
    mockDisconnect.mockResolvedValue(false)

    const response = await callDelete('other-users-client')

    expect(response.status).toBe(404)
    expect(mockDisconnect).toHaveBeenCalledWith('user-1', 'other-users-client')
  })

  it('answers 500 and reports the error when the transaction fails', async () => {
    const error = new Error('db down')
    mockDisconnect.mockRejectedValue(error)

    const response = await callDelete('c1')

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ userId: 'user-1' }),
    )
  })
})
