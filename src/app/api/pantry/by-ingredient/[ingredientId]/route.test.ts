import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'

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

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pantryItem: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindUnique = vi.mocked(prisma.pantryItem.findUnique)
const mockDelete = vi.mocked(prisma.pantryItem.delete)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: 'Test Household',
    timezone: 'Europe/Tallinn',
    preferences: null,
  },
}

function callDelete(ingredientId: string) {
  return DELETE(new Request(`http://localhost/api/pantry/by-ingredient/${ingredientId}`), {
    params: Promise.resolve({ ingredientId }),
  })
}

describe('DELETE /api/pantry/by-ingredient/[ingredientId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callDelete('ing-1')
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await callDelete('ing-1')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it("returns 404 when pantry item doesn't exist for caller's household", async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)

    const response = await callDelete('ing-1')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Pantry item not found')
    // Must use compound unique scoped to caller's household
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        householdId_ingredientId: {
          householdId: 'household-123',
          ingredientId: 'ing-1',
        },
      },
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes the pantry item and returns 204', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'pantry-1',
      householdId: 'household-123',
      ingredientId: 'ing-1',
    } as never)
    mockDelete.mockResolvedValue({} as never)

    const response = await callDelete('ing-1')

    expect(response.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'pantry-1' } })
  })

  it('returns 500 when Prisma throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'pantry-1',
      householdId: 'household-123',
      ingredientId: 'ing-1',
    } as never)
    mockDelete.mockRejectedValue(new Error('DB down'))

    const response = await callDelete('ing-1')
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to delete pantry item')
  })
})
