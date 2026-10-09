import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import {
  AlreadyInHouseholdError,
  InviteNoLongerClaimableError,
  inviteMembershipClaim,
  runHouseholdClaim,
  backoffDelayMs,
  isMembershipConflict,
  MAX_CLAIM_ATTEMPTS,
} from './household-claim'

const mockTransaction = vi.mocked(prisma.$transaction)

const serializationFailure = () =>
  new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: 'test',
  })

/** Distinct fractions, cycled, so each wait in a round draws a different one. */
const JITTER_DRAWS = [0.25, 0.75, 0.5, 0.125]

const jitterDraw = (index: number): number => JITTER_DRAWS[index % JITTER_DRAWS.length]!

describe('runHouseholdClaim', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Fake timers throughout: the retry path now waits between attempts, and a
    // suite that slept for real would pay that wait on every retry test.
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Restore spies before the timers: a `setTimeout` spy was installed on the
    // *fake* global, so restoring it after `useRealTimers` would put the fake
    // back and leak it into the next file.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("locks the claiming user's row before the claim, at read committed", async () => {
    const calls: string[] = []
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(`lock ${strings.join('?')} ${JSON.stringify(values)}`)
        return []
      }),
    }
    const claim = vi.fn(async () => {
      calls.push('claim')
      return 'claimed'
    })
    mockTransaction.mockImplementation((callback: unknown) =>
      (callback as (client: unknown) => Promise<unknown>)(tx),
    )

    await expect(runHouseholdClaim('user-1', claim)).resolves.toBe('claimed')

    // The lock is the fix, and it has to come first: the membership check in
    // `claim` is only race-free once the user's row is held. Read committed is
    // what keeps unrelated claims apart — `Serializable` aborted one of any two
    // concurrent claims, whoever made them (HON-838).
    expect(calls).toEqual([
      'lock SELECT 1 FROM "user" WHERE "id" = ? FOR NO KEY UPDATE ["user-1"]',
      'claim',
    ])
    expect(claim).toHaveBeenCalledWith(tx)
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    })
  })

  describe('concurrent claims', () => {
    /**
     * `$transaction` backed by an in-memory model of PostgreSQL row locks: the
     * `$queryRaw` lock waits while another open transaction holds the same
     * user's row, and every lock is released when its transaction ends.
     */
    function withRowLocks() {
      const held = new Map<unknown, Promise<void>>()
      mockTransaction.mockImplementation(async (callback: unknown) => {
        const releases: (() => void)[] = []
        const tx = {
          $queryRaw: async (_strings: TemplateStringsArray, userId: unknown) => {
            while (held.has(userId)) await held.get(userId)
            held.set(userId, new Promise<void>((resolve) => releases.push(resolve)))
            releases.push(() => held.delete(userId))
            return []
          },
        }
        try {
          return await (callback as (client: unknown) => Promise<unknown>)(tx)
        } finally {
          for (const release of releases.reverse()) release()
        }
      })
    }

    /** A claim that stays open until the test finishes it. */
    function openClaim(result: string) {
      let finish!: () => void
      const done = new Promise<void>((resolve) => (finish = resolve))
      const claim = vi.fn(async () => {
        await done
        return result
      })
      return { claim, finish }
    }

    it('lets two different users create a household at the same moment', async () => {
      withRowLocks()
      const first = openClaim('household-a')
      const second = openClaim('household-b')

      const results = Promise.all([
        runHouseholdClaim('user-a', first.claim),
        runHouseholdClaim('user-b', second.claim),
      ])
      await vi.advanceTimersByTimeAsync(0)

      // Both claims are inside their transactions at once: neither user waits
      // on the other's lock. Under `Serializable` one of these two failed on
      // every run (HON-838).
      expect(first.claim).toHaveBeenCalledTimes(1)
      expect(second.claim).toHaveBeenCalledTimes(1)

      second.finish()
      first.finish()
      await expect(results).resolves.toEqual(['household-a', 'household-b'])
      expect(mockTransaction).toHaveBeenCalledTimes(2)
    })

    it('makes a second claim for the same user wait for the first to finish', async () => {
      withRowLocks()
      const first = openClaim('household-a')
      const second = openClaim('already checked')

      const firstResult = runHouseholdClaim('user-a', first.claim)
      const secondResult = runHouseholdClaim('user-a', second.claim)
      await vi.advanceTimersByTimeAsync(0)

      // The second claim's membership check must not run until the first has
      // committed, or both see "no membership" and both write one (HON-679).
      expect(first.claim).toHaveBeenCalledTimes(1)
      expect(second.claim).not.toHaveBeenCalled()

      first.finish()
      await expect(firstResult).resolves.toBe('household-a')
      await vi.advanceTimersByTimeAsync(0)
      expect(second.claim).toHaveBeenCalledTimes(1)

      second.finish()
      await expect(secondResult).resolves.toBe('already checked')
    })
  })

  it('retries a serialization failure and returns the retry result', async () => {
    const claim = vi.fn()
    mockTransaction
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce('claimed on retry' as never)

    const result = runHouseholdClaim('user-1', claim)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('claimed on retry')
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget rather than spinning', async () => {
    const claim = vi.fn()
    mockTransaction.mockRejectedValue(serializationFailure())

    const assertion = expect(runHouseholdClaim('user-1', claim)).rejects.toMatchObject({
      code: 'P2034',
    })
    await vi.runAllTimersAsync()

    await assertion
    expect(mockTransaction).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS)
  })

  it('waits before retrying instead of re-entering the same contention window', async () => {
    const claim = vi.fn()
    // 0.5 of the [0, 50) ms window for the first wait.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    mockTransaction
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce('claimed on retry' as never)

    const result = runHouseholdClaim('user-1', claim)

    // Flush the first attempt's rejection without advancing the clock: the
    // retry must still be pending on the timer, not already in flight.
    await vi.advanceTimersByTimeAsync(0)
    expect(mockTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(24)
    expect(mockTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(mockTransaction).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toBe('claimed on retry')
  })

  it('jitters each wait over a window that grows per attempt', async () => {
    const claim = vi.fn()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    // Distinct draws, so a delay computed from a shared constant rather than
    // from Math.random would show up as identical arguments. Cycled rather
    // than `mockReturnValueOnce` twice, so raising MAX_CLAIM_ATTEMPTS does not
    // fall off the end of the mock and fail a test that has nothing to say
    // about the budget.
    let draw = 0
    vi.spyOn(Math, 'random').mockImplementation(() => jitterDraw(draw++))
    mockTransaction.mockRejectedValue(serializationFailure())

    const assertion = expect(runHouseholdClaim('user-1', claim)).rejects.toMatchObject({
      code: 'P2034',
    })
    await vi.runAllTimersAsync()
    await assertion

    // Full jitter over [0, 50), then [0, 100), …: the window doubles up to the
    // 400 ms ceiling, and the draw is uniform over the whole of it rather than
    // added to a fixed floor — two claims that lost to each other must not
    // retry in lockstep. The windows are restated here from literals rather
    // than imported, so a change to either constant has to be made twice.
    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms)
    expect(delays).toEqual(
      Array.from(
        { length: MAX_CLAIM_ATTEMPTS - 1 },
        (_, i) => jitterDraw(i) * Math.min(50 * 2 ** i, 400),
      ),
    )
    // MAX_CLAIM_ATTEMPTS attempts means one fewer wait — no sleep after the
    // last failure, which would only delay the 500.
    expect(delays).toHaveLength(MAX_CLAIM_ATTEMPTS - 1)
  })

  it('caps the jitter window, not the base delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    // Unreachable through runHouseholdClaim at MAX_CLAIM_ATTEMPTS = 3, which is
    // exactly why it is asserted here: the 50 ms and 100 ms windows both sit
    // under the ceiling, so no end-to-end test can distinguish a capped window
    // from `Math.min(RETRY_BASE_DELAY_MS, MAX_RETRY_DELAY_MS) * 2 ** (attempt - 1)`,
    // which caps the base and leaves the growth unbounded. At attempt 6 the
    // uncapped window would be 50 × 2**5 = 1600 ms.
    expect(backoffDelayMs(6)).toBe(0.5 * 400)

    // And it must not bind early: today's two waits are unaffected by it.
    expect(backoffDelayMs(1)).toBe(0.5 * 50)
    expect(backoffDelayMs(2)).toBe(0.5 * 100)
  })

  it('does not retry an error the claim threw deliberately', async () => {
    const sentinel = new Error('already_in_household')
    const claim = vi.fn()
    mockTransaction.mockRejectedValue(sentinel)

    await expect(runHouseholdClaim('user-1', claim)).rejects.toBe(sentinel)
    // Retrying a deliberate sentinel would turn a decided 400 into two more
    // round trips and, if the second attempt raced differently, a 500.
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not retry an unrelated Prisma error', async () => {
    const claim = vi.fn()
    const notFound = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    })
    mockTransaction.mockRejectedValue(notFound)

    await expect(runHouseholdClaim('user-1', claim)).rejects.toBe(notFound)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('isMembershipConflict', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' })

  it('recognises a unique-constraint violation', () => {
    expect(isMembershipConflict(knownError('P2002'))).toBe(true)
  })

  it('does not treat other errors as a membership conflict', () => {
    // A serialization failure is retried, not mapped; anything else is a 500.
    expect(isMembershipConflict(knownError('P2034'))).toBe(false)
    expect(isMembershipConflict(knownError('P2025'))).toBe(false)
    expect(isMembershipConflict(new Error('P2002'))).toBe(false)
    expect(isMembershipConflict(undefined)).toBe(false)
  })

  it('is not retried by runHouseholdClaim', async () => {
    const conflict = knownError('P2002')
    mockTransaction.mockRejectedValue(conflict)

    await expect(runHouseholdClaim('user-1', vi.fn())).rejects.toBe(conflict)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('inviteMembershipClaim', () => {
  const makeTx = () => ({
    $queryRaw: vi.fn().mockResolvedValue([]),
    householdMember: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    householdInvite: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  })

  it("locks the invite's household against a concurrent delete before claiming", async () => {
    const tx = makeTx()
    const order: string[] = []
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push(`lock ${strings.join('?')} ${JSON.stringify(values)}`)
      return []
    })
    tx.householdMember.updateMany.mockImplementation(async () => {
      order.push('claim')
      return { count: 1 }
    })

    await inviteMembershipClaim('user-1', 'member-1', 'invite-1')(tx as never)

    // A sole owner's leave takes FOR UPDATE on the same household row, so the
    // two serialise and the leave cannot delete the household under a claim
    // that is about to commit (HON-1133).
    expect(order).toHaveLength(2)
    expect(order[0]).toMatch(/FROM "household" h .* FOR KEY SHARE OF h/)
    expect(order[0]).toContain('["member-1"]')
    expect(order[1]).toBe('claim')
  })

  it('claims the unclaimed member row, then deletes the invite', async () => {
    const tx = makeTx()

    await inviteMembershipClaim('user-1', 'member-1', 'invite-1')(tx as never)

    expect(tx.householdMember.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(tx.householdMember.updateMany).toHaveBeenCalledWith({
      where: { id: 'member-1', userId: null },
      data: { userId: 'user-1' },
    })
    expect(tx.householdInvite.deleteMany).toHaveBeenCalledWith({ where: { id: 'invite-1' } })
  })

  it('refuses a user who already has a membership, before any write', async () => {
    const tx = makeTx()
    tx.householdMember.findFirst.mockResolvedValue({ id: 'member-9' })

    await expect(
      inviteMembershipClaim('user-1', 'member-1', 'invite-1')(tx as never),
    ).rejects.toBeInstanceOf(AlreadyInHouseholdError)
    expect(tx.householdMember.updateMany).not.toHaveBeenCalled()
  })

  it('signals a lost race when the member row was already claimed', async () => {
    const tx = makeTx()
    tx.householdMember.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      inviteMembershipClaim('user-1', 'member-1', 'invite-1')(tx as never),
    ).rejects.toBeInstanceOf(InviteNoLongerClaimableError)
    expect(tx.householdInvite.deleteMany).not.toHaveBeenCalled()
  })

  it('signals a lost race when the invite is already gone', async () => {
    const tx = makeTx()
    tx.householdInvite.deleteMany.mockResolvedValue({ count: 0 })

    await expect(
      inviteMembershipClaim('user-1', 'member-1', 'invite-1')(tx as never),
    ).rejects.toBeInstanceOf(InviteNoLongerClaimableError)
  })
})
