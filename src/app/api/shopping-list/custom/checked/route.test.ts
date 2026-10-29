import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE } from './route'

// The delete lives in `@/lib/shopping/custom-items`, tested against a database
// in `custom-items.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household and the status
// (HON-1208).

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

vi.mock('@/lib/shopping/custom-items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/custom-items')>()),
  clearCheckedCustomShoppingItems: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { clearCheckedCustomShoppingItems } from '@/lib/shopping/custom-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockClearChecked = vi.mocked(clearCheckedCustomShoppingItems)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const membership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'en' },
} as never

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
})

describe('DELETE /api/shopping-list/custom/checked', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(DELETE())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockClearChecked).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(DELETE())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockClearChecked).not.toHaveBeenCalled()
  })

  it("clears the household's checked items and returns how many", async () => {
    mockClearChecked.mockResolvedValue(4)

    expect(await answer(DELETE())).toEqual({
      status: 200,
      body: { success: true, deletedCount: 4 },
    })
    expect(mockClearChecked).toHaveBeenCalledWith('household-123')
  })

  it('returns a count of 0 when nothing was checked', async () => {
    mockClearChecked.mockResolvedValue(0)

    expect(await answer(DELETE())).toEqual({
      status: 200,
      body: { success: true, deletedCount: 0 },
    })
  })

  it('returns 500 and reports the error when the delete throws', async () => {
    const error = new Error('DB down')
    mockClearChecked.mockRejectedValue(error)

    expect(await answer(DELETE())).toEqual({
      status: 500,
      body: { error: 'Failed to delete checked items' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/shopping-list/custom/checked',
      userId: 'user-123',
      householdId: 'household-123',
    })
  })
})
