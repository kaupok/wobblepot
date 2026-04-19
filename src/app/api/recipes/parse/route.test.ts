// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractUrlAndContext, POST } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

vi.mock('@/lib/ai/parse-recipe', () => ({
  parseAndMatchRecipe: vi.fn(),
  fetchRecipeFromUrl: vi.fn(),
  RecipeParseError: class RecipeParseError extends Error {},
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { checkRateLimit } from '@/lib/rate-limit'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCheckRateLimit = vi.mocked(checkRateLimit)

describe('extractUrlAndContext', () => {
  it('detects https:// URLs', () => {
    const result = extractUrlAndContext('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result).toEqual({
      url: 'https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas',
      context: '',
    })
  })

  it('detects http:// URLs', () => {
    const result = extractUrlAndContext('http://example.com/recipe')
    expect(result).toEqual({
      url: 'http://example.com/recipe',
      context: '',
    })
  })

  it('detects www. URLs and prepends https://', () => {
    const result = extractUrlAndContext('www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result).toEqual({
      url: 'https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas',
      context: '',
    })
  })

  it('does not double-prepend https:// for www. URLs', () => {
    const result = extractUrlAndContext('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
    expect(result?.url).toBe('https://www.bbcgoodfood.com/recipes/easy-chicken-fajitas')
  })

  it('handles www.invalid gracefully (returns null for invalid URL)', () => {
    const result = extractUrlAndContext('www.invalid')
    expect(result).toEqual({
      url: 'https://www.invalid',
      context: '',
    })
  })

  it('does not treat plain text starting with "www" as a URL', () => {
    const result = extractUrlAndContext('www is short for World Wide Web')
    expect(result).toBeNull()
  })

  it('returns null for plain recipe text', () => {
    const result = extractUrlAndContext('2 cups flour\n1 tsp salt\n3 eggs')
    expect(result).toBeNull()
  })

  it('extracts context from lines after the URL', () => {
    const input = 'https://example.com/recipe\nHalve the sugar\nUse almond milk'
    const result = extractUrlAndContext(input)
    expect(result).toEqual({
      url: 'https://example.com/recipe',
      context: 'Halve the sugar\nUse almond milk',
    })
  })

  it('extracts context from www. URL with additional lines', () => {
    const input = 'www.example.com/recipe\nMake it spicy'
    const result = extractUrlAndContext(input)
    expect(result).toEqual({
      url: 'https://www.example.com/recipe',
      context: 'Make it spicy',
    })
  })

  it('trims whitespace from input', () => {
    const result = extractUrlAndContext('  www.example.com/recipe  ')
    expect(result).toEqual({
      url: 'https://www.example.com/recipe',
      context: '',
    })
  })
})

describe('POST /api/recipes/parse rate limiting', () => {
  const mockSession = { user: { id: 'user-1' }, session: { id: 's-1' } }
  const mockMembership = { household: { id: 'household-42' } }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
  })

  function jsonRequest(body: unknown) {
    return new Request('http://localhost/api/recipes/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 429 with Retry-After header when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 20,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await POST(jsonRequest({ text: 'some recipe' }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(data.success).toBe(false)
    expect(data.error).toBe('Rate limit exceeded')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-42', 'recipe-parse')
  })
})
