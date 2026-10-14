import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The matching and the writes live in `@/lib/shopping/custom-items`, tested
// against a database in `custom-items.db.test.ts`. This file mocks that module
// at the seam and asserts what the route owns: the session, the household, the
// body, and the status each outcome maps to (HON-1208).

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
  addCustomShoppingItem: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { addCustomShoppingItem } from '@/lib/shopping/custom-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockAdd = vi.mocked(addCustomShoppingItem)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const household = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'et',
}

const membership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household,
} as never

const item = {
  id: 'custom-1',
  householdId: 'household-123',
  name: 'Salt',
  checked: false,
  ingredientId: 'ing-salt',
  createdAt: '2026-10-15T08:00:00.000Z',
  ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice' },
}

function post(body?: unknown, bodyString?: string) {
  return POST(
    new Request('http://localhost/api/shopping-list/custom', {
      method: 'POST',
      body: bodyString ?? (body !== undefined ? JSON.stringify(body) : undefined),
    }),
  )
}

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
})

describe('POST /api/shopping-list/custom', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ name: 'Salt' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(post({ name: 'Salt' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    expect(await answer(post(undefined, 'not valid json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['over 200 characters', 'x'.repeat(201)],
  ])('returns 400 with details when the name is %s', async (_label, name) => {
    const { status, body } = await answer(post({ name }))

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Validation failed', details: { name: [expect.any(String)] } })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 400 with details when the name is missing', async () => {
    const { status, body } = await answer(post({}))

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Validation failed', details: { name: [expect.any(String)] } })
  })

  it('adds the trimmed name for the household and returns 201 with the created item', async () => {
    mockAdd.mockResolvedValue({ status: 'created', item } as never)

    expect(await answer(post({ name: '  Salt  ' }))).toEqual({ status: 201, body: { item } })
    expect(mockAdd).toHaveBeenCalledWith(household, 'Salt')
  })

  it('returns 200 with the item when a checked item is reopened', async () => {
    mockAdd.mockResolvedValue({ status: 'reopened', item } as never)

    expect(await answer(post({ name: 'Salt' }))).toEqual({ status: 200, body: { item } })
  })

  it('returns 409 with the existing item when the name is on the list already', async () => {
    const existing = {
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
      createdAt: '2026-10-15T08:00:00.000Z',
    }
    mockAdd.mockResolvedValue({ status: 'exists', existing } as never)

    expect(await answer(post({ name: 'Salt' }))).toEqual({
      status: 409,
      body: { error: 'Item already exists', existing },
    })
  })

  it('returns 409 without an existing item when a concurrent add removed it again', async () => {
    mockAdd.mockResolvedValue({ status: 'exists', existing: null })

    expect(await answer(post({ name: 'Salt' }))).toEqual({
      status: 409,
      body: { error: 'Item already exists' },
    })
  })

  it('returns 500 and reports the error when adding throws', async () => {
    const error = new Error('DB down')
    mockAdd.mockRejectedValue(error)

    expect(await answer(post({ name: 'Salt' }))).toEqual({
      status: 500,
      body: { error: 'Failed to create item' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/shopping-list/custom',
      userId: 'user-123',
    })
  })
})
