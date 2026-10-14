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
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  MAX_API_KEY_NAME_LENGTH: 60,
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { createApiKey, listApiKeys } from '@/lib/api-keys'
import { GET, POST } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)

function signInAs(userId: string) {
  mockGetSession.mockResolvedValue({ user: { id: userId } } as never)
}

const SUMMARY = {
  id: 'key-1',
  name: 'Kitchen screen',
  start: 'wp_abcdef',
  createdAt: '2026-10-14T10:00:00.000Z',
  lastUsedAt: null,
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost:3000/api/auth/user/api-keys', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

describe('GET /api/auth/user/api-keys (HON-1220)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers 401 when signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await GET()).status).toBe(401)
    expect(listApiKeys).not.toHaveBeenCalled()
  })

  it("lists the signed-in user's own keys", async () => {
    signInAs('user-1')
    vi.mocked(listApiKeys).mockResolvedValue([SUMMARY])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([SUMMARY])
    expect(listApiKeys).toHaveBeenCalledWith('user-1')
  })

  it('reports a failed read and answers 500', async () => {
    signInAs('user-1')
    vi.mocked(listApiKeys).mockRejectedValue(new Error('db'))

    expect((await GET()).status).toBe(500)
    expect(captureApiError).toHaveBeenCalled()
  })
})

describe('POST /api/auth/user/api-keys (HON-1220)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers 401 when signed out', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await post({ name: 'Kitchen screen' })).status).toBe(401)
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('makes a key with the trimmed name and answers it once, uncached', async () => {
    signInAs('user-1')
    vi.mocked(createApiKey).mockResolvedValue({
      status: 'created',
      key: 'wp_abcdefghijklmnopqrstuvwxyz012345',
      apiKey: SUMMARY,
    })

    const response = await post({ name: '  Kitchen screen  ' })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      key: 'wp_abcdefghijklmnopqrstuvwxyz012345',
      apiKey: SUMMARY,
    })
    expect(createApiKey).toHaveBeenCalledWith('user-1', 'Kitchen screen')
  })

  it.each([
    ['an empty name', { name: '   ' }],
    ['a name over 60 characters', { name: 'x'.repeat(61) }],
    ['no name', {}],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 invalid_name for %s', async (_label, body) => {
    signInAs('user-1')

    const response = await post(body)

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_name')
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('accepts a name of exactly 60 characters', async () => {
    signInAs('user-1')
    vi.mocked(createApiKey).mockResolvedValue({ status: 'created', key: 'k', apiKey: SUMMARY })

    expect((await post({ name: 'x'.repeat(60) })).status).toBe(201)
  })

  it('answers 400 key_limit for an 11th key', async () => {
    signInAs('user-1')
    vi.mocked(createApiKey).mockResolvedValue({ status: 'limit_reached' })

    const response = await post({ name: 'One too many' })

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('key_limit')
  })
})
