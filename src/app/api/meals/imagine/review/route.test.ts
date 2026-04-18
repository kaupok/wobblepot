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

vi.mock('@/lib/ai/review-quantities', () => ({
  reviewMealQuantities: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { reviewMealQuantities } from '@/lib/ai/review-quantities'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockReview = vi.mocked(reviewMealQuantities)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

function createRequest(body?: unknown, bodyString?: string) {
  return new Request('http://localhost/api/meals/imagine/review', {
    method: 'POST',
    body:
      bodyString !== undefined ? bodyString : body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const validBody = {
  mealName: 'Chicken stir fry',
  servings: 4,
  ingredients: [
    { ingredientId: 'ing-1', name: 'Chicken breast', quantityPerServing: 150, unit: 'g' },
    { ingredientId: 'ing-2', name: 'Egg', quantityPerServing: 1, unit: 'piece' },
  ],
}

describe('POST /api/meals/imagine/review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest(validBody))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await POST(createRequest(undefined, 'not valid json'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when mealName is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await POST(
      createRequest({
        servings: 4,
        ingredients: [validBody.ingredients[0]],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request data')
  })

  it('returns 400 when ingredients array is empty', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await POST(createRequest({ ...validBody, ingredients: [] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request data')
  })

  it('returns 400 when unit is not g or piece', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await POST(
      createRequest({
        ...validBody,
        ingredients: [
          { ingredientId: 'ing-1', name: 'Olive oil', quantityPerServing: 10, unit: 'ml' },
        ],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request data')
  })

  it('returns 400 when servings is out of range', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await POST(createRequest({ ...validBody, servings: 0 }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request data')
  })

  it('returns 200 with reviewed ingredients on happy path', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockReview.mockResolvedValue({
      ingredients: [
        { ingredientId: 'ing-1', quantityPerServing: 160 },
        { ingredientId: 'ing-2', quantityPerServing: 1 },
      ],
    })

    const response = await POST(createRequest(validBody))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.ingredients).toEqual([
      { ingredientId: 'ing-1', quantityPerServing: 160 },
      { ingredientId: 'ing-2', quantityPerServing: 1 },
    ])
    expect(mockReview).toHaveBeenCalledWith('Chicken stir fry', 4, validBody.ingredients)
  })

  it('filters out non-positive quantities the AI may return', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockReview.mockResolvedValue({
      ingredients: [
        { ingredientId: 'ing-1', quantityPerServing: 150 },
        { ingredientId: 'ing-2', quantityPerServing: 0 },
        { ingredientId: 'ing-3', quantityPerServing: -5 },
      ],
    })

    const response = await POST(createRequest(validBody))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual([{ ingredientId: 'ing-1', quantityPerServing: 150 }])
  })

  it('returns 500 when reviewMealQuantities throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockReview.mockRejectedValue(new Error('AI service down'))

    const response = await POST(createRequest(validBody))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to review quantities')
  })
})
