import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/weekly-reminder', () => ({
  stopRemindersByToken: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { GET, POST } from './route'
import { stopRemindersByToken } from '@/lib/weekly-reminder'

const mockStop = vi.mocked(stopRemindersByToken)
const BASE = 'http://localhost/api/reminders/stop'

describe('POST /api/reminders/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStop.mockResolvedValue()
  })

  it('stops the reminders for the token in a JSON body (the stop page)', async () => {
    const response = await POST(
      new Request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'token-1' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mockStop).toHaveBeenCalledWith('token-1')
  })

  it('stops the reminders for a one-click form POST, token in the URL (RFC 8058)', async () => {
    const response = await POST(
      new Request(`${BASE}?token=token-1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    )

    expect(response.status).toBe(200)
    expect(mockStop).toHaveBeenCalledWith('token-1')
  })

  it('answers an unknown token the same as a real one', async () => {
    // `stopRemindersByToken` matches no row and resolves without a signal.
    const response = await POST(
      new Request(BASE, { method: 'POST', body: JSON.stringify({ token: 'nobody' }) }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ stopped: true })
  })

  it('returns 400 without a token', async () => {
    const response = await POST(new Request(BASE, { method: 'POST', body: '{}' }))

    expect(response.status).toBe(400)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('returns 500 when the update fails', async () => {
    mockStop.mockRejectedValue(new Error('db down'))

    const response = await POST(new Request(`${BASE}?token=token-1`, { method: 'POST' }))

    expect(response.status).toBe(500)
  })
})

describe('GET /api/reminders/stop', () => {
  it('changes nothing and sends the person to the stop page', () => {
    const response = GET(new Request(`${BASE}?token=token-1`))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/reminders/stop?token=token-1')
    expect(mockStop).not.toHaveBeenCalled()
  })
})
