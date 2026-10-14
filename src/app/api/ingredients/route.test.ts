import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

// The queries and the ranking live in `@/lib/ingredients/search`, tested
// against a database in `search.db.test.ts` and as a pure merge in
// `search.test.ts`. This file mocks that module at the seam and asserts what
// the route owns: the session, the query string, the household and its
// locale, and the status and body (HON-1209).

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

vi.mock('@/lib/ingredients/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingredients/search')>()),
  searchIngredients: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { searchIngredients } from '@/lib/ingredients/search'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockSearch = vi.mocked(searchIngredients)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

function membershipWithLocale(locale: string) {
  return { householdId: 'household-123', household: { id: 'household-123', locale } } as never
}

const potato = {
  id: 'ing-potato',
  name: 'Potato',
  category: 'vegetable',
  defaultUnit: 'g',
  gramsPerPiece: 150,
  measuredByVolume: false,
  calories: 77,
  protein: 2,
  carbs: 17,
  fat: 0.1,
  similarity: 1,
} as const

const get = (query = '') => GET(new NextRequest(`http://localhost/api/ingredients${query}`))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membershipWithLocale('en'))
  mockSearch.mockResolvedValue([])
})

describe('GET /api/ingredients', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await get('?search=chicken')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it.each([
    ['no search', ''],
    ['a whitespace-only search', '?search=%20%20%20'],
  ])('returns an empty list for %s, without searching', async (_label, query) => {
    const response = await get(query)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ingredients: [] })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns what the search finds', async () => {
    mockSearch.mockResolvedValue([{ ...potato, matchedAs: 'spud' }])

    const response = await get('?search=potato')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ingredients: [{ ...potato, matchedAs: 'spud' }] })
  })

  it("searches the trimmed term in the caller's household, with the defaults", async () => {
    await get('?search=%20potato%20')

    expect(mockSearch).toHaveBeenCalledWith({
      search: 'potato',
      category: null,
      limit: 10,
      householdId: 'household-123',
      locale: 'en',
    })
  })

  it('passes the category through', async () => {
    await get('?search=flour&category=carb')

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ category: 'carb' }))
  })

  it.each([
    ['5', 5],
    ['0', 10],
    ['-3', 1],
    ['500', 50],
    ['abc', 10],
  ])('reads limit=%s as %i', async (limit, expected) => {
    await get(`?search=potato&limit=${limit}`)

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: expected }))
  })

  // HON-911: an Estonian household types the names it sees on screen.
  it("searches in the household's locale", async () => {
    mockGetMembership.mockResolvedValue(membershipWithLocale('et'))

    await get('?search=kartul')

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ locale: 'et' }))
  })

  it('reads an unknown household locale as English', async () => {
    mockGetMembership.mockResolvedValue(membershipWithLocale('xx'))

    await get('?search=potato')

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }))
  })

  // HON-889: with no household there is no own row to offer, so globals only.
  it('searches global ingredients only, in English, for a user with no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await get('?search=chicken')

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: null, locale: 'en' }),
    )
  })

  it('returns 500 and reports a failed search', async () => {
    mockSearch.mockRejectedValue(new Error('DB error'))

    const response = await get('?search=test')

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to search ingredients' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
