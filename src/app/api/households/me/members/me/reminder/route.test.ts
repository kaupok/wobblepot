import { describe, it, expect, vi, beforeEach } from 'vitest'

// The reminder write lives in `saveReminder` (`@/lib/weekly-reminder`), tested
// against a database in `weekly-reminder.db.test.ts`. This file mocks that
// module at the seam and asserts what the route owns: the session, body
// validation, the confirm email with its rate limit, and the status and body
// each answer maps to (HON-1214).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/weekly-reminder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/weekly-reminder')>()),
  saveReminder: vi.fn(),
  sendReminderConfirmEmail: vi.fn(),
}))

import { PATCH } from './route'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { saveReminder, sendReminderConfirmEmail } from '@/lib/weekly-reminder'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockSave = vi.mocked(saveReminder)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockSendConfirm = vi.mocked(sendReminderConfirmEmail)

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/households/me/members/me/reminder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

describe('PATCH /api/households/me/members/me/reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'pat@example.com' },
    } as never)
    mockSave.mockResolvedValue({ confirmToken: null })
    mockRateLimit.mockResolvedValue({ allowed: true } as never)
    mockSendConfirm.mockResolvedValue(true)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch({ weekday: 7 }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('returns 404 without a membership', async () => {
    mockSave.mockResolvedValue(null)

    expect(await answer(patch({ weekday: 7 }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it.each([[0], [8], [1.5], ['7'], [undefined]])('returns 400 for weekday %s', async (weekday) => {
    expect(await answer(patch({ weekday }))).toEqual({
      status: 400,
      body: { error: 'Validation failed' },
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    expect(await answer(patch('not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it("saves the caller's own reminder for the weekday sent", async () => {
    expect(await answer(patch({ weekday: 3 }))).toEqual({ status: 200, body: { weekday: 3 } })
    expect(mockSave).toHaveBeenCalledWith('user-1', 3)
    expect(mockSendConfirm).not.toHaveBeenCalled()
  })

  it('switches it off with a null weekday', async () => {
    expect(await answer(patch({ weekday: null }))).toEqual({
      status: 200,
      body: { weekday: null },
    })
    expect(mockSave).toHaveBeenCalledWith('user-1', null)
  })

  it('returns 500 and logs when the save throws', async () => {
    const failure = new Error('db down')
    mockSave.mockRejectedValue(failure)

    expect(await answer(patch({ weekday: 3 }))).toEqual({
      status: 500,
      body: { error: 'Failed to save the reminder' },
    })
    expect(captureApiError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ userId: 'user-1' }),
    )
  })

  describe('the confirm email (HON-1113)', () => {
    beforeEach(() => {
      mockSave.mockResolvedValue({ confirmToken: 'confirm-1' })
    })

    it('sends it once, after the save, to the caller, with the token the save returned', async () => {
      expect(await answer(patch({ weekday: 7 }))).toEqual({
        status: 200,
        body: { weekday: 7, confirmEmail: 'sent' },
      })
      expect(mockRateLimit).toHaveBeenCalledWith('user-1', 'reminder-confirm')
      expect(mockSendConfirm).toHaveBeenCalledTimes(1)
      expect(mockSendConfirm).toHaveBeenCalledWith({
        to: 'pat@example.com',
        userId: 'user-1',
        token: 'confirm-1',
      })
      expect(mockSave.mock.invocationCallOrder[0]).toBeLessThan(
        mockSendConfirm.mock.invocationCallOrder[0]!,
      )
    })

    it('sends nothing when the save says no email is due', async () => {
      mockSave.mockResolvedValue({ confirmToken: null })

      expect(await answer(patch({ weekday: 3 }))).toEqual({ status: 200, body: { weekday: 3 } })
      expect(mockSendConfirm).not.toHaveBeenCalled()
      expect(mockRateLimit).not.toHaveBeenCalled()
    })

    it('saves but sends nothing, and says so, when the rate limit is reached', async () => {
      mockRateLimit.mockResolvedValue({ allowed: false } as never)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(await answer(patch({ weekday: 7 }))).toEqual({
        status: 200,
        body: { weekday: 7, confirmEmail: 'not_sent' },
      })
      expect(mockSave).toHaveBeenCalled()
      expect(mockSendConfirm).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('reports not_sent when email is not configured', async () => {
      mockSendConfirm.mockResolvedValue(false)

      expect((await answer(patch({ weekday: 7 }))).body).toEqual({
        weekday: 7,
        confirmEmail: 'not_sent',
      })
    })

    it('saves, logs and reports not_sent when the email fails to send', async () => {
      const failure = new Error('Resend down')
      mockSendConfirm.mockRejectedValue(failure)

      expect(await answer(patch({ weekday: 7 }))).toEqual({
        status: 200,
        body: { weekday: 7, confirmEmail: 'not_sent' },
      })
      expect(captureApiError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ userId: 'user-1', step: 'confirm-email' }),
      )
    })
  })
})
