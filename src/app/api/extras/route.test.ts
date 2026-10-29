import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// Every query lives in `@/lib/day-extras/day-extras`, tested against a
// database in `day-extras.db.test.ts`. This file mocks that module at the seam
// and asserts what the route owns: the session, the household, body
// validation, and the status each outcome maps to (HON-1309).

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
  createDayExtra: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { createDayExtra } from '@/lib/day-extras/day-extras'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreate = vi.mocked(createDayExtra)

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

const wine = {
  id: 'extra-1',
  date: '2026-10-17',
  ingredientId: 'ing-wine',
  name: 'Red wine',
  quantity: 750,
  unit: 'ml' as const,
}

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/extras', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('POST /api/extras', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await post({ date: '2026-10-17', label: 'chips' })

    expect(response.status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await post('not json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
  })

  it.each([
    ['no date', { label: 'chips' }],
    ['a date in another format', { date: '17.10.2026', label: 'chips' }],
    ['neither ingredient nor label', { date: '2026-10-17' }],
    ['both ingredient and label', { date: '2026-10-17', ingredientId: 'ing-wine', label: 'wine' }],
    ['an amount on free text', { date: '2026-10-17', label: 'chips', quantity: 2 }],
    ['a zero amount', { date: '2026-10-17', ingredientId: 'ing-wine', quantity: 0 }],
    ['a blank label', { date: '2026-10-17', label: '   ' }],
    ['a label over 80 characters', { date: '2026-10-17', label: 'x'.repeat(81) }],
  ])('returns 400 for %s and writes nothing', async (_label, body) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Validation failed')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await post({ date: '2026-10-17', label: 'chips' })

    expect(response.status).toBe(404)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 with the past_date code for a past day', async () => {
    mockCreate.mockResolvedValue({ status: 'past_date' })

    const response = await post({ date: '2020-01-01', label: 'chips' })

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('past_date')
  })

  it('returns 404 for an ingredient the household cannot use', async () => {
    mockCreate.mockResolvedValue({ status: 'ingredient_not_found' })

    const response = await post({ date: '2026-10-17', ingredientId: 'ing-other' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Ingredient not found' })
  })

  it("creates the extra in the caller's household and returns it", async () => {
    mockCreate.mockResolvedValue({ status: 'created', extra: wine })

    const response = await post({ date: '2026-10-17', ingredientId: 'ing-wine', quantity: 750 })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(wine)
    expect(mockCreate).toHaveBeenCalledWith(mockHousehold, {
      date: '2026-10-17',
      ingredientId: 'ing-wine',
      quantity: 750,
    })
  })

  it('trims a free-text label', async () => {
    mockCreate.mockResolvedValue({ status: 'created', extra: { ...wine, name: 'chips' } })

    await post({ date: '2026-10-17', label: '  chips ' })

    expect(mockCreate).toHaveBeenCalledWith(mockHousehold, { date: '2026-10-17', label: 'chips' })
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockCreate.mockRejectedValue(new Error('db down'))

    const response = await post({ date: '2026-10-17', label: 'chips' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to add extra' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
