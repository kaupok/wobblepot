import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/status/probes', () => ({
  getStatusSnapshot: vi.fn(),
  computeOverall: vi.fn(),
}))

import { getStatusSnapshot, computeOverall } from '@/lib/status/probes'
import StatusPage from './page'

const mockGetSnapshot = vi.mocked(getStatusSnapshot)
const mockComputeOverall = vi.mocked(computeOverall)

const baseProbe = { checkedAt: '2026-04-20T12:00:00.000Z', latencyMs: 12 }

describe('StatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a card for each of the three components', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    expect(screen.getByText('AI pipeline')).toBeInTheDocument()
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText(/All systems operational/i)).toBeInTheDocument()
  })

  it('renders the incident banner when a message is set', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
      incidentMessage: 'Scheduled maintenance at 02:00 UTC',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Scheduled maintenance at 02:00 UTC/)).toBeInTheDocument()
  })

  it('renders degraded copy when one probe is down', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'down', ...baseProbe, error: 'API error' },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('degraded')

    render(await StatusPage())

    expect(screen.getByText(/Partial outage/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Down/i).length).toBeGreaterThan(0)
  })

  it('renders the support email link', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    const link = screen.getByRole('link', { name: /support@wobblepot\.com/i })
    expect(link).toHaveAttribute('href', 'mailto:support@wobblepot.com')
  })
})
