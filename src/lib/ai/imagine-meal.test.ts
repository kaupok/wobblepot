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

vi.mock('./sampling', () => ({
  logAiSample: vi.fn(),
}))

import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { imagineMeals, ImaginedMealsSchema, type ImaginedMeal } from './imagine-meal'
import { logAiSample } from './sampling'

const mockGenerateObject = vi.mocked(generateObject)
const mockCreateAnthropic = vi.mocked(createAnthropic)
const mockLogAiSample = vi.mocked(logAiSample)

function sampleMeal(overrides: Partial<ImaginedMeal> = {}): ImaginedMeal {
  return {
    name: 'Chicken stir fry',
    description: 'Fast and tasty',
    timeMinutes: 30,
    servings: 2,
    mealTypes: ['dinner'],
    kidFriendly: true,
    ingredients: [
      {
        name: 'chicken breast',
        quantity: 300,
        unit: 'g',
        originalText: '300g chicken breast',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
      {
        name: 'broccoli',
        quantity: 200,
        unit: 'g',
        originalText: '200g broccoli',
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      },
    ],
    ...overrides,
  }
}

const emptyHousehold = {
  allergens: [],
  dietaryType: null,
  excludedIngredients: [],
  restrictions: [],
  householdSize: 2,
}

describe('imagineMeals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the AI-generated meals on the happy path', async () => {
    const meals: ImaginedMeal[] = [
      sampleMeal(),
      sampleMeal({ name: 'Meal 2' }),
      sampleMeal({ name: 'Meal 3' }),
    ]
    mockGenerateObject.mockResolvedValue({ object: { meals } } as never)

    const result = await imagineMeals('something with chicken', emptyHousehold, 'en')

    expect(result).toEqual(meals)
  })

  it('initializes Anthropic with the server API key', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'en')

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: 'test-key' })
  })

  it('uses the ImaginedMealsSchema for structured output', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { schema: unknown }
    expect(call.schema).toBe(ImaginedMealsSchema)
  })

  it('includes household size in the system prompt', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', { ...emptyHousehold, householdSize: 5 }, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).toContain('household of 5 people')
    expect(call.system).toContain('5 servings')
  })

  it('injects allergens into the system prompt when present', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', { ...emptyHousehold, allergens: ['peanuts', 'shellfish'] }, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).toContain('MUST AVOID')
    expect(call.system).toContain('peanuts, shellfish')
  })

  it('injects dietary type, excluded ingredients, and restrictions when present', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals(
      'test',
      {
        allergens: [],
        dietaryType: 'vegetarian',
        excludedIngredients: ['mushrooms'],
        restrictions: ['low FODMAP'],
        householdSize: 2,
      },
      'en',
    )

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).toContain('Dietary type: vegetarian')
    expect(call.system).toContain('Excluded ingredients (do not use): mushrooms')
    expect(call.system).toContain('Dietary preferences: low FODMAP')
  })

  it('omits constraint section when household has no dietary constraints', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).not.toContain('Household dietary constraints')
    expect(call.system).not.toContain('MUST AVOID')
  })

  it('includes the user prompt in the messages content', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('chicken something easy', emptyHousehold, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>
    }
    const userMessage = call.messages[0]!
    expect(userMessage.role).toBe('user')
    const textPart = userMessage.content.find((c) => c.type === 'text')
    expect(textPart?.text).toContain('chicken something easy')
  })

  it('uses photo-only fallback prompt when user prompt is null', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals(null, emptyHousehold, 'en', [
      { base64: Buffer.from('fake-image').toString('base64'), mimeType: 'image/jpeg' },
    ])

    const call = mockGenerateObject.mock.calls[0]![0]! as {
      messages: Array<{
        role: string
        content: Array<{ type: string; text?: string; image?: Buffer; mediaType?: string }>
      }>
    }
    const content = call.messages[0]!.content
    const textPart = content.find((c) => c.type === 'text')
    expect(textPart?.text).toContain('attached photo')
    // Image is forwarded as Buffer
    const imagePart = content.find((c) => c.type === 'image')
    expect(imagePart?.image).toBeInstanceOf(Buffer)
    expect(imagePart?.mediaType).toBe('image/jpeg')
  })

  it('forwards multiple image attachments', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'en', [
      { base64: Buffer.from('img1').toString('base64'), mimeType: 'image/jpeg' },
      { base64: Buffer.from('img2').toString('base64'), mimeType: 'image/png' },
    ])

    const call = mockGenerateObject.mock.calls[0]![0]! as {
      messages: Array<{ content: Array<{ type: string; mediaType?: string }> }>
    }
    const images = call.messages[0]!.content.filter((c) => c.type === 'image')
    expect(images).toHaveLength(2)
    expect(images[0]!.mediaType).toBe('image/jpeg')
    expect(images[1]!.mediaType).toBe('image/png')
  })

  it('propagates errors from generateObject', async () => {
    mockGenerateObject.mockRejectedValue(new Error('AI failure'))

    await expect(imagineMeals('test', emptyHousehold, 'en')).rejects.toThrow('AI failure')
  })

  it('does not inject a locale instruction for the default (English) locale', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'en')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).not.toContain('LOCALE:')
  })

  it('injects an Estonian output instruction when locale is "et"', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'et')

    const call = mockGenerateObject.mock.calls[0]![0]! as { system: string }
    expect(call.system).toContain('LOCALE:')
    expect(call.system).toContain('Estonian')
  })

  it('logs an imagine-meal AI sample with the right shape when locale is non-default', async () => {
    const meals: ImaginedMeal[] = [sampleMeal()]
    mockGenerateObject.mockResolvedValue({ object: { meals } } as never)

    await imagineMeals(
      'midagi kanaga',
      {
        allergens: ['peanuts'],
        dietaryType: 'flexitarian',
        excludedIngredients: ['mushroom'],
        restrictions: ['low FODMAP'],
        householdSize: 3,
      },
      'et',
      [{ base64: 'aGV5', mimeType: 'image/jpeg' }],
    )

    expect(mockLogAiSample).toHaveBeenCalledTimes(1)
    const args = mockLogAiSample.mock.calls[0]![0]
    expect(args.callSite).toBe('imagine-meal')
    expect(args.locale).toBe('et')
    expect(args.input).toEqual({
      prompt: 'midagi kanaga',
      hasImages: true,
      dietaryType: 'flexitarian',
      allergens: ['peanuts'],
      excludedIngredients: ['mushroom'],
      restrictions: ['low FODMAP'],
      householdSize: 3,
    })
    expect(args.output).toEqual({ meals })
  })
})
