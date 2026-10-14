import { describe, it, expect, vi, beforeEach } from 'vitest'

// The database check is `pingDatabase` in `@/lib/status/probes`: its failure
// and 2-second timeout are tested in `probes.test.ts`, its query against a
// database in `probes.db.test.ts`. This file mocks it at the seam and asserts
// the status and body (HON-1217).

vi.mock('@/lib/status/probes', () => ({ pingDatabase: vi.fn() }))

import { pingDatabase } from '@/lib/status/probes'
import { GET } from './route'

const mockPing = vi.mocked(pingDatabase)

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 200 with ok status when the database answers', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def')
    mockPing.mockResolvedValue()

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      db: 'ok',
      commit: 'abc123def',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    expect(mockPing).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when the database check fails or times out', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def')
    mockPing.mockRejectedValue(new Error('Probe timeout after 2000ms'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'error',
      db: 'unreachable',
      commit: 'abc123def',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
  })

  it('returns "local" as commit when VERCEL_GIT_COMMIT_SHA is not set', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    mockPing.mockResolvedValue()

    const data = await (await GET()).json()

    expect(data.commit).toBe('local')
  })
})
