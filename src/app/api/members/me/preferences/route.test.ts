import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'

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
    householdMember: {
      findFirst: vi.fn(),
    },
    memberPreferences: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindUnique = vi.mocked(prisma.memberPreferences.findUnique)
const mockCreate = vi.mocked(prisma.memberPreferences.create)
const mockUpsert = vi.mocked(prisma.memberPreferences.upsert)

const mockMemberPreferences = {
  id: 'member-prefs-123',
  memberId: 'member-123',
  displayName: 'Dad',
  portionMultiplier: 1.0,
  targetCalories: null,
  targetProtein: null,
  targetCarbs: null,
  targetFat: null,
  dietaryType: null,
  restrictions: [],
  excludedIngredients: [],
  excludedIngredientIds: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: "John Doe's Household",
    timezone: 'Europe/Tallinn',
    createdAt: new Date('2024-01-01'),
    preferences: {},
  },
}

describe('GET /api/members/me/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns existing preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(mockMemberPreferences as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('member-prefs-123')
    expect(data.displayName).toBe('Dad')
    expect(data.portionMultiplier).toBe(1.0)
  })

  it('auto-creates default preferences if none exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue(mockMemberPreferences as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith({
      data: { memberId: 'member-123' },
    })
    expect(data.id).toBe('member-prefs-123')
  })
})

describe('PATCH /api/members/me/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: object) =>
    new Request('http://localhost/api/members/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await PATCH(createRequest({ portionMultiplier: 1.5 }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 on invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/members/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{',
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 on portionMultiplier too low', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ portionMultiplier: 0.1 }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.portionMultiplier).toBeDefined()
  })

  it('returns 400 on portionMultiplier too high', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ portionMultiplier: 5.0 }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.portionMultiplier).toBeDefined()
  })

  it('returns 400 on invalid dietary type', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ dietaryType: 'invalid-type' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.dietaryType).toBeDefined()
  })

  it('returns 400 on displayName too long', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ displayName: 'a'.repeat(51) }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.displayName).toBeDefined()
  })

  it('returns 400 on empty displayName', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ displayName: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.displayName).toBeDefined()
  })

  it('returns 400 on targetCalories out of range', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ targetCalories: 100 }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.targetCalories).toBeDefined()
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const response = await PATCH(createRequest({ portionMultiplier: 1.5 }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('updates single field successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = { ...mockMemberPreferences, portionMultiplier: 1.5 }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ portionMultiplier: 1.5 }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.portionMultiplier).toBe(1.5)
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { memberId: 'member-123' },
      create: {
        memberId: 'member-123',
        portionMultiplier: 1.5,
      },
      update: { portionMultiplier: 1.5 },
    })
  })

  it('updates multiple fields successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = {
      ...mockMemberPreferences,
      displayName: 'Mom',
      portionMultiplier: 0.8,
      dietaryType: 'vegetarian',
      targetCalories: 1800,
    }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(
      createRequest({
        displayName: 'Mom',
        portionMultiplier: 0.8,
        dietaryType: 'vegetarian',
        targetCalories: 1800,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.displayName).toBe('Mom')
    expect(data.portionMultiplier).toBe(0.8)
    expect(data.dietaryType).toBe('vegetarian')
    expect(data.targetCalories).toBe(1800)
  })

  it('handles nullable dietaryType', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = { ...mockMemberPreferences, dietaryType: null }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ dietaryType: null }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.dietaryType).toBeNull()
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { memberId: 'member-123' },
      create: {
        memberId: 'member-123',
        dietaryType: null,
      },
      update: { dietaryType: null },
    })
  })

  it('handles nullable targetCalories', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = { ...mockMemberPreferences, targetCalories: null }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ targetCalories: null }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.targetCalories).toBeNull()
  })

  it('updates restrictions array successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = {
      ...mockMemberPreferences,
      restrictions: ['low sodium', 'high protein'],
    }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ restrictions: ['low sodium', 'high protein'] }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.restrictions).toEqual(['low sodium', 'high protein'])
  })

  it('updates excludedIngredients array successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = {
      ...mockMemberPreferences,
      excludedIngredients: ['olives', 'anchovies'],
    }
    mockUpsert.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ excludedIngredients: ['olives', 'anchovies'] }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.excludedIngredients).toEqual(['olives', 'anchovies'])
  })
})
