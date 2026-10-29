import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// The query lives in `@/lib/ingredients/manage` (`manage.db.test.ts`); this
// file asserts the session, the household and the body (HON-1264).

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

vi.mock('@/lib/ingredients/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingredients/manage')>()),
  listHouseholdIngredients: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'
import { listHouseholdIngredients } from '@/lib/ingredients/manage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockList = vi.mocked(listHouseholdIngredients)

const sorrel = {
  id: 'ing-sorrel',
  name: 'sorrel',
  category: 'vegetable',
  proteinType: null,
  defaultUnit: 'g',
  gramsPerPiece: null,
  allergens: [],
  calories: 22,
  protein: 2,
  carbs: 3,
  fat: 0.7,
  fiber: 3,
} satisfies HouseholdIngredient

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'user-123' }, session: {} } as never)
  mockGetMembership.mockResolvedValue({ householdId: 'household-123' } as never)
})

describe('GET /api/households/me/ingredients', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await GET()).status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 403 for a user with no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect((await GET()).status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns the caller's household rows", async () => {
    mockList.mockResolvedValue([sorrel])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ingredients: [sorrel] })
    expect(mockList).toHaveBeenCalledWith('household-123')
  })

  it('returns 500 and reports a failed read', async () => {
    mockList.mockRejectedValue(new Error('db down'))

    expect((await GET()).status).toBe(500)
    expect(vi.mocked(captureApiError)).toHaveBeenCalledTimes(1)
  })
})
