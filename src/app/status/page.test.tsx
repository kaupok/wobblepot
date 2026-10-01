import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import type { Locale } from '@/lib/i18n/locales'

const { localeRef } = vi.hoisted(() => ({ localeRef: { current: 'en' as Locale } }))

const CATALOGS: Record<Locale, Messages> = { en: enMessages, et: etMessages }

// Real translators over the real catalogs, so an `et` request is asserted
// against the Estonian copy rather than against key paths.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) =>
    createTranslator({
      locale: localeRef.current,
      messages: CATALOGS[localeRef.current],
      namespace: namespace as never,
    }),
  ),
}))
vi.mock('@/lib/i18n/get-locale', () => ({
  getLocale: vi.fn(async () => localeRef.current),
}))

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
    localeRef.current = 'en'
  })

  it('renders a card for each component', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    expect(screen.getByText('AI pipeline')).toBeInTheDocument()
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Rate limiting')).toBeInTheDocument()
    expect(screen.getByText(/All systems operational/i)).toBeInTheDocument()
  })

  it('renders its title as the only heading, at level 1', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    const headings = screen.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Status' })).toBe(headings[0])
  })

  it('renders the incident banner when a message is set', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
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
      rateLimit: { status: 'ok', ...baseProbe },
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
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    const link = screen.getByRole('link', { name: /support@wobblepot\.com/i })
    expect(link).toHaveAttribute('href', 'mailto:support@wobblepot.com')
  })

  it('formats the check time in UTC in the request locale', async () => {
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'ok', ...baseProbe },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
    })
    mockComputeOverall.mockReturnValue('ok')

    render(await StatusPage())

    // 1 overall + 4 component timestamps.
    expect(screen.getAllByText('Checked at Apr 20, 2026, 12:00 PM UTC')).toHaveLength(5)
    expect(screen.getAllByText('Latency: 12 ms')).toHaveLength(4)
  })

  it('renders Estonian copy for an et request', async () => {
    localeRef.current = 'et'
    mockGetSnapshot.mockResolvedValue({
      db: { status: 'ok', ...baseProbe },
      auth: { status: 'ok', ...baseProbe },
      ai: { status: 'down', ...baseProbe, error: 'API error' },
      rateLimit: { status: 'ok', ...baseProbe },
      timestamp: '2026-04-20T12:00:00.000Z',
      incidentMessage: 'Hooldus kell 02:00 UTC',
    })
    mockComputeOverall.mockReturnValue('degraded')

    render(await StatusPage())

    expect(screen.getByRole('heading', { level: 1, name: 'Olek' })).toBeInTheDocument()
    expect(screen.getByText('Käimas on intsident')).toBeInTheDocument()
    expect(screen.getByText('Osaline katkestus')).toBeInTheDocument()
    expect(screen.getByText('Andmebaas')).toBeInTheDocument()
    expect(screen.getAllByText('Töötab')).toHaveLength(3)
    expect(screen.getByText('Maas')).toBeInTheDocument()
    expect(screen.getAllByText('Kontrollitud 20. apr 2026, 12:00 UTC')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'avalehele' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Operational|Checked at|Latency/)).not.toBeInTheDocument()
  })
})
