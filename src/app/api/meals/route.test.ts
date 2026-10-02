import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { GET } from './route'

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

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    favoriteMeal: {
      findMany: vi.fn(),
    },
    meal: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFavoriteFindMany = vi.mocked(prisma.favoriteMeal.findMany)
const mockMealCount = vi.mocked(prisma.meal.count)
const mockMealFindMany = vi.mocked(prisma.meal.findMany)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: 'Test Household',
    timezone: 'Europe/Tallinn',
    preferences: null,
  },
}

const mockMembershipWithPrefs = {
  ...mockMembership,
  household: {
    ...mockMembership.household,
    preferences: {
      allergensToAvoid: ['gluten'],
      excludedIngredientIds: ['ing-excluded'],
    },
  },
}

function sampleMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meal-1',
    name: 'Chicken stir fry',
    description: null,
    timeMinutes: 30,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: ['dinner'],
    householdId: null,
    components: [
      {
        ingredientId: 'ing-1',
        quantityPerServing: 150,
        isVague: false,
        originalPhrase: null,
        ingredient: {
          id: 'ing-1',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          gramsPerPiece: null,
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
        },
      },
    ],
    favoritedBy: [],
    ...overrides,
  }
}

function createRequest(url = 'http://localhost/api/meals') {
  return new NextRequest(url)
}

const mockEtMembership = {
  ...mockMembership,
  household: { ...mockMembership.household, locale: 'et' },
}

/** The fuzzy search's SQL text, with nested `Prisma.sql` fragments flattened in. */
function searchQuery() {
  const [strings, ...values] = mockQueryRaw.mock.calls[0] as unknown as [
    TemplateStringsArray,
    ...unknown[],
  ]
  const query = Prisma.sql(strings, ...values)
  return { sql: query.strings.join('?').replace(/\s+/g, ' '), values: query.values }
}

/** A meal row as the translated-order name query selects it. */
function nameRow(id: string, name: string, etName?: string) {
  return { id, name, translations: etName ? [{ locale: 'et', name: etName }] : [] }
}

describe('GET /api/meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns system + own household meals by default (source=all)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meals).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.hasMore).toBe(false)

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      OR: [{ householdId: null }, { householdId: 'household-123' }],
    })
  })

  it('carries the image fields the card tint reads (HON-746)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({
        imageUrl: 'https://blob/meal-1.png',
        imageStatus: 'ready',
        imageHue: 42,
        imagePromptVersion: 'v4',
      }),
    ] as never)

    const data = await (await GET(createRequest())).json()

    expect(data.meals[0]).toMatchObject({
      imageUrl: 'https://blob/meal-1.png',
      imageStatus: 'ready',
      imageHue: 42,
    })
    const select = mockMealFindMany.mock.calls[0]?.[0]?.select
    expect(select).toMatchObject({
      imageUrl: true,
      imageStatus: true,
      imageHue: true,
      imagePromptVersion: true,
    })
  })

  it('serializes an image at a stale prompt version as absent (HON-753)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({
        imageUrl: 'https://blob/meal-1.png',
        imageStatus: 'ready',
        imageHue: null,
        imagePromptVersion: 'v3',
      }),
    ] as never)

    const data = await (await GET(createRequest())).json()

    expect(data.meals[0]).toMatchObject({ imageUrl: null, imageStatus: 'none', imageHue: null })
  })

  it('applies source=system filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=system'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ householdId: null })
  })

  it('applies source=custom filter scoped to caller household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=custom'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ householdId: 'household-123' })
  })

  it('applies source=favorites filter using favorite meal ids', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFavoriteFindMany.mockResolvedValue([
      { mealId: 'meal-fav-1' },
      { mealId: 'meal-fav-2' },
    ] as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=favorites'))

    expect(mockFavoriteFindMany).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
      select: { mealId: true },
    })
    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ id: { in: ['meal-fav-1', 'meal-fav-2'] } })
  })

  it('applies mealType filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?mealType=dinner'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ suitableFor: { has: 'dinner' } })
  })

  it('applies proteinType and kidFriendly filters', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?proteinType=poultry&kidFriendly=true'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ primaryProteinType: 'poultry' })
    expect(whereArg.AND).toContainEqual({ kidFriendly: true })
  })

  it('applies allergen hard filter from household preferences', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembershipWithPrefs as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      NOT: {
        components: {
          some: { ingredient: { allergens: { hasSome: ['gluten'] } } },
        },
      },
    })
  })

  it('applies excluded ingredient hard filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembershipWithPrefs as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      NOT: {
        components: {
          some: { ingredientId: { in: ['ing-excluded'] } },
        },
      },
    })
  })

  it('runs fuzzy search and orders by similarity when search param is provided', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockQueryRaw.mockResolvedValue([
      { id: 'meal-b', similarity: 0.9 },
      { id: 'meal-a', similarity: 0.5 },
    ] as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({ id: 'meal-a', name: 'Apple chicken' }),
      sampleMeal({ id: 'meal-b', name: 'Barbecue chicken' }),
    ] as never)

    const response = await GET(createRequest('http://localhost/api/meals?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(200)
    // Returned meals should be reordered by similarity (meal-b first)
    expect(data.meals[0].id).toBe('meal-b')
    expect(data.meals[1].id).toBe('meal-a')

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ id: { in: ['meal-b', 'meal-a'] } })
  })

  it('computes nutrition per serving and formats components', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    // 150g chicken breast * 165 cal/100g = 247.5 → 248
    expect(data.meals[0].nutrition.calories).toBe(248)
    expect(data.meals[0].nutrition.protein).toBeGreaterThan(0)
    expect(data.meals[0].components[0].ingredient.name).toBe('Chicken breast')
  })

  it('converts piece-unit quantities to grams for nutrition', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({
        components: [
          {
            ingredientId: 'ing-eggs',
            quantityPerServing: 2,
            isVague: false,
            originalPhrase: null,
            ingredient: {
              id: 'ing-eggs',
              name: 'Eggs',
              category: 'protein',
              defaultUnit: 'piece',
              gramsPerPiece: 55,
              calories: 155,
              protein: 13,
              carbs: 1.1,
              fat: 11,
              allergens: ['eggs'],
            },
          },
        ],
      }),
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    // 2 eggs x 55 g = 110 g per serving; 155 kcal/100g -> 170.5 -> 171 (HON-713)
    expect(data.meals[0].nutrition).toEqual({ calories: 171, protein: 14, carbs: 1, fat: 12 })
  })

  it('marks isCustom and isFavorite correctly', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({ id: 'custom-m', householdId: 'household-123', favoritedBy: [{ id: 'fav-1' }] }),
      sampleMeal({ id: 'system-m', householdId: null, favoritedBy: [] }),
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(data.meals[0].isCustom).toBe(true)
    expect(data.meals[0].isFavorite).toBe(true)
    expect(data.meals[1].isCustom).toBe(false)
    expect(data.meals[1].isFavorite).toBe(false)
  })

  it('honors pagination (limit/offset) and hasMore', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(50)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest('http://localhost/api/meals?limit=10&offset=20'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.total).toBe(50)
    expect(data.hasMore).toBe(true)
    expect(mockMealFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }))
  })

  it('excludes deleted meals (deletedAt: null)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ deletedAt: null })
  })

  it('searches English names only, with no translation join, for an English household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockQueryRaw.mockResolvedValue([] as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?search=chicken'))

    const { sql } = searchQuery()
    expect(sql).not.toContain('_translation')
    expect(sql).toContain('similarity(m.name, ?) >= ? OR word_similarity(?, m.name) >= ?')
  })

  // HON-942: at 0.25 one shared first-letter trigram matched a 3-letter search,
  // so "oat" found every meal with onion. Pin the rule: substring, or from four
  // characters a fuzzy score of at least 0.5.
  describe('search matching rule', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockQueryRaw.mockResolvedValue([] as never)
      mockMealCount.mockResolvedValue(0)
      mockMealFindMany.mockResolvedValue([])
    })

    it('matches a name by substring or by a fuzzy score of at least 0.5', async () => {
      await GET(createRequest('http://localhost/api/meals?search=brocoli'))

      const { sql, values } = searchQuery()
      for (const name of ['m.name', 'i.name']) {
        expect(sql).toContain(
          `(${name} ILIKE ? OR similarity(${name}, ?) >= ? OR word_similarity(?, ${name}) >= ?)`,
        )
      }
      expect(values).toContain('%brocoli%')
      expect(values).toContain(0.5)
    })

    it('matches a search shorter than four characters by substring only', async () => {
      await GET(createRequest('http://localhost/api/meals?search=oat'))

      const { sql, values } = searchQuery()
      const where = sql.slice(sql.indexOf('FROM "meal" m'), sql.indexOf('ORDER BY'))
      expect(where).toContain('m.name ILIKE ?')
      expect(where).toContain('i.name ILIKE ?')
      expect(where).not.toContain('similarity')
      expect(values).toContain('%oat%')
    })

    // A one-letter substring search matches nearly every meal. Rows Prisma
    // filters out afterwards must not use up the cap, or the household's own
    // meals drop out and `total` comes back short.
    it("limits candidates to the household's visible, non-deleted meals under a cap of 500", async () => {
      await GET(createRequest('http://localhost/api/meals?search=e'))

      const { sql, values } = searchQuery()
      expect(sql).toContain(
        'WHERE m."deletedAt" IS NULL AND (m."householdId" IS NULL OR m."householdId" = ?) AND (',
      )
      expect(values).toContain(mockMembership.household.id)
      expect(sql).toMatch(/LIMIT \?\s*$/)
      expect(values.at(-1)).toBe(500)
    })

    it('ranks a substring match above every fuzzy match', async () => {
      await GET(createRequest('http://localhost/api/meals?search=oat'))

      const { sql } = searchQuery()
      for (const name of ['m.name', 'i.name']) {
        expect(sql).toContain(
          `GREATEST( CASE WHEN ${name} ILIKE ? THEN 1 + similarity(${name}, ?) END, similarity(${name}, ?), word_similarity(?, ${name}) )`,
        )
      }
    })
  })

  it('takes % and _ in the search literally in the substring match', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockQueryRaw.mockResolvedValue([] as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest(`http://localhost/api/meals?search=${encodeURIComponent('50%_\\')}`))

    expect(searchQuery().values).toContain('%50\\%\\_\\\\%')
  })

  // HON-911: an Estonian household searches and browses by the names it sees.
  describe('for a household on a non-default locale', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockEtMembership as never)
    })

    it("matches the meal's and its ingredients' translated names in search", async () => {
      mockQueryRaw.mockResolvedValue([{ id: 'meal-1', similarity: 1 }] as never)
      mockMealCount.mockResolvedValue(1)
      mockMealFindMany.mockResolvedValue([
        sampleMeal({ translations: [{ locale: 'et', name: 'Kanawokk' }] }),
      ] as never)

      const response = await GET(createRequest('http://localhost/api/meals?search=kanawokk'))
      const data = await response.json()

      const { sql, values } = searchQuery()
      expect(sql).toContain(
        'LEFT JOIN "meal_translation" mt ON mt."mealId" = m.id AND mt.locale = ?',
      )
      expect(sql).toContain(
        'LEFT JOIN "ingredient_translation" it ON it."ingredientId" = i.id AND it.locale = ?',
      )
      expect(sql).toContain('similarity(mt.name, ?) >= ? OR word_similarity(?, mt.name) >= ?')
      expect(sql).toContain('similarity(it.name, ?) >= ? OR word_similarity(?, it.name) >= ?')
      expect(values).toContain('et')
      expect(values).toContain('kanawokk')
      expect(data.meals[0].name).toBe('Kanawokk')
    })

    it('orders the alphabetical list by the Estonian names in Estonian order', async () => {
      mockMealCount.mockResolvedValue(4)
      // First call: the id/name pass that picks the page. In English order
      // "Apple pie" would come first.
      mockMealFindMany.mockResolvedValueOnce([
        nameRow('meal-apple', 'Apple pie', 'Õunakook'),
        nameRow('meal-salmon', 'Salmon', 'Lõhe'),
        nameRow('meal-zucchini', 'Zucchini fritters', 'Suvikõrvitsapannkoogid'),
        // A household meal has no translation and sorts by its own name
        nameRow('meal-custom', 'Chicken wok'),
      ] as never)
      // Second call: the full rows for the page, in arbitrary database order.
      mockMealFindMany.mockResolvedValueOnce([
        sampleMeal({ id: 'meal-apple', translations: [{ locale: 'et', name: 'Õunakook' }] }),
        sampleMeal({
          id: 'meal-zucchini',
          translations: [{ locale: 'et', name: 'Suvikõrvitsapannkoogid' }],
        }),
      ] as never)

      // Estonian order is Chicken wok, Lõhe, Suvikõrvitsapannkoogid, Õunakook
      // (õ sorts after w), so the page at offset 2 is the last two.
      const response = await GET(createRequest('http://localhost/api/meals?limit=2&offset=2'))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.meals.map((m: { name: string }) => m.name)).toEqual([
        'Suvikõrvitsapannkoogid',
        'Õunakook',
      ])
      expect(data.total).toBe(4)
      expect(data.hasMore).toBe(false)

      const namePass = mockMealFindMany.mock.calls[0]?.[0]
      expect(namePass?.select).toMatchObject({
        id: true,
        name: true,
        translations: { where: { locale: 'et' } },
      })
      const pageFetch = mockMealFindMany.mock.calls[1]?.[0]
      expect(pageFetch?.where).toEqual({
        AND: [namePass?.where, { id: { in: ['meal-zucchini', 'meal-apple'] } }],
      })
      expect(pageFetch).toMatchObject({ skip: 0, take: undefined })
      expect(pageFetch?.orderBy).toBeUndefined()
    })
  })

  it('returns 500 when Prisma throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockRejectedValue(new Error('DB down'))

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch meals')
  })
})
