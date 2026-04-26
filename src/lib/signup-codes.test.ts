import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APIError } from 'better-auth/api'
import {
  INVITE_CODE_INVALID_MESSAGE,
  INVITE_CODE_REQUIRED_MESSAGE,
  getInviteCodeFromBody,
  linkUsedBy,
  releaseClaim,
  validateAndClaimInviteCode,
} from './signup-codes'

interface MockDb {
  signupCode: {
    updateMany: ReturnType<typeof vi.fn>
  }
}

const makeDb = (updateMany: MockDb['signupCode']['updateMany'] = vi.fn()): MockDb => ({
  signupCode: { updateMany },
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getInviteCodeFromBody', () => {
  it('returns empty string for non-object input', () => {
    expect(getInviteCodeFromBody(null)).toBe('')
    expect(getInviteCodeFromBody(undefined)).toBe('')
    expect(getInviteCodeFromBody('string')).toBe('')
    expect(getInviteCodeFromBody(42)).toBe('')
  })

  it('returns empty string when inviteCode is missing or non-string', () => {
    expect(getInviteCodeFromBody({})).toBe('')
    expect(getInviteCodeFromBody({ inviteCode: 1 })).toBe('')
    expect(getInviteCodeFromBody({ inviteCode: null })).toBe('')
  })

  it('trims whitespace around a string code (avoids "code " mismatches)', () => {
    expect(getInviteCodeFromBody({ inviteCode: '  abc-123 ' })).toBe('abc-123')
  })
})

describe('validateAndClaimInviteCode', () => {
  it('short-circuits and does no DB work when the flag is false', async () => {
    const db = makeDb()
    const getFlag = vi.fn().mockResolvedValue(false)

    await validateAndClaimInviteCode({ inviteCode: 'unused' }, { db: db as never, getFlag })

    expect(getFlag).toHaveBeenCalledWith('invite_code_required', 'anonymous')
    expect(db.signupCode.updateMany).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN with the expected message when the code is missing', async () => {
    const db = makeDb()
    const getFlag = vi.fn().mockResolvedValue(true)

    await expect(
      validateAndClaimInviteCode({}, { db: db as never, getFlag }),
    ).rejects.toMatchObject({
      message: INVITE_CODE_REQUIRED_MESSAGE,
    })
    expect(db.signupCode.updateMany).not.toHaveBeenCalled()
  })

  it('treats whitespace-only codes as missing', async () => {
    const db = makeDb()
    const getFlag = vi.fn().mockResolvedValue(true)

    await expect(
      validateAndClaimInviteCode({ inviteCode: '   ' }, { db: db as never, getFlag }),
    ).rejects.toMatchObject({ message: INVITE_CODE_REQUIRED_MESSAGE })
  })

  it('throws FORBIDDEN with the invalid-code message when claim count is 0', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = makeDb(updateMany)
    const getFlag = vi.fn().mockResolvedValue(true)

    await expect(
      validateAndClaimInviteCode({ inviteCode: 'wrong' }, { db: db as never, getFlag }),
    ).rejects.toMatchObject({ message: INVITE_CODE_INVALID_MESSAGE })

    // Predicate ensures invalid, expired, and already-used codes all map to count: 0.
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        code: 'wrong',
        usedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      }),
      data: { usedAt: expect.any(Date) },
    })
  })

  it('resolves silently when the atomic claim succeeds (count: 1)', async () => {
    const db = makeDb(vi.fn().mockResolvedValue({ count: 1 }))
    const getFlag = vi.fn().mockResolvedValue(true)

    await expect(
      validateAndClaimInviteCode({ inviteCode: 'good' }, { db: db as never, getFlag }),
    ).resolves.toBeUndefined()
  })

  it('the rejection is an APIError so Better Auth converts it to 403', async () => {
    const db = makeDb()
    const getFlag = vi.fn().mockResolvedValue(true)

    await expect(
      validateAndClaimInviteCode({}, { db: db as never, getFlag }),
    ).rejects.toBeInstanceOf(APIError)
  })

  it('serialises concurrent claims — exactly one parallel caller resolves', async () => {
    // Simulate row-level locking: first updateMany returns count: 1 (winner),
    // second returns count: 0 (loser). This is the exact behaviour Postgres
    // produces when two transactions race on the same row predicate.
    let callsMade = 0
    const updateMany = vi.fn().mockImplementation(async () => {
      callsMade += 1
      return { count: callsMade === 1 ? 1 : 0 }
    })
    const db = makeDb(updateMany)
    const getFlag = vi.fn().mockResolvedValue(true)

    const results = await Promise.allSettled([
      validateAndClaimInviteCode({ inviteCode: 'shared' }, { db: db as never, getFlag }),
      validateAndClaimInviteCode({ inviteCode: 'shared' }, { db: db as never, getFlag }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toMatchObject({ message: INVITE_CODE_INVALID_MESSAGE })
    }
    expect(updateMany).toHaveBeenCalledTimes(2)
  })
})

describe('linkUsedBy', () => {
  it('skips when no code is on the body', async () => {
    const db = makeDb()
    await linkUsedBy({}, 'user_1', { db: db as never })
    expect(db.signupCode.updateMany).not.toHaveBeenCalled()
  })

  it('updates the usedById on a matching unlinked code', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = makeDb(updateMany)

    await linkUsedBy({ inviteCode: 'good' }, 'user_1', { db: db as never })

    expect(updateMany).toHaveBeenCalledWith({
      where: { code: 'good', usedById: null },
      data: { usedById: 'user_1' },
    })
  })

  it('swallows DB errors so a backfill failure does not fail sign-up', async () => {
    const error = new Error('connection lost')
    const updateMany = vi.fn().mockRejectedValue(error)
    const db = makeDb(updateMany)

    await expect(
      linkUsedBy({ inviteCode: 'good' }, 'user_1', { db: db as never }),
    ).resolves.toBeUndefined()
    // Log MUST include `code` and `userId` so admins can recover from the row
    // by hand — see the docstring on linkUsedBy and the review thread that
    // surfaced the missing context.
    expect(console.warn).toHaveBeenCalledWith('[signup-code] failed to link usedById', {
      code: 'good',
      userId: 'user_1',
      err: error,
    })
  })

  it('warns with the code and userId when zero rows match (admin recovery path)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = makeDb(updateMany)

    await linkUsedBy({ inviteCode: 'good' }, 'user_1', { db: db as never })

    expect(console.warn).toHaveBeenCalledWith('[signup-code] linkUsedBy matched zero rows', {
      code: 'good',
      userId: 'user_1',
    })
  })
})

describe('releaseClaim', () => {
  it('skips when no code is on the body', async () => {
    const db = makeDb()
    await releaseClaim({}, { db: db as never })
    expect(db.signupCode.updateMany).not.toHaveBeenCalled()
  })

  it('clears usedAt on a claimed-but-unlinked code', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = makeDb(updateMany)

    await releaseClaim({ inviteCode: 'good' }, { db: db as never })

    expect(updateMany).toHaveBeenCalledWith({
      where: { code: 'good', usedById: null, usedAt: { not: null } },
      data: { usedAt: null },
    })
    expect(console.warn).toHaveBeenCalledWith(
      '[signup-code] released unlinked claim after sign-up failure',
      { code: 'good' },
    )
  })

  it('does not roll back a claim that was already linked to a user', async () => {
    // The `usedById: null` predicate is the safety belt — if a user already
    // claimed and linked the code, releaseClaim's updateMany matches zero
    // rows. No rollback, no warn (nothing to recover from).
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = makeDb(updateMany)

    await releaseClaim({ inviteCode: 'good' }, { db: db as never })

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('swallows DB errors so a release failure does not bubble up to Better Auth', async () => {
    const error = new Error('connection lost')
    const updateMany = vi.fn().mockRejectedValue(error)
    const db = makeDb(updateMany)

    await expect(releaseClaim({ inviteCode: 'good' }, { db: db as never })).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith('[signup-code] failed to release claim', {
      code: 'good',
      err: error,
    })
  })
})
