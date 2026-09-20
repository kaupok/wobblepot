import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'

// Mock dependencies
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    // Read by `resolveEmailLocale` to pick the confirmation email's language.
    householdMember: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/household', () => ({
  isUserSoleOwnerWithOtherMembers: vi.fn(),
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
import { prisma } from '@/lib/prisma'
import { isUserSoleOwnerWithOtherMembers } from '@/lib/household'
import { resend, isEmailConfigured } from '@/lib/resend'
import { generateAccountDeletionRequestedEmail } from '@/lib/emails/account-deletion-requested'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindMembership = vi.mocked(prisma.householdMember.findFirst)
const mockGenerateEmail = vi.mocked(generateAccountDeletionRequestedEmail)
const mockIsUserSoleOwner = vi.mocked(isUserSoleOwnerWithOtherMembers)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockIsEmailConfigured = vi.mocked(isEmailConfigured)
const mockSend = vi.mocked(resend!.emails.send)

const DAY_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * DAY_MS

/** Wires `$transaction` to run the callback against a fake tx, capturing the
 *  soft-delete mocks so tests can assert on them. */
function mockSoftDeleteTx() {
  const userUpdate = vi.fn()
  const sessionDeleteMany = vi.fn()
  mockTransaction.mockImplementation(async (fn) => {
    const tx = {
      user: { update: userUpdate },
      session: { deleteMany: sessionDeleteMany },
    }
    return (fn as (tx: unknown) => unknown)(tx)
  })
  return { userUpdate, sessionDeleteMany }
}

const signedInUser = {
  user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

describe('DELETE /api/auth/user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEmailConfigured.mockReturnValue(true)
    // Default: an English household. Without this the lookup rejects on an
    // undefined mock, `resolveEmailLocale` swallows it, and every test would
    // silently exercise the fallback path instead of the real one.
    mockFindMembership.mockResolvedValue({ household: { locale: 'en' } } as never)
    mockGenerateEmail.mockReturnValue({
      subject: 'Deletion scheduled',
      html: '<p>html</p>',
      text: 'text',
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 when user is sole owner with other members (unchanged)', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({
      isSoleOwner: true,
      householdId: 'household-123',
      householdName: 'Doe Family',
      memberCount: 3,
    })

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot delete account')
    expect(data.message).toContain('sole owner')
    expect(data.message).toContain('2 other member(s)')
    expect(data.householdName).toBe('Doe Family')
    // No soft-delete should have run
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('soft-deletes: sets deletedAt + a cron-aligned purge instant and deletes sessions', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    const { userUpdate, sessionDeleteMany } = mockSoftDeleteTx()

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.purgeScheduledFor).toBeTruthy()

    expect(userUpdate).toHaveBeenCalledOnce()
    const updateArg = userUpdate.mock.calls[0]![0] as {
      where: { id: string }
      data: { deletedAt: Date; purgeScheduledFor: Date }
    }
    expect(updateArg.where).toEqual({ id: 'user-123' })
    expect(updateArg.data.deletedAt).toBeInstanceOf(Date)
    expect(updateArg.data.purgeScheduledFor).toBeInstanceOf(Date)

    // Purge is the first 03:00 UTC cron run at/after the 30-day mark: aligned to
    // 03:00:00.000 UTC, never before 30 days, never more than a cron interval after.
    const purge = updateArg.data.purgeScheduledFor
    expect(purge.getUTCHours()).toBe(3)
    expect(purge.getUTCMinutes()).toBe(0)
    expect(purge.getUTCSeconds()).toBe(0)
    expect(purge.getUTCMilliseconds()).toBe(0)
    const diff = purge.getTime() - updateArg.data.deletedAt.getTime()
    expect(diff).toBeGreaterThanOrEqual(THIRTY_DAYS_MS)
    expect(diff).toBeLessThan(THIRTY_DAYS_MS + DAY_MS)

    // sessions invalidated
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } })

    // returned purge date matches the persisted one
    expect(new Date(data.purgeScheduledFor).getTime()).toBe(purge.getTime())
  })

  it('sends the confirmation email after a successful soft-delete', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockSoftDeleteTx()

    await DELETE()

    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend.mock.calls[0]![0]).toMatchObject({ to: 'john@example.com' })
  })

  it('writes the confirmation email in the household locale (HON-513)', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockFindMembership.mockResolvedValue({ household: { locale: 'et' } } as never)
    mockSoftDeleteTx()

    await DELETE()

    expect(mockFindMembership).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
      select: { household: { select: { locale: true } } },
    })
    expect(mockGenerateEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'et' }))
  })

  it('falls back to English when the user has no household (HON-513)', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockFindMembership.mockResolvedValue(null as never)
    mockSoftDeleteTx()

    await DELETE()

    expect(mockGenerateEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }))
  })

  it('still succeeds when email is not configured (no send attempted)', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockIsEmailConfigured.mockReturnValue(false)
    mockSoftDeleteTx()

    const response = await DELETE()

    expect(response.status).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('still succeeds when the confirmation email fails to send (non-fatal)', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockSoftDeleteTx()
    mockSend.mockRejectedValueOnce(new Error('Resend down'))

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('returns 500 when the soft-delete transaction throws', async () => {
    mockGetSession.mockResolvedValue(signedInUser)
    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })
    mockTransaction.mockRejectedValueOnce(new Error('db down'))

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to delete account')
  })
})
