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
    expect(body.incidentMessage).toBeUndefined()
  })

  it('returns 200 with overall degraded when one probe is down', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'down', ...baseProbe, error: 'API error' },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('degraded')

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.overall).toBe('degraded')
    expect(body.components.ai.error).toBe('API error')
  })

  it('returns 200 with overall down when every probe is down', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'down', ...baseProbe },
      auth: { status: 'down', ...baseProbe },
      ai: { status: 'down', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('down')

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.overall).toBe('down')
  })

  it('passes through the incident message when set', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
      incidentMessage: 'Scheduled maintenance in progress',
    })
    mockComputeOverall.mockReturnValue('ok')

    const response = await GET()
    const body = await response.json()

    expect(body.incidentMessage).toBe('Scheduled maintenance in progress')
  })
})
