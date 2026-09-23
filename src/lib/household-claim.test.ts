import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import {
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

  it('runs the claim at Serializable isolation', async () => {
    const claim = vi.fn().mockResolvedValue('claimed')
    mockTransaction.mockImplementation((callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({}),
    )

    await expect(runHouseholdClaim(claim)).resolves.toBe('claimed')

    // The isolation level is the entire fix. At read committed the membership
    // check is a SELECT matching zero rows, so it takes no lock and two
    // concurrent claims write two different member rows without conflicting —
    // write skew, which only SSI's predicate locks catch (HON-679).
    expect(mockTransaction).toHaveBeenCalledWith(claim, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
  })

  it('retries a serialization failure and returns the retry result', async () => {
    const claim = vi.fn()
    mockTransaction
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce('claimed on retry' as never)

    const result = runHouseholdClaim(claim)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('claimed on retry')
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget rather than spinning', async () => {
    const claim = vi.fn()
    mockTransaction.mockRejectedValue(serializationFailure())

    const assertion = expect(runHouseholdClaim(claim)).rejects.toMatchObject({ code: 'P2034' })
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

    const result = runHouseholdClaim(claim)

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

    const assertion = expect(runHouseholdClaim(claim)).rejects.toMatchObject({ code: 'P2034' })
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

    await expect(runHouseholdClaim(claim)).rejects.toBe(sentinel)
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

    await expect(runHouseholdClaim(claim)).rejects.toBe(notFound)
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

    await expect(runHouseholdClaim(vi.fn())).rejects.toBe(conflict)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
