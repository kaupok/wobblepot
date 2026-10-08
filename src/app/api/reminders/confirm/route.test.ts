import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/weekly-reminder', () => ({
  confirmReminderToken: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { POST } from './route'
import { confirmReminderToken } from '@/lib/weekly-reminder'
import { captureApiError } from '@/lib/errors'

const mockConfirm = vi.mocked(confirmReminderToken)

function post(body: string) {
  return POST(
    new Request('http://localhost/api/reminders/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  )
}

describe('POST /api/reminders/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('confirms the token in the body and says so', async () => {
    mockConfirm.mockResolvedValue(true)

    const response = await post(JSON.stringify({ token: 'confirm-1' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ confirmed: true })
    expect(mockConfirm).toHaveBeenCalledWith('confirm-1')
  })

  it('answers confirmed: false for a token that does not confirm', async () => {
    mockConfirm.mockResolvedValue(false)

    const response = await post(JSON.stringify({ token: 'old' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ confirmed: false })
  })

  it.each([['{}'], [JSON.stringify({ token: '' })], [JSON.stringify({ token: 7 })], ['not json']])(
    'returns 400 without a token: %s',
    async (body) => {
      const response = await post(body)

      expect(response.status).toBe(400)
      expect(mockConfirm).not.toHaveBeenCalled()
    },
  )

  it('returns 500 and logs when the confirm fails', async () => {
    const failure = new Error('db down')
    mockConfirm.mockRejectedValue(failure)

    const response = await post(JSON.stringify({ token: 'confirm-1' }))

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledWith(failure, { route: '/api/reminders/confirm' })
  })
})
