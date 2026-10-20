// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Photo input for `/api/recipes/parse` (HON-1274). Its own file, because
// `route.test.ts` is at its file-size cap.

vi.mock('@/lib/env', () => ({
  serverEnv: {},
}))

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
}))

vi.mock('@/lib/ai/recipe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/recipe-fetch')>()),
  fetchRecipeFromUrl: vi.fn(),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
  recordAiUsage: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(async () => true),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/ai/translate-match-results', () => ({
  translateMatchResults: vi.fn(async (results: unknown) => results),
}))

import { POST } from './route'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { parseAndMatchRecipe } from '@/lib/ai/parse-recipe'
import { fetchRecipeFromUrl } from '@/lib/ai/recipe-fetch'
import { RecipeParseError } from '@/lib/ai/recipe-errors'
import { MAX_ATTACHED_IMAGE_SIZE } from '@/lib/image-attachments'

const mockParseAndMatchRecipe = vi.mocked(parseAndMatchRecipe)
const mockFetchRecipeFromUrl = vi.mocked(fetchRecipeFromUrl)
const mockRecordAiUsage = vi.mocked(recordAiUsage)

function jpeg(name = 'card.jpg', bytes = 'jpeg-bytes') {
  return new File([bytes], name, { type: 'image/jpeg' })
}

function multipartRequest(fields: { text?: string; images?: File[] }) {
  const formData = new FormData()
  if (fields.text !== undefined) formData.append('text', fields.text)
  for (const image of fields.images ?? []) formData.append('image', image)
  return new Request('http://localhost/api/recipes/parse', { method: 'POST', body: formData })
}

function successfulParse() {
  mockParseAndMatchRecipe.mockResolvedValue({
    name: 'Grandma soup',
    description: null,
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: null,
    servings: 6,
    mealTypes: ['dinner'],
    kidFriendly: true,
    ingredients: [],
    allMatched: true,
    confidenceTier: 'high',
  })
}

describe('POST /api/recipes/parse with photos (HON-1274)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 's-1' },
    } as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue({
      household: { id: 'household-42', locale: 'et' },
    } as never)
    vi.mocked(assertUnderCap).mockResolvedValue(undefined)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      limit: 20,
      resetAt: new Date(Date.now() + 3_600_000),
    })
  })

  it('calls the parser with one image for one photo and no text', async () => {
    successfulParse()

    const response = await POST(multipartRequest({ images: [jpeg()] }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.recipe.name).toBe('Grandma soup')
    expect(mockParseAndMatchRecipe).toHaveBeenCalledTimes(1)
    const [text, sourceUrl, , matchOptions, , images] = mockParseAndMatchRecipe.mock.calls[0]!
    expect(text).toBe('')
    expect(sourceUrl).toBeUndefined()
    expect(matchOptions).toEqual({ householdId: 'household-42', locale: 'et' })
    expect(images).toEqual([
      { base64: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' },
    ])
  })

  it('records AI usage under recipe_parse', async () => {
    successfulParse()
    await POST(multipartRequest({ images: [jpeg()] }))

    const onAiUsage = mockParseAndMatchRecipe.mock.calls[0]![2]!
    onAiUsage({ model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 } as never)
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'household-42', feature: 'recipe_parse' }),
    )
  })

  it('does not fetch a URL in the text when photos are attached', async () => {
    successfulParse()

    await POST(multipartRequest({ text: 'https://example.com/soup\nserves 6', images: [jpeg()] }))

    expect(mockFetchRecipeFromUrl).not.toHaveBeenCalled()
    const [text, sourceUrl] = mockParseAndMatchRecipe.mock.calls[0]!
    expect(text).toBe('https://example.com/soup\nserves 6')
    expect(sourceUrl).toBeUndefined()
  })

  it('treats a multipart body with text and no photo like a JSON body', async () => {
    successfulParse()

    await POST(multipartRequest({ text: 'Soup: 2 carrots, 1 onion, 1 l water, salt' }))

    const [text, , , , , images] = mockParseAndMatchRecipe.mock.calls[0]!
    expect(text).toBe('Soup: 2 carrots, 1 onion, 1 l water, salt')
    expect(images).toBeUndefined()
  })

  it('returns invalid_request for a multipart body with no text and no photo', async () => {
    const response = await POST(multipartRequest({ text: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.code).toBe('invalid_request')
    expect(mockParseAndMatchRecipe).not.toHaveBeenCalled()
  })

  it.each([
    ['too_many_images', [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg'), jpeg('4.jpg')]],
    ['wrong_image_type', [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })]],
    ['image_too_large', [jpeg('big.jpg', 'x'.repeat(MAX_ATTACHED_IMAGE_SIZE + 1))]],
  ])('returns 400 %s without calling the parser', async (code, images) => {
    const response = await POST(multipartRequest({ images }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.code).toBe(code)
    expect(mockParseAndMatchRecipe).not.toHaveBeenCalled()
  })

  it.each(['no_recipe_found', 'no_ingredients_found', 'low_confidence'] as const)(
    'returns photo_no_recipe when photos are attached and the parser throws %s',
    async (code) => {
      mockParseAndMatchRecipe.mockRejectedValue(new RecipeParseError('nothing here', code))

      const response = await POST(multipartRequest({ images: [jpeg('dish.jpg')] }))
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.code).toBe('photo_no_recipe')
    },
  )

  it('keeps no_recipe_found for a text import', async () => {
    mockParseAndMatchRecipe.mockRejectedValue(
      new RecipeParseError('nothing here', 'no_recipe_found'),
    )

    const response = await POST(
      new Request('http://localhost/api/recipes/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Not a recipe at all, just some words here' }),
      }),
    )
    expect((await response.json()).code).toBe('no_recipe_found')
  })
})
