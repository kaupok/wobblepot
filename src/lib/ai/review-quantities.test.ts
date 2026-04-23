import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@/lib/env', () => ({
  serverEnv: { ANTHROPIC_API_KEY: 'test-key' },
}))

import { generateObject } from 'ai'
import { reviewMealQuantities, type ReviewIngredient } from './review-quantities'
import { REVIEW_MODEL } from './models'

const mockGenerateObject = vi.mocked(generateObject)

const sampleIngredients: ReviewIngredient[] = [
  {
    ingredientId: 'ing-chicken',
    name: 'Chicken breast',
    quantityPerServing: 150,
    unit: 'g',
  },
  {
    ingredientId: 'ing-oil',
    name: 'Olive oil',
    quantityPerServing: 60,
    unit: 'g',
  },
]

describe('reviewMealQuantities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the AI response object unchanged on happy path', async () => {
    const aiResponse = {
      ingredients: [
        { ingredientId: 'ing-chicken', quantityPerServing: 150 },
        { ingredientId: 'ing-oil', quantityPerServing: 8 },
      ],
    }
    mockGenerateObject.mockResolvedValue({ object: aiResponse } as never)

    const result = await reviewMealQuantities('Chicken stir fry', 4, sampleIngredients, 'en')

    expect(result).toEqual(aiResponse)
  })

  it('calls generateObject with the REVIEW_MODEL and a schema', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ingredients: [] } } as never)

    await reviewMealQuantities('Pasta', 2, sampleIngredients, 'en')

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    const call = mockGenerateObject.mock.calls[0]![0]! as {
      model: unknown
      schema: unknown
      system: string
    }
    expect(call.model).toBe('mock-model')
    expect(call.schema).toBeDefined()
    // System prompt should describe the reviewer role
    expect(typeof call.system).toBe('string')
    expect(call.system).toContain('quantity reviewer')
  })

  it('includes meal name, serving count, and every ingredient in the user prompt', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ingredients: [] } } as never)

    await reviewMealQuantities('Chicken stir fry', 4, sampleIngredients, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { prompt: string }
    expect(call.prompt).toContain('Chicken stir fry')
    expect(call.prompt).toContain('4 servings')
    expect(call.prompt).toContain('Chicken breast')
    expect(call.prompt).toContain('Olive oil')
    // Ingredient id is included so AI preserves the mapping
    expect(call.prompt).toContain('ing-chicken')
    expect(call.prompt).toContain('ing-oil')
    // Per-serving qty and total are spelled out
    expect(call.prompt).toContain('150g/serving')
    expect(call.prompt).toContain('600g total')
  })

  it('uses the configured REVIEW_MODEL identifier', () => {
    expect(REVIEW_MODEL).toMatch(/claude-/)
  })

  it('propagates errors from generateObject', async () => {
    mockGenerateObject.mockRejectedValue(new Error('AI down'))

    await expect(reviewMealQuantities('Pasta', 2, sampleIngredients, 'en')).rejects.toThrow(
      'AI down',
    )
  })

  it('formats piece units correctly in the prompt', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ingredients: [] } } as never)

    await reviewMealQuantities(
      'Omelette',
      2,
      [{ ingredientId: 'ing-eggs', name: 'Eggs', quantityPerServing: 2, unit: 'piece' }],
      'en',
    )

    const call = mockGenerateObject.mock.calls[0]![0]! as { prompt: string }
    expect(call.prompt).toContain('2piece/serving')
    expect(call.prompt).toContain('4piece total')
  })

  it('does not inject a locale instruction for the default (English) locale', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ingredients: [] } } as never)

    await reviewMealQuantities('Pasta', 2, sampleIngredients, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).not.toContain('LOCALE:')
  })

  it('injects an Estonian output instruction when locale is "et"', async () => {
    mockGenerateObject.mockResolvedValue({ object: { ingredients: [] } } as never)

    await reviewMealQuantities('Pasta', 2, sampleIngredients, 'et')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).toContain('LOCALE:')
    expect(call.system).toContain('Estonian')
  })
})
