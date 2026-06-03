import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { assertUserNotSoftDeleted, SOFT_DELETED_SIGN_IN_MESSAGE } from './soft-delete-guard'
import { prisma } from '@/lib/prisma'

const mockFindUnique = vi.mocked(prisma.user.findUnique)

describe('assertUserNotSoftDeleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves for an active user (deletedAt null)', async () => {
    mockFindUnique.mockResolvedValue({ deletedAt: null } as never)

    await expect(assertUserNotSoftDeleted('user-123')).resolves.toBeUndefined()
  })

  it('resolves when the user row is missing (no leak, let Better Auth handle it)', async () => {
    mockFindUnique.mockResolvedValue(null as never)

    await expect(assertUserNotSoftDeleted('ghost')).resolves.toBeUndefined()
  })

  it('throws a generic credential error for a soft-deleted user', async () => {
    mockFindUnique.mockResolvedValue({ deletedAt: new Date('2026-06-01T00:00:00Z') } as never)

    await expect(assertUserNotSoftDeleted('user-123')).rejects.toThrowError(
      SOFT_DELETED_SIGN_IN_MESSAGE,
    )
  })

  it('does not leak the deletion state in the error message', async () => {
    mockFindUnique.mockResolvedValue({ deletedAt: new Date() } as never)

    // The message must be the generic one, never something like "account deleted".
    expect(SOFT_DELETED_SIGN_IN_MESSAGE).toBe('Invalid email or password')
    await expect(assertUserNotSoftDeleted('user-123')).rejects.toThrowError(
      /Invalid email or password/,
    )
  })
})
