import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/status/probes', () => ({
  getStatusSnapshot: vi.fn(),
  computeOverall: vi.fn(),
}))

import { getStatusSnapshot, computeOverall } from '@/lib/status/probes'
import { GET } from './route'

const mockGetSnapshot = vi.mocked(getStatusSnapshot)
const mockComputeOverall = vi.mocked(computeOverall)

const baseProbe = { checkedAt: '2026-04-20T12:00:00.000Z', latencyMs: 10 }

describe('GET /api/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with overall ok when every probe is ok', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.overall).toBe('ok')
    expect(body.components.db.status).toBe('ok')
    expect(body.components.auth.status).toBe('ok')
    expect(body.components.ai.status).toBe('ok')
    expect(body.components.rateLimit.status).toBe('ok')
    expect(body.incidentMessage).toBeUndefined()
  })

  it('returns 200 with overall degraded when one probe is down', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: {
        status: 'down',
        ...baseProbe,
        error: "P1001: Can't reach database server at 'ep-xyz.us-east-2.aws.neon.tech'",
      },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('degraded')

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.overall).toBe('degraded')
    expect(body.components.ai.status).toBe('down')
  })

  it('does not leak raw error messages to the public payload', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: {
        status: 'down',
        ...baseProbe,
        error: "P1001: Can't reach database server at 'ep-xyz.us-east-2.aws.neon.tech:5432'",
      },
      auth: {
        status: 'down',
        ...baseProbe,
        error: 'Invalid `prisma.session.count()` invocation: Table public.session does not exist',
      },
      ai: { status: 'down', ...baseProbe, error: 'Anthropic request rid=abc123 failed' },
      rateLimit: {
        status: 'down',
        ...baseProbe,
        error: 'WRONGPASS invalid token for https://tidy-gopher-12345.upstash.io',
      },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('down')

    const response = await GET()
    const body = await response.json()

    expect(body.components.db.error).toBeUndefined()
    expect(body.components.auth.error).toBeUndefined()
    expect(body.components.ai.error).toBeUndefined()
    expect(body.components.rateLimit.error).toBeUndefined()
    const asText = JSON.stringify(body)
    expect(asText).not.toMatch(/neon\.tech/i)
    expect(asText).not.toMatch(/prisma/i)
    expect(asText).not.toMatch(/rid=abc123/i)
    expect(asText).not.toMatch(/upstash\.io/i)
  })

  it('returns 200 with overall down when every probe is down', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'down', ...baseProbe },
      auth: { status: 'down', ...baseProbe },
      ai: { status: 'down', ...baseProbe },
      rateLimit: { status: 'down', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('down')

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.overall).toBe('down')
  })

  it('includes commitSha from VERCEL_GIT_COMMIT_SHA when set', async () => {
    const original = process.env.VERCEL_GIT_COMMIT_SHA
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def456'
    try {
      mockGetSnapshot.mockResolvedValue({
        db: { status: 'ok', ...baseProbe },
        auth: { status: 'ok', ...baseProbe },
        ai: { status: 'ok', ...baseProbe },
        rateLimit: { status: 'ok', ...baseProbe },
        timestamp: '2026-04-20T12:00:00.000Z',
      })
      mockComputeOverall.mockReturnValue('ok')

      const response = await GET()
      const body = await response.json()

      expect(body.commitSha).toBe('abc123def456')
    } finally {
      if (original === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
      else process.env.VERCEL_GIT_COMMIT_SHA = original
    }
  })

  it('omits commitSha when VERCEL_GIT_COMMIT_SHA is unset', async () => {
    const original = process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA
    try {
      mockGetSnapshot.mockResolvedValue({
        db: { status: 'ok', ...baseProbe },
        auth: { status: 'ok', ...baseProbe },
        ai: { status: 'ok', ...baseProbe },
        rateLimit: { status: 'ok', ...baseProbe },
        timestamp: '2026-04-20T12:00:00.000Z',
      })
      mockComputeOverall.mockReturnValue('ok')

      const response = await GET()
      const body = await response.json()

      expect(body.commitSha).toBeUndefined()
    } finally {
      if (original !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = original
    }
  })

  it('passes through the incident message when set', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
      incidentMessage: 'Scheduled maintenance in progress',
    })
    mockComputeOverall.mockReturnValue('ok')

    const response = await GET()
    const body = await response.json()

    expect(body.incidentMessage).toBe('Scheduled maintenance in progress')
  })
})
