import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, PATCH } from './route'

// Every query lives in `@/lib/day-extras/day-extras`, tested against a
// database in `day-extras.db.test.ts`. This file asserts what the route owns
// (HON-1309).

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

vi.mock('@/lib/day-extras/day-extras', () => ({
  updateDayExtraQuantity: vi.fn(),
  deleteDayExtra: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { deleteDayExtra, updateDayExtraQuantity } from '@/lib/day-extras/day-extras'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUpdate = vi.mocked(updateDayExtraQuantity)
const mockDelete = vi.mocked(deleteDayExtra)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockHousehold = { id: 'household-123', name: 'Test', locale: 'en', timezone: 'UTC' }

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
} as never

const URL = 'http://localhost/api/extras/extra-1'
const params = () => Promise.resolve({ id: 'extra-1' })

const patch = (body: unknown) =>
  PATCH(
    new Request(URL, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: params() },
  )
const del = () => DELETE(new Request(URL, { method: 'DELETE' }), { params: params() })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('PATCH /api/extras/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await patch({ quantity: 2 })).status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty body', {}],
    ['a negative amount', { quantity: -1 }],
    ['an amount that is not a number', { quantity: '2' }],
    ['an unknown key', { quantity: 2, label: 'chips' }],
  ])('returns 400 for %s', async (_label, body) => {
    const response = await patch(body)

    expect(response.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when the household has no such extra', async () => {
    mockUpdate.mockResolvedValue({ status: 'not_found' })

    const response = await patch({ quantity: 2 })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Extra not found' })
  })

  it('returns 400 for an amount on free text', async () => {
    mockUpdate.mockResolvedValue({ status: 'free_text' })

    expect((await patch({ quantity: 2 })).status).toBe(400)
  })

  it.each([
    ['an amount', 1500],
    ['no amount', null],
  ])('passes %s to the update and returns the extra', async (_label, quantity) => {
    const extra = {
      id: 'extra-1',
      date: '2026-10-17',
      ingredientId: 'ing-wine',
      name: 'Red wine',
      quantity,
      unit: 'ml' as const,
    }
    mockUpdate.mockResolvedValue({ status: 'updated', extra })

    const response = await patch({ quantity })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(extra)
    expect(mockUpdate).toHaveBeenCalledWith(mockHousehold, 'extra-1', quantity)
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'))

    const response = await patch({ quantity: 2 })

    expect(response.status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/extras/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await del()).status).toBe(401)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect((await del()).status).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when the household has no such extra', async () => {
    mockDelete.mockResolvedValue({ status: 'not_found' })

    expect((await del()).status).toBe(404)
  })

  it("deletes the extra in the caller's household", async () => {
    mockDelete.mockResolvedValue({ status: 'deleted' })

    const response = await del()

    expect(response.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('household-123', 'extra-1')
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockDelete.mockRejectedValue(new Error('db down'))

    expect((await del()).status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
