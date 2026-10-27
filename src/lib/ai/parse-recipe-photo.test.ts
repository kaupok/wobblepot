import { describe, it, expect, vi, beforeEach } from 'vitest'

// Photo input for recipe parsing (HON-1274). Its own file, because
// `parse-recipe.test.ts` is at its file-size cap.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

// Keep the real exports: `withUsageOnFailure` needs the real
// `NoObjectGeneratedError.isInstance` on every rejected call.
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { ANTHROPIC_API_KEY: 'test-key' },
}))

vi.mock('./sampling', () => ({
  logAiSample: vi.fn(),
}))

vi.mock('./match-ingredients', () => ({
  matchIngredients: vi.fn(async () => []),
}))

import { generateObject } from 'ai'
import { parseRecipeText, parseAndMatchRecipe } from './parse-recipe'
import { buildRecipeRequest } from './recipe-prompt'
import { z } from 'zod'

const mockGenerateObject = vi.mocked(generateObject)

const photo = { base64: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' }

// Each build makes a new Zod schema, and two instances never deep-equal, so
// compare the JSON Schema the provider receives instead.
function withJsonSchema(request: object) {
  return { ...request, schema: z.toJSONSchema((request as { schema: z.ZodType }).schema) }
}

describe('parseRecipeText with photos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateObject.mockRejectedValue(new Error('stop after the call'))
  })

  it('does not throw text_too_short for photos with empty text', async () => {
    await expect(parseRecipeText('', 4, 'en', undefined, undefined, [photo])).rejects.toThrow(
      'stop after the call',
    )
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('still throws text_too_short for empty text with an empty photo list', async () => {
    await expect(parseRecipeText('', 4, 'en', undefined, undefined, [])).rejects.toMatchObject({
      code: 'text_too_short',
    })
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('sends the image request buildRecipeRequest builds, with the trimmed text', async () => {
    const abortSignal = AbortSignal.timeout(35_000)
    await expect(
      parseRecipeText('  serves 6 \n', 4, 'et', undefined, abortSignal, [photo]),
    ).rejects.toThrow('stop after the call')

    expect(withJsonSchema(mockGenerateObject.mock.calls[0]![0])).toEqual(
      withJsonSchema({
        ...buildRecipeRequest('serves 6', 4, 'et', [photo]),
        model: 'mock-model',
        abortSignal,
      }),
    )
  })
})

describe('parseAndMatchRecipe with photos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the photos to the AI call', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        name: 'Grandma soup',
        description: null,
        preparationNotes: null,
        timeMinutes: null,
        servings: 4,
        mealTypes: ['dinner'],
        kidFriendly: true,
        recipeConfidence: 95,
        ingredients: [
          {
            name: 'carrot',
            quantity: 2,
            unit: 'piece',
            originalText: '2 carrots',
            isVague: false,
            vaguePhrase: null,
            isDried: null,
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never)

    const result = await parseAndMatchRecipe(
      '',
      undefined,
      undefined,
      { defaultServings: 4, locale: 'en' },
      undefined,
      [photo],
    )

    expect(result.name).toBe('Grandma soup')
    const request = mockGenerateObject.mock.calls[0]![0] as { messages: { content: unknown[] }[] }
    expect(request.messages[0]!.content[0]).toEqual({
      type: 'image',
      image: Buffer.from('jpeg-bytes'),
      mediaType: 'image/jpeg',
    })
  })
})
