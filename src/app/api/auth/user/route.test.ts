import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE } from './route'

// The sole-owner check and the soft-delete live in `@/lib/auth/account`,
// tested against a database in `account.db.test.ts`. This file mocks that
// module at the seam and asserts what the route owns: the session, the
// confirmation email, and the status and body each answer maps to (HON-1216).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requestAccountDeletion: vi.fn(),
}))

vi.mock('@/lib/emails/locale', () => ({
  resolveEmailLocale: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: vi.fn() } },
  isEmailConfigured: vi.fn(() => true),
  EMAIL_SENDERS: { auth: 'Test <auth@test>' },
  envSubject: (s: string) => s,
}))

vi.mock('@/lib/emails/account-deletion-requested', () => ({
  generateAccountDeletionRequestedEmail: vi.fn(() => ({
    subject: 'Deletion scheduled',
    html: '<p>html</p>',
    text: 'text',
  })),
}))

import { auth } from '@/lib/auth'
import { AccountDeletionError, requestAccountDeletion } from '@/lib/auth/account'
import { generateAccountDeletionRequestedEmail } from '@/lib/emails/account-deletion-requested'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { captureApiError } from '@/lib/errors'
import { isEmailConfigured, resend } from '@/lib/resend'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockRequestDeletion = vi.mocked(requestAccountDeletion)
const mockResolveLocale = vi.mocked(resolveEmailLocale)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockGenerateEmail = vi.mocked(generateAccountDeletionRequestedEmail)
const mockIsEmailConfigured = vi.mocked(isEmailConfigured)
const mockSend = vi.mocked(resend!.emails.send)

const PURGE = new Date('2026-11-14T03:00:00.000Z')

const signedInUser = {
  user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

describe('DELETE /api/auth/user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(signedInUser)
    mockRequestDeletion.mockResolvedValue({ purgeScheduledFor: PURGE })
    mockResolveLocale.mockResolvedValue('en')
    mockIsEmailConfigured.mockReturnValue(true)
    mockGenerateEmail.mockReturnValue({
      subject: 'Deletion scheduled',
      html: '<p>html</p>',
      text: 'text',
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'unauthorized', error: 'Unauthorized' })
    expect(mockRequestDeletion).not.toHaveBeenCalled()
  })

  it('returns 400 with the household when the user is the sole owner', async () => {
    mockRequestDeletion.mockRejectedValue(
      new AccountDeletionError('soleOwner', {
        id: 'household-123',
        name: 'Doe Family',
        otherMemberCount: 2,
      }),
    )

    const response = await DELETE()

    expect(response.status).toBe(400)
    // HON-725: the client translates `code` and interpolates the count; it
    // never renders the English `message`.
    expect(await response.json()).toEqual({
      code: 'sole_owner',
      error: 'Cannot delete account',
      message:
        'You are the sole owner of "Doe Family" which has 2 other member(s). Please remove the other members first.',
      householdId: 'household-123',
      householdName: 'Doe Family',
      otherMemberCount: 2,
    })
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('requests deletion for the session user and returns the purge instant', async () => {
    const response = await DELETE()

    expect(mockRequestDeletion).toHaveBeenCalledWith('user-123')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      purgeScheduledFor: '2026-11-14T03:00:00.000Z',
    })
  })

  it('sends the confirmation email with the purge date after the soft-delete', async () => {
    await DELETE()

    expect(mockGenerateEmail).toHaveBeenCalledWith(expect.objectContaining({ purgeDate: PURGE }))
    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend.mock.calls[0]![0]).toMatchObject({
      to: 'john@example.com',
      subject: 'Deletion scheduled',
    })
  })

  it('writes the confirmation email in the household locale (HON-513)', async () => {
    mockResolveLocale.mockResolvedValue('et')

    await DELETE()

    expect(mockResolveLocale).toHaveBeenCalledWith('user-123')
    expect(mockGenerateEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'et' }))
  })

  it('still succeeds when email is not configured (no send attempted)', async () => {
    mockIsEmailConfigured.mockReturnValue(false)

    const response = await DELETE()

    expect(response.status).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('still succeeds when the confirmation email fails to send (non-fatal)', async () => {
    mockSend.mockRejectedValueOnce(new Error('Resend down'))

    const response = await DELETE()

    expect(response.status).toBe(200)
    expect((await response.json()).success).toBe(true)
  })

  it('returns 500 and reports the error when the soft-delete throws', async () => {
    const error = new Error('db down')
    mockRequestDeletion.mockRejectedValue(error)

    const response = await DELETE()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'delete_failed',
      error: 'Failed to delete account',
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/auth/user',
      userId: 'user-123',
    })
    expect(mockSend).not.toHaveBeenCalled()
  })
})
