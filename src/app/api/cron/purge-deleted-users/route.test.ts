import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_SECRET = 'x'.repeat(32)

vi.mock('@/lib/env', () => ({
  // Literal (not VALID_SECRET): vi.mock factories are hoisted above the const.
  serverEnv: {
    CRON_SECRET: 'x'.repeat(32),
    NEXT_PUBLIC_APP_ENV: 'test',
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/purge-user', () => ({
  purgeUser: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { GET } from './route'
import { serverEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { purgeUser } from '@/lib/auth/purge-user'

const mockFindMany = vi.mocked(prisma.user.findMany)
const mockPurgeUser = vi.mocked(purgeUser)
// Mutable mock env so individual tests can flip CRON_SECRET / app env.
const env = serverEnv as unknown as { CRON_SECRET?: string; NEXT_PUBLIC_APP_ENV: string }

function req(authHeader?: string) {
  return new Request('http://localhost/api/cron/purge-deleted-users', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('GET /api/cron/purge-deleted-users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.CRON_SECRET = VALID_SECRET
    env.NEXT_PUBLIC_APP_ENV = 'test'
    mockFindMany.mockResolvedValue([] as never)
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer secret does not match', async () => {
    const response = await GET(req('Bearer wrong-secret'))
    expect(response.status).toBe(401)
    expect(mockPurgeUser).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is unset in production', async () => {
    env.CRON_SECRET = undefined
    env.NEXT_PUBLIC_APP_ENV = 'production'

    const response = await GET(req('Bearer anything'))
    expect(response.status).toBe(500)
  })

  it('returns 401 when CRON_SECRET is unset outside production', async () => {
    env.CRON_SECRET = undefined
    env.NEXT_PUBLIC_APP_ENV = 'dev'

    const response = await GET(req('Bearer anything'))
    expect(response.status).toBe(401)
  })

  it('purges every expired user and reports the count', async () => {
    mockFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }] as never)

    const response = await GET(req(`Bearer ${VALID_SECRET}`))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ purged: 2, scanned: 2 })
    expect(mockPurgeUser).toHaveBeenCalledTimes(2)
    expect(mockPurgeUser).toHaveBeenCalledWith('u1')
    expect(mockPurgeUser).toHaveBeenCalledWith('u2')
  })

  it('only targets soft-deleted users past their purge date (leaves in-window intact)', async () => {
    await GET(req(`Bearer ${VALID_SECRET}`))

    const where = mockFindMany.mock.calls[0]![0]!.where
    expect(where!.deletedAt).toEqual({ not: null })
    expect(where!.purgeScheduledFor).toHaveProperty('lt')
    expect((where!.purgeScheduledFor as { lt: Date }).lt).toBeInstanceOf(Date)
  })

  it('continues the batch when one purge fails (partial count, still 200)', async () => {
    mockFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }] as never)
    mockPurgeUser.mockRejectedValueOnce(new Error('cascade failed'))

    const response = await GET(req(`Bearer ${VALID_SECRET}`))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.purged).toBe(1)
    expect(data.scanned).toBe(2)
  })
})
