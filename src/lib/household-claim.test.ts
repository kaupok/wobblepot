import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { runHouseholdClaim, MAX_CLAIM_ATTEMPTS } from './household-claim'

const mockTransaction = vi.mocked(prisma.$transaction)

const serializationFailure = () =>
  new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: 'test',
  })

describe('runHouseholdClaim', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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

    await expect(runHouseholdClaim(claim)).resolves.toBe('claimed on retry')
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt budget rather than spinning', async () => {
    const claim = vi.fn()
    mockTransaction.mockRejectedValue(serializationFailure())

    await expect(runHouseholdClaim(claim)).rejects.toMatchObject({ code: 'P2034' })
    expect(mockTransaction).toHaveBeenCalledTimes(MAX_CLAIM_ATTEMPTS)
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
