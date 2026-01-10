import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHouseholdForUser } from './auth'

// Mock the prisma module
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

describe('createHouseholdForUser', () => {
  const mockTx = {
    household: {
      create: vi.fn(),
    },
    householdMember: {
      create: vi.fn(),
    },
    householdPreferences: {
      create: vi.fn(),
    },
  }

  const mockDb = {
    $transaction: vi.fn((callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.household.create.mockResolvedValue({ id: 'household-123' })
    mockTx.householdMember.create.mockResolvedValue({ id: 'member-123' })
    mockTx.householdPreferences.create.mockResolvedValue({ id: 'prefs-123' })
  })

  it('creates household with correct name format', async () => {
    await createHouseholdForUser('user-123', 'John Doe', mockDb as never)

    expect(mockTx.household.create).toHaveBeenCalledWith({
      data: {
        name: "John Doe's Household",
      },
    })
  })

  it('creates household member with owner role', async () => {
    await createHouseholdForUser('user-123', 'John Doe', mockDb as never)

    expect(mockTx.householdMember.create).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        userId: 'user-123',
        role: 'owner',
      },
    })
  })

  it('creates household preferences with defaults', async () => {
    await createHouseholdForUser('user-123', 'John Doe', mockDb as never)

    expect(mockTx.householdPreferences.create).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
      },
    })
  })

  it('executes all operations in a transaction', async () => {
    await createHouseholdForUser('user-123', 'John Doe', mockDb as never)

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1)
    expect(mockTx.household.create).toHaveBeenCalledTimes(1)
    expect(mockTx.householdMember.create).toHaveBeenCalledTimes(1)
    expect(mockTx.householdPreferences.create).toHaveBeenCalledTimes(1)
  })

  it('handles user names with apostrophes correctly', async () => {
    await createHouseholdForUser('user-123', "O'Brien", mockDb as never)

    expect(mockTx.household.create).toHaveBeenCalledWith({
      data: {
        name: "O'Brien's Household",
      },
    })
  })
})
