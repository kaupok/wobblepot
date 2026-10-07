import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_SECRET = 'x'.repeat(32)

vi.mock('@/lib/env', () => ({
  // Literal (not VALID_SECRET): vi.mock factories are hoisted above the const.
  serverEnv: {
    CRON_SECRET: 'x'.repeat(32),
    NEXT_PUBLIC_APP_ENV: 'test',
  },
}))

vi.mock('@/lib/weekly-reminder', () => ({
  sendWeeklyReminders: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { GET } from './route'
import { serverEnv } from '@/lib/env'
import { sendWeeklyReminders } from '@/lib/weekly-reminder'

const mockSend = vi.mocked(sendWeeklyReminders)
// Mutable mock env so individual tests can flip CRON_SECRET / app env.
const env = serverEnv as unknown as { CRON_SECRET?: string; NEXT_PUBLIC_APP_ENV: string }

function req(authHeader?: string) {
  return new Request('http://localhost/api/cron/weekly-reminders', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('GET /api/cron/weekly-reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.CRON_SECRET = VALID_SECRET
    env.NEXT_PUBLIC_APP_ENV = 'test'
    mockSend.mockResolvedValue({ sent: 2, skipped: 3, failed: 1 })
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(req())

    expect(response.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer secret does not match', async () => {
    const response = await GET(req('Bearer wrong-secret'))

    expect(response.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is unset in production', async () => {
    env.CRON_SECRET = undefined
    env.NEXT_PUBLIC_APP_ENV = 'production'

    const response = await GET(req('Bearer anything'))

    expect(response.status).toBe(500)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is unset outside production', async () => {
    env.CRON_SECRET = undefined

    const response = await GET(req('Bearer anything'))

    expect(response.status).toBe(401)
  })

  it('runs the send and returns its counts', async () => {
    const response = await GET(req(`Bearer ${VALID_SECRET}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ sent: 2, skipped: 3, failed: 1 })
  })

  it('returns 500 when the run itself fails', async () => {
    mockSend.mockRejectedValue(new Error('db down'))

    const response = await GET(req(`Bearer ${VALID_SECRET}`))

    expect(response.status).toBe(500)
  })
})
