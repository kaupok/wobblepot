import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function createMockRequest(url: string = 'http://localhost/api/shopping-list') {
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
    householdMember: {
      findFirst: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
    },
    customShoppingItem: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/meal-planning/shopping-list', () => ({
  computeRollingWindowShoppingList: vi.fn(),
}))

// Mocked only to prove the route never calls it: the locale comes from the
// household already in hand (HON-921).
vi.mock('@/lib/i18n/get-locale', () => ({
  getLocale: vi.fn(() => Promise.resolve('en')),
}))

import { getLocale } from '@/lib/i18n/get-locale'
const mockGetLocale = vi.mocked(getLocale)

// Enum labels (vague phrases, the piece unit) resolve against the real catalog
// of the requested locale so the test sees the rendered label; every other
// namespace returns the key.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  const enMessages = (await import('../../../../messages/en.json')).default
  const etMessages = (await import('../../../../messages/et.json')).default
  return {
    getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) =>
      namespace.startsWith('enums.')
        ? createTranslator({
            locale,
            messages: (locale === 'et' ? etMessages : enMessages) as never,
            namespace: namespace as never,
          })
        : (key: string) => key,
    ),
  }
})

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeRollingWindowShoppingList } from '@/lib/meal-planning/shopping-list'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockPantryFindMany = vi.mocked(prisma.pantryItem.findMany)
const mockCustomItemsFindMany = vi.mocked(prisma.customShoppingItem.findMany)
const mockComputeShoppingList = vi.mocked(computeRollingWindowShoppingList)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
}

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

describe('GET /api/shopping-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no custom items
    mockCustomItemsFindMany.mockResolvedValue([])
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid days parameter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const response = await GET(createMockRequest('http://localhost/api/shopping-list?days=3'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid days parameter. Must be 7 or 14.')
  })

  it('returns empty groups when no planned meals', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: null,
      hasAnyPlan: false,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups).toEqual([])
    expect(data.windowDays).toBe(7)
    expect(data.summary.totalItems).toBe(0)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(0)
    expect(data.generatedAt).toBeNull()
    expect(data.hasAnyPlan).toBe(false)
  })

  // HON-653: entries only past the window leave `generatedAt` null, which must
  // not read as "no plan" — `hasAnyPlan` carries that answer separately.
  it('reports hasAnyPlan independently of generatedAt when the window is empty', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: null,
      hasAnyPlan: true,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.generatedAt).toBeNull()
    expect(data.hasAnyPlan).toBe(true)
  })

  it('returns formatted shopping list with purchase status', async () => {
    const neededDate = new Date('2026-02-01')
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-1',
              ingredient: {
                id: 'ing-1',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                measuredByVolume: false,
                gramsPerPiece: null,
              },
              neededQuantity: 600,
              pantryQuantity: null,
              shoppingQuantity: 600,
              mealCount: 2,
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: new Date('2026-01-30'),
      hasAnyPlan: true,
    })
    // No pantry items — item should not be purchased
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].category).toBe('protein')
    expect(data.groups[0].items).toHaveLength(1)

    const item = data.groups[0].items[0]
    expect(item.name).toBe('Chicken breast')
    expect(item.quantity).toBe(600)
    expect(item.displayQuantity).toBe('600g')
    expect(item.mealCount).toBe(2)
    expect(item.purchased).toBe(false)
    expect(item.neededByDate).toBe('2026-02-01')

    expect(data.summary.totalItems).toBe(1)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(1)
  })

  // HON-762: `dueToday` drives the warning colour on the due label, so it must
  // agree with `neededByRelative` in the household's timezone — here 21:00 on
  // Feb 1 in New York, already Feb 2 on a UTC server. Relies on the unit
  // project's UTC runtime (`vitest.config.ts`, HON-772).
  it('computes dueToday against the household day, in step with neededByRelative', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-02T02:00:00Z'))
    try {
      const ingredient = (id: string) => ({
        id,
        name: id,
        category: 'protein' as const,
        defaultUnit: 'g' as const,
        measuredByVolume: false,
        gramsPerPiece: null,
      })
      const row = (id: string, date: string) => ({
        ingredientId: id,
        ingredient: ingredient(id),
        neededQuantity: 100,
        pantryQuantity: null,
        shoppingQuantity: 100,
        mealCount: 1,
        earliestNeededDate: new Date(date),
        isVague: false,
        originalPhrase: null,
      })
      mockGetSession.mockResolvedValue(mockSession as never)
      mockFindFirst.mockResolvedValue({
        ...mockMembership,
        household: { ...mockHousehold, timezone: 'America/New_York' },
      } as never)
      mockComputeShoppingList.mockResolvedValue({
        groups: [
          {
            category: 'protein',
            categoryLabel: 'Proteins',
            items: [row('today-item', '2026-02-01'), row('tomorrow-item', '2026-02-02')],
          },
        ],
        startDate: '2026-02-01',
        endDate: '2026-02-07',
        windowDays: 7,
        earliestPlanCreatedAt: new Date('2026-01-30'),
        hasAnyPlan: true,
      })
      mockPantryFindMany.mockResolvedValue([])

      const data = await (await GET(createMockRequest())).json()
      const byId = Object.fromEntries(
        data.groups[0].items.map((item: { ingredientId: string }) => [item.ingredientId, item]),
      )

      expect(byId['today-item']).toMatchObject({ neededByRelative: 'today', dueToday: true })
      expect(byId['tomorrow-item']).toMatchObject({
        neededByRelative: 'tomorrow',
        dueToday: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks items as purchased when pantry item exists and was updated after plan creation', async () => {
    const planCreatedAt = new Date('2026-01-30')
    const neededDate = new Date('2026-02-01')

    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-1',
              ingredient: {
                id: 'ing-1',
                name: 'Chicken breast',
                category: 'protein',
                defaultUnit: 'g',
                measuredByVolume: false,
                gramsPerPiece: null,
              },
              neededQuantity: 600,
              pantryQuantity: null,
              shoppingQuantity: 600,
              mealCount: 2,
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: planCreatedAt,
      hasAnyPlan: true,
    })
    // Pantry item updated after plan creation → purchased
    mockPantryFindMany.mockResolvedValue([
      {
        ingredientId: 'ing-1',
        updatedAt: new Date('2026-01-31'),
      },
    ] as never)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].purchased).toBe(true)
    expect(data.summary.purchasedItems).toBe(1)
    expect(data.summary.remainingItems).toBe(0)
  })

  it('accepts days=14 parameter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [],
      startDate: '2026-01-31',
      endDate: '2026-02-13',
      windowDays: 14,
      earliestPlanCreatedAt: null,
      hasAnyPlan: false,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest('http://localhost/api/shopping-list?days=14'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.windowDays).toBe(14)
    expect(mockComputeShoppingList).toHaveBeenCalledWith(
      'household-123',
      14,
      'Europe/Tallinn',
      'en',
    )
  })

  it.each([
    ['en', '6\u00a0pc'],
    ['et', '6\u00a0tk'],
  ] as const)('formats piece-based items with the %s piece label', async (locale, expected) => {
    const neededDate = new Date('2026-02-01')
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue({
      ...mockMembership,
      household: { ...mockHousehold, locale },
    } as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-eggs',
              ingredient: {
                id: 'ing-eggs',
                name: 'Eggs',
                category: 'protein',
                defaultUnit: 'piece',
                measuredByVolume: false,
                gramsPerPiece: 60,
              },
              neededQuantity: 6,
              pantryQuantity: null,
              shoppingQuantity: 6,
              mealCount: 1,
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: null,
      hasAnyPlan: false,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    // Piece quantities are already piece counts (HON-713): 6 eggs, not 6 / 60,
    // labelled in the household's language (HON-956)
    expect(data.groups[0].items[0].displayQuantity).toBe(expected)
  })

  it('formats kilogram quantities with locale-aware decimal separator', async () => {
    const neededDate = new Date('2026-02-01')
    const buildResult = () => ({
      groups: [
        {
          category: 'carb' as const,
          categoryLabel: 'Carbs & grains',
          items: [
            {
              ingredientId: 'ing-rice',
              ingredient: {
                id: 'ing-rice',
                name: 'Rice',
                category: 'carb' as const,
                defaultUnit: 'g' as const,
                measuredByVolume: false,
                gramsPerPiece: null,
              },
              neededQuantity: 1500,
              pantryQuantity: null,
              shoppingQuantity: 1500,
              mealCount: 3,
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7 as const,
      earliestPlanCreatedAt: null,
      hasAnyPlan: false,
    })

    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockPantryFindMany.mockResolvedValue([])

    // en locale (default) → period decimal
    mockComputeShoppingList.mockResolvedValue(buildResult())
    const enResponse = await GET(createMockRequest())
    const enData = await enResponse.json()
    expect(enData.groups[0].items[0].displayQuantity).toBe('1.5kg')

    // et household → comma decimal
    mockFindFirst.mockResolvedValue({
      ...mockMembership,
      household: { ...mockHousehold, locale: 'et' },
    } as never)
    mockComputeShoppingList.mockResolvedValue(buildResult())
    const etResponse = await GET(createMockRequest())
    const etData = await etResponse.json()
    expect(etData.groups[0].items[0].displayQuantity).toBe('1,5kg')
    expect(mockComputeShoppingList).toHaveBeenLastCalledWith(
      'household-123',
      7,
      'Europe/Tallinn',
      'et',
    )

    // A locale rolled back out of KNOWN_LOCALES → English names and quantities,
    // resolved once from the household, never from the request (HON-921)
    mockFindFirst.mockResolvedValue({
      ...mockMembership,
      household: { ...mockHousehold, locale: 'xx' },
    } as never)
    mockComputeShoppingList.mockResolvedValue(buildResult())
    const rolledBackData = await (await GET(createMockRequest())).json()
    expect(rolledBackData.groups[0].items[0].displayQuantity).toBe('1.5kg')
    expect(mockComputeShoppingList).toHaveBeenLastCalledWith(
      'household-123',
      7,
      'Europe/Tallinn',
      'en',
    )
    expect(mockGetLocale).not.toHaveBeenCalled()
  })

  // A liquid shows its stored grams as millilitres, 1:1, and the raw
  // `quantity` stays in grams (HON-1054).
  it('formats a measured-by-volume ingredient in ml and l', async () => {
    const buildResult = (name: string, shoppingQuantity: number) => ({
      groups: [
        {
          category: 'condiment' as const,
          categoryLabel: 'Condiments',
          items: [
            {
              ingredientId: 'ing-liquid',
              ingredient: {
                id: 'ing-liquid',
                name,
                category: 'condiment' as const,
                defaultUnit: 'g' as const,
                measuredByVolume: true,
                gramsPerPiece: null,
              },
              neededQuantity: shoppingQuantity,
              pantryQuantity: null,
              shoppingQuantity,
              mealCount: 1,
              earliestNeededDate: new Date('2026-02-01'),
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7 as const,
      earliestPlanCreatedAt: null,
      hasAnyPlan: false,
    })

    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockPantryFindMany.mockResolvedValue([])

    mockComputeShoppingList.mockResolvedValue(buildResult('Red wine', 120))
    const wine = (await (await GET(createMockRequest())).json()).groups[0].items[0]
    expect(wine.displayQuantity).toBe('120ml')
    expect(wine.quantity).toBe(120)

    mockComputeShoppingList.mockResolvedValue(buildResult('Milk', 1500))
    const enData = await (await GET(createMockRequest())).json()
    expect(enData.groups[0].items[0].displayQuantity).toBe('1.5l')

    mockFindFirst.mockResolvedValue({
      ...mockMembership,
      household: { ...mockHousehold, locale: 'et' },
    } as never)
    mockComputeShoppingList.mockResolvedValue(buildResult('Piim', 1500))
    const etData = await (await GET(createMockRequest())).json()
    expect(etData.groups[0].items[0].displayQuantity).toBe('1,5l')
  })

  it("renders a vague phrase in the household's locale (HON-917)", async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue({
      ...mockMembership,
      household: { ...mockHousehold, locale: 'et' },
    } as never)
    mockPantryFindMany.mockResolvedValue([])
    mockComputeShoppingList.mockResolvedValue({
      groups: [
        {
          category: 'spice' as const,
          categoryLabel: 'Spices',
          items: [
            {
              ingredientId: 'ing-salt',
              ingredient: {
                id: 'ing-salt',
                name: 'Sool',
                category: 'spice' as const,
                defaultUnit: 'g' as const,
                measuredByVolume: false,
                gramsPerPiece: null,
              },
              neededQuantity: 4,
              pantryQuantity: null,
              shoppingQuantity: 4,
              mealCount: 2,
              earliestNeededDate: new Date('2026-02-01'),
              isVague: true,
              originalPhrase: 'to taste',
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7 as const,
      earliestPlanCreatedAt: null,
      hasAnyPlan: true,
    })

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(data.groups[0].items[0].displayQuantity).toBe('maitse järgi')
    expect(data.groups[0].items[0].isVague).toBe(true)
  })

  it('returns 500 when computation fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockRejectedValue(new Error('DB error'))

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch shopping list')
  })
})
