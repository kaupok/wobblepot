import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE } from './route'

// The rules live in `@/lib/meal-plans/entry-changes` (`entry-changes.db.test.ts`);
// this file asserts the session, the household and the status mapping.

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

vi.mock('@/lib/meal-plans/entry-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-changes')>()),
  removeEntryChange: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { EntryChangeError, removeEntryChange } from '@/lib/meal-plans/entry-changes'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockRemove = vi.mocked(removeEntryChange)

const params = {
  params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1', componentId: 'change-1' }),
}
const del = () => DELETE(new Request('http://localhost/x', { method: 'DELETE' }), params)

describe('DELETE /api/meal-plans/[id]/entries/[entryId]/components/[componentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household: { id: 'household-1' } } as never)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await del()).status).toBe(401)
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('reverts the change for the household and returns the merged components', async () => {
    mockRemove.mockResolvedValue({ components: [] } as never)
    const response = await del()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ components: [] })
    expect(mockRemove).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', 'change-1')
  })

  it.each([
    ['notPlanned', 409],
    ['changeNotFound', 404],
    ['entryNotFound', 404],
  ] as const)('maps %s to %i', async (reason, status) => {
    mockRemove.mockRejectedValue(new EntryChangeError(reason))
    const response = await del()
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(reason)
  })

  it('reports an unexpected failure and returns 500', async () => {
    mockRemove.mockRejectedValue(new Error('boom'))
    expect((await del()).status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})
