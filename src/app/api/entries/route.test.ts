import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

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

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

// The read and the payload live in `loadPlanEntries`, tested in
// `load-plan-entries.test.ts`. This file asserts what the route owns: the
// session, the household, query validation and the status (HON-1206).
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({
  loadPlanEntries: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadPlanEntries = vi.mocked(loadPlanEntries)

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
    // Read to tell which cached tips still fit the entry (HON-1040).
    _count: { members: 2 },
    members: [{ preferences: null }, { preferences: null }],
  },
}

function createRequest(
  url = 'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09',
) {
  return new NextRequest(url)
}

describe('GET /api/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 when startDate is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(createRequest('http://localhost/api/entries?endDate=2026-02-09'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('startDate and endDate')
  })

  it('returns 400 when endDate is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(createRequest('http://localhost/api/entries?startDate=2026-02-02'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('startDate and endDate')
  })

  it('returns 400 for invalid date format', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(
      createRequest('http://localhost/api/entries?startDate=not-a-date&endDate=2026-02-09'),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid date format. Use YYYY-MM-DD.')
  })

  it('returns 400 for invalid status value', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(
      createRequest(
        'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09&status=bogus',
      ),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid status value')
  })

  it("loads the household's entries for the local-day range", async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const result = { planId: 'plan-1', entries: [{ id: 'entry-1' }] }
    mockLoadPlanEntries.mockResolvedValue(result as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(mockLoadPlanEntries).toHaveBeenCalledWith(mockMembership.household, {
      startDate: new Date(2026, 1, 2),
      endDate: new Date(2026, 1, 9),
      status: undefined,
    })
  })

  it('passes the status filter through', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockLoadPlanEntries.mockResolvedValue({ planId: null, entries: [] } as never)

    await GET(
      createRequest(
        'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09&status=planned',
      ),
    )

    expect(mockLoadPlanEntries).toHaveBeenCalledWith(
      mockMembership.household,
      expect.objectContaining({ status: 'planned' }),
    )
  })

  it('reports a failed read and returns 500', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const failure = new Error('DB down')
    mockLoadPlanEntries.mockRejectedValue(failure)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch entries')
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/entries',
      userId: 'user-123',
      householdId: 'household-123',
    })
  })
})
