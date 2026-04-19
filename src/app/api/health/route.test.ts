import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 200 with ok status when DB is reachable', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.db).toBe('ok')
    expect(data.timestamp).toBeDefined()
    expect(mockQueryRaw).toHaveBeenCalled()
  })

  it('returns 503 when DB query fails', async () => {
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data.status).toBe('error')
    expect(data.db).toBe('unreachable')
    expect(data.timestamp).toBeDefined()
  })

  it('returns 503 when DB query times out', async () => {
    mockQueryRaw.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5000)) as never,
    )

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data.status).toBe('error')
    expect(data.db).toBe('unreachable')
  }, 10000)

  it('includes commit SHA from VERCEL_GIT_COMMIT_SHA env var', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def')
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const data = await response.json()

    expect(data.commit).toBe('abc123def')
  })

  it('returns "local" as commit when VERCEL_GIT_COMMIT_SHA is not set', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const data = await response.json()

    expect(data.commit).toBe('local')
  })
})
