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
vi.mock('@/lib/api-keys', () => ({
  revokeApiKey: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { revokeApiKey } from '@/lib/api-keys'
import { DELETE } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)

function revoke(id: string) {
  return DELETE(new Request(`http://localhost:3000/api/auth/user/api-keys/${id}`), {
    params: Promise.resolve({ id }),
  })
}

describe('DELETE /api/auth/user/api-keys/[id] (HON-1220)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers 401 when signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await revoke('key-1')).status).toBe(401)
    expect(revokeApiKey).not.toHaveBeenCalled()
  })

  it("revokes the signed-in user's key and answers 204", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    vi.mocked(revokeApiKey).mockResolvedValue(true)

    const response = await revoke('key-1')

    expect(response.status).toBe(204)
    expect(revokeApiKey).toHaveBeenCalledWith('user-1', 'key-1')
  })

  it("answers 404 for another user's key, as for an unknown one", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    vi.mocked(revokeApiKey).mockResolvedValue(false)

    const response = await revoke('someone-elses-key')

    expect(response.status).toBe(404)
  })

  it('reports a failed delete and answers 500', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    vi.mocked(revokeApiKey).mockRejectedValue(new Error('db'))

    expect((await revoke('key-1')).status).toBe(500)
    expect(captureApiError).toHaveBeenCalled()
  })
})
