import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { AiUsageToast } from './AiUsageToast'

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
  },
}))

const mockToastWarning = vi.mocked(toast.warning)

const originalFetch = global.fetch

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('AiUsageToast', () => {
  it('shows a single warning toast when usage is between 80% and 100%', async () => {
    mockFetchOnce({
      spendUsd: 4.25,
      capUsd: 5,
      percentage: 85,
      resetAt: '2026-05-01T00:00:00.000Z',
    })

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith('AI usage is at 85% of your monthly cap.')
    })
    expect(mockToastWarning).toHaveBeenCalledTimes(1)
  })

  it('rounds the percentage shown in the toast (e.g. 89.7% → 90%)', async () => {
    mockFetchOnce({
      spendUsd: 4.485,
      capUsd: 5,
      percentage: 89.7,
      resetAt: '2026-05-01T00:00:00.000Z',
    })

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith('AI usage is at 90% of your monthly cap.')
    })
  })

  it('does not toast when usage is below 80%', async () => {
    mockFetchOnce({
      spendUsd: 1,
      capUsd: 5,
      percentage: 20,
      resetAt: '2026-05-01T00:00:00.000Z',
    })

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('does not toast when at or above 100% (over-cap returns 429 from AI routes)', async () => {
    mockFetchOnce({
      spendUsd: 5,
      capUsd: 5,
      percentage: 100,
      resetAt: '2026-05-01T00:00:00.000Z',
    })

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('does not re-toast after the gate has been set for the current month', async () => {
    window.sessionStorage.setItem('ai-usage-toast-shown', '2026-05')

    mockFetchOnce({
      spendUsd: 4.25,
      capUsd: 5,
      percentage: 85,
      resetAt: '2026-05-01T00:00:00.000Z',
    })

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('does nothing when the API returns an error (e.g. unauthenticated)', async () => {
    mockFetchOnce({ error: 'Unauthorized' }, false)

    const { wrapper } = createQueryWrapper()
    render(<AiUsageToast />, { wrapper })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    expect(mockToastWarning).not.toHaveBeenCalled()
  })
})
