// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

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
  getHouseholdMemberCount: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

vi.mock('@/lib/ai/imagine-meal', () => ({
  imagineMeals: vi.fn(),
}))

vi.mock('@/lib/ai/parse-recipe', () => ({
  matchIngredients: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ingredient: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/usage')>()
  return {
    ...actual,
    assertUnderCap: vi.fn(),
    recordAiUsage: vi.fn(),
  }
})

import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { checkRateLimit } from '@/lib/rate-limit'
import { imagineMeals } from '@/lib/ai/imagine-meal'
import { matchIngredients } from '@/lib/ai/parse-recipe'
import { prisma } from '@/lib/prisma'
import { assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockGetMemberCount = vi.mocked(getHouseholdMemberCount)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockImagineMeals = vi.mocked(imagineMeals)
const mockMatchIngredients = vi.mocked(matchIngredients)
const mockIngredientFindMany = vi.mocked(prisma.ingredient.findMany)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

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
    locale: 'en',
    preferences: {
      allergensToAvoid: [],
      dietaryType: null,
      excludedIngredients: [],
      restrictions: [],
    },
  },
}

function jsonRequest(body: unknown, bodyString?: string) {
  return new Request('http://localhost/api/meals/imagine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bodyString !== undefined ? bodyString : JSON.stringify(body),
  })
}

function multipartRequest(fd: FormData) {
  return new Request('http://localhost/api/meals/imagine', {
    method: 'POST',
    body: fd,
  })
}

function imaginedMeal(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Chicken curry',
    description: 'A warming curry',
    timeMinutes: 45,
    servings: 4,
    mealTypes: ['dinner'],
    kidFriendly: true,
    ingredients: [
      {
        name: 'Chicken breast',
        quantity: 500,
        unit: 'g',
        originalText: '500g chicken breast',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
    ],
    ...overrides,
  }
}

function matchedResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'matched',
    extractedName: 'Chicken breast',
    extractedQuantity: 500,
    extractedUnit: 'g',
    originalText: '500g chicken breast',
    ingredient: {
      id: 'ing-chicken',
      name: 'Chicken breast',
      category: 'protein',
      subcategory: null,
      defaultUnit: 'g',
      gramsPerPiece: null,
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
    },
    convertedQuantity: 500,
    isVague: false,
    similarityScore: 0.95,
    lowConfidence: false,
    ...overrides,
  }
}

function unmatchedResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'unmatched',
    extractedName: 'Exotic spice',
    extractedQuantity: 1,
    extractedUnit: 'g',
    originalText: '1g exotic spice',
    isVague: false,
    ...overrides,
  }
}

describe('POST /api/meals/imagine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 49,
      limit: 50,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    mockGetMemberCount.mockResolvedValue(2)
    mockIngredientFindMany.mockResolvedValue([])
    mockAssertUnderCap.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(jsonRequest({ prompt: 'something' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(jsonRequest({ prompt: 'something' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 429 with Retry-After header when rate limit exceeded', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 50,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await POST(jsonRequest({ prompt: 'something' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(data.error).toBe('Rate limit exceeded')
    expect(data.resetAt).toBe('2026-02-01T12:00:00.000Z')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(jsonRequest({}, 'not valid json'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when JSON prompt is empty', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(jsonRequest({ prompt: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('description')
  })

  it('returns 400 when multipart has no prompt and no images', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const fd = new FormData()
    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('description')
  })

  it('returns 400 when too many images are attached', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const fd = new FormData()
    for (let i = 0; i < 4; i++) {
      fd.append('image', new File(['x'], `img${i}.jpg`, { type: 'image/jpeg' }))
    }
    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Maximum')
  })

  it('returns 400 for unsupported image mime type', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const fd = new FormData()
    fd.append('prompt', 'some prompt')
    fd.append('image', new File(['x'], 'bad.gif', { type: 'image/gif' }))

    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('JPEG, PNG, or WebP')
  })

  it('returns 400 when image exceeds 5MB', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const fd = new FormData()
    fd.append('prompt', 'a prompt')
    const bigBuffer = new Uint8Array(5 * 1024 * 1024 + 1) // 5MB + 1 byte
    fd.append('image', new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' }))

    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('5MB')
  })

  it('returns 400 when multipart prompt exceeds 500 chars', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const fd = new FormData()
    fd.append('prompt', 'x'.repeat(501))
    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('500 characters')
  })

  it('happy path: returns generated meals with nutrition and records rate limit', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockImagineMeals.mockResolvedValue([imaginedMeal() as never])
    mockMatchIngredients.mockResolvedValue([matchedResult() as never])
    mockIngredientFindMany.mockResolvedValue([
      {
        id: 'ing-chicken',
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        proteinType: 'poultry',
      },
    ] as never)

    const response = await POST(jsonRequest({ prompt: 'chicken dinner' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.meals).toHaveLength(1)
    const meal = data.meals[0]
    expect(meal.name).toBe('Chicken curry')
    expect(meal.allMatched).toBe(true)
    expect(meal.nutrition.calories).toBeGreaterThan(0)
    expect(meal.components).toHaveLength(1)
    expect(meal.components[0].ingredientId).toBe('ing-chicken')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'meal-imagination')
    expect(mockImagineMeals).toHaveBeenCalledWith(
      'chicken dinner',
      expect.objectContaining({ householdSize: 2 }),
      expect.any(String),
      undefined,
      expect.any(Function),
    )
  })

  it('sets allMatched to false when at least one ingredient is unmatched', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockImagineMeals.mockResolvedValue([imaginedMeal() as never])
    mockMatchIngredients.mockResolvedValue([matchedResult() as never, unmatchedResult() as never])
    mockIngredientFindMany.mockResolvedValue([
      {
        id: 'ing-chicken',
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        proteinType: 'poultry',
      },
    ] as never)

    const response = await POST(jsonRequest({ prompt: 'chicken dinner' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meals[0].allMatched).toBe(false)
    // components only reflect matched ingredients
    expect(data.meals[0].components).toHaveLength(1)
  })

  it('returns 500 when imagineMeals throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockImagineMeals.mockRejectedValue(new Error('AI down'))

    const response = await POST(jsonRequest({ prompt: 'anything' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toContain('Failed to generate meal ideas')
  })

  it('accepts a multipart request with just an image (no prompt)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockImagineMeals.mockResolvedValue([imaginedMeal() as never])
    mockMatchIngredients.mockResolvedValue([matchedResult() as never])
    mockIngredientFindMany.mockResolvedValue([
      {
        id: 'ing-chicken',
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        proteinType: 'poultry',
      },
    ] as never)

    const fd = new FormData()
    fd.append('image', new File(['tiny'], 'img.jpg', { type: 'image/jpeg' }))

    const response = await POST(multipartRequest(fd))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockImagineMeals).toHaveBeenCalledWith(
      null,
      expect.any(Object),
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ mimeType: 'image/jpeg' })]),
      expect.any(Function),
    )
  })
})
