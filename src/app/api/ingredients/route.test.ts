import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function createMockRequest(url: string = 'http://localhost/api/ingredients') {
  return new NextRequest(url)
}

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
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)
const mockGetMembership = vi.mocked(getHouseholdMembership)

/** The SQL text and interpolated values of the search's tagged-template call. */
function lastQuery() {
  const [strings, ...values] = mockQueryRaw.mock.lastCall as unknown as [
    TemplateStringsArray,
    ...unknown[],
  ]
  return { sql: strings.join('?'), values }
}

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

describe('GET /api/ingredients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMembership.mockResolvedValue({ householdId: 'household-123' } as never)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns empty array for empty search', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual([])
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('returns empty array for whitespace-only search', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=   '))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual([])
  })

  it('returns matching ingredients for search query', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockResolvedValue([
      {
        id: 'ing-1',
        name: 'Chicken breast',
        category: 'protein',
        defaultUnit: 'g',
        similarity: 0.8,
      },
      {
        id: 'ing-2',
        name: 'Chicken thigh',
        category: 'protein',
        defaultUnit: 'g',
        similarity: 0.6,
      },
    ] as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toHaveLength(2)
    expect(data.ingredients[0].name).toBe('Chicken breast')
    expect(data.ingredients[1].name).toBe('Chicken thigh')
  })

  // HON-889: the pickers feed the write routes, which reject another
  // household's ingredient, so the search must not offer one.
  it("scopes the search to global and the caller's household ingredients", async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockResolvedValue([] as never)

    await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))

    const { sql, values } = lastQuery()
    expect(sql).toMatch(/\("householdId" IS NULL OR "householdId" = \?::text\)/)
    expect(values).toContain('household-123')
  })

  it('searches global ingredients only for a user with no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([] as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))

    expect(response.status).toBe(200)
    const { sql, values } = lastQuery()
    expect(sql).toMatch(/\("householdId" IS NULL OR "householdId" = \?::text\)/)
    // `= NULL` matches no row, which leaves the `IS NULL` half: globals only.
    expect(values).toContain(null)
  })

  it('returns 500 when query fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockRejectedValue(new Error('DB error'))

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=test'))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to search ingredients')
  })
})
