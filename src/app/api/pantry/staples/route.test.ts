import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// `listPantryStaples` is tested against a database in
// `staple-ran-out.db.test.ts`; this file asserts what the route owns.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/pantry/staple-ran-out', () => ({
  listPantryStaples: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { listPantryStaples } from '@/lib/pantry/staple-ran-out'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockList = vi.mocked(listPantryStaples)

const household = { id: 'household-123', locale: 'et' }

async function answer() {
  const res = await GET()
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'user-123' } } as never)
  mockGetMembership.mockResolvedValue({ household } as never)
})

describe('GET /api/pantry/staples', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer()).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer()).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it("returns the household's staples", async () => {
    const staples = [{ id: 'pantry-milk', name: 'Piim', englishName: 'Milk', quantity: null }]
    mockList.mockResolvedValue(staples)

    expect(await answer()).toEqual({ status: 200, body: { staples } })
    expect(mockList).toHaveBeenCalledWith(household)
  })

  it('returns 500 and reports the error when the read throws', async () => {
    const error = new Error('DB down')
    mockList.mockRejectedValue(error)

    expect(await answer()).toEqual({ status: 500, body: { error: 'Failed to fetch staples' } })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/pantry/staples',
      userId: 'user-123',
    })
  })
})
