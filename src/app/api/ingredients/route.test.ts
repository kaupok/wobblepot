import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
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

/**
 * The SQL text and interpolated values of the search's tagged-template call,
 * with nested `Prisma.sql` fragments flattened in.
 */
function lastQuery() {
  return queryAt(mockQueryRaw.mock.calls.length - 1)
}

/** The same as `lastQuery`, for the `index`-th `$queryRaw` call. */
function queryAt(index: number) {
  const [strings, ...values] = mockQueryRaw.mock.calls[index] as unknown as [
    TemplateStringsArray,
    ...unknown[],
  ]
  const query = Prisma.sql(strings, ...values)
  return { sql: query.strings.join('?'), values: query.values }
}

function membershipWithLocale(locale: string) {
  return { householdId: 'household-123', household: { locale } } as never
}

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

describe('GET /api/ingredients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMembership.mockResolvedValue(membershipWithLocale('en'))
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
    expect(sql).toMatch(/\(i\."householdId" IS NULL OR i\."householdId" = \?::text\)/)
    expect(values).toContain('household-123')
  })

  it('searches global ingredients only for a user with no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([] as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))

    expect(response.status).toBe(200)
    const { sql, values } = lastQuery()
    expect(sql).toMatch(/\(i\."householdId" IS NULL OR i\."householdId" = \?::text\)/)
    // `= NULL` matches no row, which leaves the `IS NULL` half: globals only.
    expect(values).toContain(null)
  })

  // HON-911: an Estonian household types the names it sees on screen.
  describe('for a household on a non-default locale', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(membershipWithLocale('et'))
    })

    it("matches the household's translated name as well as the English one", async () => {
      mockQueryRaw.mockResolvedValue([] as never)

      await GET(createMockRequest('http://localhost/api/ingredients?search=kartul'))

      const { sql, values } = lastQuery()
      expect(sql).toContain(
        'LEFT JOIN "ingredient_translation" t ON t."ingredientId" = i.id AND t.locale = ?',
      )
      expect(sql).toContain(
        'WHERE GREATEST(similarity(i.name, ?), COALESCE(similarity(t.name, ?), 0)) >= ?',
      )
      expect(values).toContain('et')
      expect(values).toContain('kartul')
      // HON-889 scoping still applies
      expect(sql).toMatch(/\(i\."householdId" IS NULL OR i\."householdId" = \?::text\)/)
      expect(values).toContain('household-123')
    })

    it('returns the translated name for display, falling back to English', async () => {
      mockQueryRaw.mockResolvedValue([
        { id: 'ing-potato', name: 'Kartul', category: 'produce', defaultUnit: 'g', similarity: 1 },
      ] as never)

      const response = await GET(
        createMockRequest('http://localhost/api/ingredients?search=kartul'),
      )
      const data = await response.json()

      expect(lastQuery().sql).toMatch(/COALESCE\(t\.name, i\.name\) as name/)
      expect(data.ingredients).toEqual([
        expect.objectContaining({ id: 'ing-potato', name: 'Kartul' }),
      ])
    })

    it('ignores an unknown household locale and searches English names only', async () => {
      mockGetMembership.mockResolvedValue(membershipWithLocale('xx'))
      mockQueryRaw.mockResolvedValue([] as never)

      await GET(createMockRequest('http://localhost/api/ingredients?search=potato'))

      expect(lastQuery().sql).not.toContain('ingredient_translation')
    })
  })

  it('searches English names without a translation join for an English household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockResolvedValue([] as never)

    await GET(createMockRequest('http://localhost/api/ingredients?search=potato'))

    const { sql } = lastQuery()
    expect(sql).not.toContain('ingredient_translation')
    expect(sql).toContain('WHERE similarity(i.name, ?) >= ?')
    expect(sql).toMatch(/i\.name as name/)
  })

  // HON-1100: a household that types another English name finds the row.
  describe('by another English name', () => {
    const flour = {
      id: 'ing-flour',
      name: 'all-purpose flour',
      poolName: 'all-purpose flour',
      category: 'carb',
      defaultUnit: 'g',
    }

    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
    })

    async function search(query: string) {
      const response = await GET(createMockRequest(`http://localhost/api/ingredients?${query}`))
      return { status: response.status, data: await response.json() }
    }

    it('returns the row with matchedAs for a synonym prefix', async () => {
      mockQueryRaw.mockResolvedValueOnce([] as never).mockResolvedValueOnce([flour] as never)

      const { status, data } = await search('search=plain%20fl')

      expect(status).toBe(200)
      expect(data.ingredients).toEqual([
        {
          id: 'ing-flour',
          name: 'all-purpose flour',
          category: 'carb',
          defaultUnit: 'g',
          similarity: 0.9,
          matchedAs: 'plain flour',
        },
      ])
      const { sql, values } = queryAt(1)
      expect(sql).toContain('WHERE i.name IN (?)')
      expect(sql).toContain('i."householdId" IS NULL')
      expect(values).toContain('all-purpose flour')
    })

    it('returns a row found by its own name without matchedAs', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { ...flour, poolName: undefined, similarity: 0.6 },
      ] as never)

      const { data } = await search('search=all-purpose')

      // "all-purpose" is no synonym key, so only the name search runs.
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)
      expect(data.ingredients).toHaveLength(1)
      expect(data.ingredients[0]).not.toHaveProperty('matchedAs')
    })

    it('runs no synonym search for a two-letter term', async () => {
      mockQueryRaw.mockResolvedValue([] as never)

      await search('search=pl')

      expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    })

    it('lists a row found both ways once, without matchedAs', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([
          {
            id: 'ing-flour',
            name: 'all-purpose flour',
            category: 'carb',
            defaultUnit: 'g',
            similarity: 0.35,
          },
        ] as never)
        .mockResolvedValueOnce([flour] as never)

      const { data } = await search('search=flour')

      expect(data.ingredients).toHaveLength(1)
      expect(data.ingredients[0]).toEqual(
        expect.objectContaining({ id: 'ing-flour', similarity: 0.35 }),
      )
      expect(data.ingredients[0]).not.toHaveProperty('matchedAs')
    })

    it('applies the category filter to the synonym search', async () => {
      mockQueryRaw.mockResolvedValue([] as never)

      await search('search=plain%20fl&category=carb')

      const { sql, values } = queryAt(1)
      expect(sql).toContain('AND i.category = ?::"IngredientCategory"')
      expect(values).toContain('carb')
    })

    it('ranks a synonym that starts with the term above partial name hits and holds the limit', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([
          {
            id: 'ing-a',
            name: 'pepper a',
            category: 'vegetable',
            defaultUnit: 'g',
            similarity: 0.5,
          },
          {
            id: 'ing-b',
            name: 'pepper b',
            category: 'vegetable',
            defaultUnit: 'g',
            similarity: 0.4,
          },
        ] as never)
        .mockResolvedValueOnce([
          {
            ...flour,
            id: 'ing-red',
            name: 'red bell pepper',
            poolName: 'red bell pepper',
            similarity: 0.2,
          },
        ] as never)

      const { data } = await search('search=red%20pep&limit=2')

      expect(data.ingredients.map((i: { id: string }) => i.id)).toEqual(['ing-red', 'ing-a'])
      expect(data.ingredients[0]).toEqual(
        expect.objectContaining({ similarity: 0.9, matchedAs: 'red pepper' }),
      )
    })

    // "pepper" only starts a later word of "red pepper": a generic word, so the
    // row keeps its own name score rather than jumping to the top.
    it('keeps the name score for a synonym whose later word starts with the term', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([
          {
            id: 'ing-bell',
            name: 'bell pepper',
            category: 'vegetable',
            defaultUnit: 'g',
            similarity: 0.58,
          },
          {
            id: 'ing-black',
            name: 'black pepper',
            category: 'spice',
            defaultUnit: 'g',
            similarity: 0.54,
          },
        ] as never)
        .mockResolvedValueOnce([
          {
            ...flour,
            id: 'ing-red',
            name: 'red bell pepper',
            poolName: 'red bell pepper',
            similarity: 0.44,
          },
          {
            ...flour,
            id: 'ing-bell',
            name: 'bell pepper',
            poolName: 'bell pepper',
            similarity: 0.58,
          },
        ] as never)

      const { data } = await search('search=pepper&limit=3')

      expect(data.ingredients).toEqual([
        expect.objectContaining({ id: 'ing-bell', similarity: 0.58 }),
        expect.objectContaining({ id: 'ing-black', similarity: 0.54 }),
        expect.objectContaining({ id: 'ing-red', similarity: 0.44, matchedAs: 'red pepper' }),
      ])
      expect(data.ingredients[0]).not.toHaveProperty('matchedAs')
      expect(queryAt(1).sql).toMatch(/similarity\(i\.name, \?\) as similarity/)
    })

    it('returns the Estonian display name with the English synonym', async () => {
      mockGetMembership.mockResolvedValue(membershipWithLocale('et'))
      mockQueryRaw
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{ ...flour, name: 'nisujahu' }] as never)

      const { data } = await search('search=plain%20flour')

      expect(data.ingredients[0]).toEqual(
        expect.objectContaining({ name: 'nisujahu', matchedAs: 'plain flour' }),
      )
      const { sql } = queryAt(1)
      expect(sql).toContain('LEFT JOIN "ingredient_translation" t')
      expect(sql).toContain('COALESCE(t.name, i.name) as name')
    })
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
