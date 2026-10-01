import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  imagineMeals,
  ImaginedMealsSchema,
  ImagineNoSafeMealsError,
  type ImaginedMeal,
} from './imagine-meal'
import { HON_859_IMAGINE_RUNS, type RecordedMeal } from './imagine-fixtures'
import { buildImagineRequest } from './imagine-request'
import { logAiSample } from './sampling'
import { IMAGINE_MODEL } from './models'
import { USAGE_FIXTURE, expectedUsageStats, noObjectGeneratedError } from './usage-fixture'

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
        vaguePhrase: null,
        isDried: null,
      },
      {
        name: 'broccoli',
        quantity: 200,
        unit: 'g',
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

  it('reports the SDK usage to onAiUsage via toAiUsageStats', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] }, usage: USAGE_FIXTURE } as never)
    const onAiUsage = vi.fn()

    await imagineMeals('something with chicken', emptyHousehold, 'en', undefined, onAiUsage)

    expect(onAiUsage).toHaveBeenCalledTimes(1)
    expect(onAiUsage).toHaveBeenCalledWith(expectedUsageStats(IMAGINE_MODEL))
  })

  it('reports the billed usage with success: false when generateObject throws NoObjectGeneratedError', async () => {
    const error = noObjectGeneratedError()
    mockGenerateObject.mockRejectedValue(error)
    const onAiUsage = vi.fn()

    await expect(
      imagineMeals('something with chicken', emptyHousehold, 'en', undefined, onAiUsage),
    ).rejects.toBe(error)

    expect(onAiUsage).toHaveBeenCalledTimes(1)
    expect(onAiUsage).toHaveBeenCalledWith({ ...expectedUsageStats(IMAGINE_MODEL), success: false })
  })

  it('forwards the caller-supplied abort signal to generateObject (HON-694)', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)
    const abortSignal = AbortSignal.timeout(40_000)

    await imagineMeals('test', emptyHousehold, 'en', undefined, undefined, abortSignal)

    // The route owns the budget; if it stops arriving here the AI call is
    // unbounded again and the platform kills the function before the 504.
    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ abortSignal }))
  })

  it('sends exactly the request buildImagineRequest builds, plus model and signal (HON-796)', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)
    const household = {
      allergens: ['peanuts'],
      dietaryType: 'vegetarian',
      excludedIngredients: ['mushroom'],
      restrictions: ['low salt'],
      householdSize: 4,
    }
    const images = [{ base64: Buffer.from('fake-image').toString('base64'), mimeType: 'image/png' }]
    const abortSignal = AbortSignal.timeout(40_000)

    await imagineMeals('a creamy pasta', household, 'et', images, undefined, abortSignal)

    // The model benchmark (HON-795) sends the builder's output. If production
    // adds an argument, or builds any of these inline, the two drift apart.
    expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
      ...buildImagineRequest({ prompt: 'a creamy pasta', household, locale: 'et', images }),
      model: 'mock-model',
      abortSignal,
    })
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

  it('appends the Estonian voice block after the locale instruction for "et" only', async () => {
    mockGenerateObject.mockResolvedValue({ object: { meals: [] } } as never)

    await imagineMeals('test', emptyHousehold, 'et')
    const et = (mockGenerateObject.mock.calls[0]![0]! as { system: string }).system
    expect(et).toContain('ESTONIAN VOICE')
    expect(et).toContain('Kanariis')
    expect(et.indexOf('LOCALE:')).toBeLessThan(et.indexOf('ESTONIAN VOICE'))

    mockGenerateObject.mockClear()
    await imagineMeals('test', emptyHousehold, 'en')
    const en = (mockGenerateObject.mock.calls[0]![0]! as { system: string }).system
    expect(en).not.toContain('ESTONIAN VOICE')
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

/**
 * The guard, run against what Sonnet 4.6 actually produced for the three
 * HON-859 cases where the prompt names a food the household cannot eat.
 */
describe('imagineMeals forbidden-food guard (HON-895)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const recorded = (caseId: string, model: string, run: number): ImaginedMeal[] => {
    const found = HON_859_IMAGINE_RUNS.find(
      (r) => r.caseId === caseId && r.model === model && r.run === run,
    )
    if (!found) throw new Error(`No recorded run ${caseId} ${model} ${run}`)
    return found.meals.map((m: RecordedMeal) =>
      sampleMeal({
        name: m.name,
        ingredients: m.ingredients.map((name) => ({
          name,
          quantity: 100,
          unit: 'g',
          vaguePhrase: null,
          isDried: null,
        })),
      }),
    )
  }

  const paellaHousehold = {
    allergens: ['shellfish'],
    dietaryType: null,
    excludedIngredients: ['chorizo'],
    restrictions: [],
    householdSize: 3,
  }
  const sushiHousehold = {
    allergens: ['fish', 'shellfish'],
    dietaryType: null,
    excludedIngredients: [],
    restrictions: [],
    householdSize: 1,
  }
  const veganHousehold = {
    allergens: [],
    dietaryType: 'vegan',
    excludedIngredients: [],
    restrictions: [],
    householdSize: 4,
  }

  const respond = (...calls: ImaginedMeal[][]) => {
    for (const meals of calls) {
      mockGenerateObject.mockResolvedValueOnce({ object: { meals } } as never)
    }
  }
  const names = (meals: ImaginedMeal[]) => meals.map((m) => m.name)
  const userText = (call: number) =>
    (
      mockGenerateObject.mock.calls[call]![0]! as {
        messages: Array<{ content: Array<{ type: string; text?: string }> }>
      }
    ).messages[0]!.content.find((c) => c.type === 'text')!.text!

  it('drops the shrimp paellas and fills the gap from the retry (en-shellfish-allergy-paella)', async () => {
    respond(
      recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 2),
      recorded('en-shellfish-allergy-paella', 'claude-sonnet-5-5', 1),
    )

    const result = await imagineMeals(
      'a seafood paella for a summer weekend',
      paellaHousehold,
      'en',
    )

    expect(names(result)).toEqual([
      'Mediterranean Baked Salmon with Roasted Vegetables & Couscous',
      'Golden Cod and Pea Skillet Paella',
      'Oven-Baked Salmon and Green Bean Paella',
    ])
    expect(mockGenerateObject).toHaveBeenCalledTimes(2)
    // The retry names what went wrong, in the user message only.
    expect(userText(0)).not.toContain('previous attempt')
    expect(userText(1)).toContain(
      '"Classic Spanish Seafood Paella" is named after seafood (shellfish allergy)',
    )
    expect(userText(1)).toContain('"Garlic Butter Prawn & Rice Skillet"')
  })

  it('drops the salmon onigiri for a fish allergy (et-fish-allergy-sushi)', async () => {
    respond(
      recorded('et-fish-allergy-sushi', 'claude-sonnet-4-6', 2),
      recorded('et-fish-allergy-sushi', 'claude-sonnet-5-5', 2),
    )

    const result = await imagineMeals(
      'kiire õhtusöök üheks, midagi sushi moodi',
      sushiHousehold,
      'et',
    )

    expect(names(result)).not.toContain('Onigiri lõhega')
    expect(names(result)).toEqual(['Sushi kauss', 'Temaki kanapulgad', 'Teriyaki kanakauss'])
  })

  it('throws ImagineNoSafeMealsError when the retry is no better (et-vegan-sour-cream)', async () => {
    respond(
      recorded('et-vegan-sour-cream', 'claude-sonnet-4-6', 1),
      recorded('et-vegan-sour-cream', 'claude-sonnet-4-6', 3),
    )

    await expect(
      imagineMeals(
        'soe kartulisalat hapukoore ja suitsukalaga, nagu vanaema tegi',
        veganHousehold,
        'et',
      ),
    ).rejects.toBeInstanceOf(ImagineNoSafeMealsError)
    expect(mockGenerateObject).toHaveBeenCalledTimes(2)
  })

  it('returns the vegan retry when it complies (et-vegan-sour-cream)', async () => {
    respond(
      recorded('et-vegan-sour-cream', 'claude-sonnet-4-6', 1),
      recorded('et-vegan-sour-cream', 'claude-sonnet-5-5', 1),
    )

    const result = await imagineMeals('soe kartulisalat', veganHousehold, 'et')

    expect(names(result)).toEqual(names(recorded('et-vegan-sour-cream', 'claude-sonnet-5-5', 1)))
  })

  it('reports each dropped meal and constraint, with the model and attempt', async () => {
    respond(recorded('et-vegan-sour-cream', 'claude-sonnet-4-6', 1), [sampleMeal({ name: 'Tofu' })])
    const onConstraintViolation = vi.fn()

    await expect(
      imagineMeals(
        'x',
        veganHousehold,
        'et',
        undefined,
        undefined,
        undefined,
        onConstraintViolation,
      ),
    ).rejects.toBeInstanceOf(ImagineNoSafeMealsError)

    expect(onConstraintViolation).toHaveBeenCalledTimes(4)
    expect(onConstraintViolation).toHaveBeenNthCalledWith(1, {
      constraint: 'vegan',
      kind: 'diet',
      keyword: 'lõhe',
      field: 'ingredient',
      text: 'suitsulõhe',
      model: IMAGINE_MODEL,
      attempt: 1,
    })
    // `sampleMeal` is chicken stir fry: the retry's meal is dropped too.
    expect(onConstraintViolation).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'chicken', attempt: 2 }),
    )
  })

  it('does not retry when nothing was dropped, even with fewer than three meals', async () => {
    respond([sampleMeal({ name: 'Only one' })])

    const result = await imagineMeals('x', emptyHousehold, 'en')

    expect(names(result)).toEqual(['Only one'])
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('does not retry when three meals survive', async () => {
    const tofu = (name: string) =>
      sampleMeal({ name, ingredients: [{ ...sampleMeal().ingredients[1]!, name: 'tofu' }] })
    respond([tofu('A'), sampleMeal({ name: 'Chicken' }), tofu('B'), tofu('C')])

    const result = await imagineMeals('x', veganHousehold, 'en')

    expect(names(result)).toEqual(['A', 'B', 'C'])
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('does not repeat a meal the first call already kept', async () => {
    const paella = recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 2)
    respond(paella, [paella[2]!, sampleMeal({ name: 'Chicken rice' })])

    const result = await imagineMeals('x', paellaHousehold, 'en')

    expect(names(result)).toEqual([paella[2]!.name, 'Chicken rice'])
  })

  it('returns what the first call kept when the retry runs out of budget', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { meals: recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 3) },
      } as never)
      .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await imagineMeals('x', paellaHousehold, 'en')

    expect(names(result)).toEqual(['Spanish-Style Baked Fish with Tomatoes and Peppers'])
  })

  it('rethrows a failed retry when the first call kept nothing', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError')
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { meals: recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 1) },
      } as never)
      .mockRejectedValueOnce(timeout)

    await expect(imagineMeals('x', paellaHousehold, 'en')).rejects.toBe(timeout)
  })

  it('reports usage and logs a sample for both attempts', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { meals: recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 1) },
        usage: USAGE_FIXTURE,
      } as never)
      .mockResolvedValueOnce({
        object: { meals: recorded('en-shellfish-allergy-paella', 'claude-sonnet-5-5', 1) },
        usage: USAGE_FIXTURE,
      } as never)
    const onAiUsage = vi.fn()

    await imagineMeals('x', paellaHousehold, 'en', undefined, onAiUsage)

    expect(onAiUsage).toHaveBeenCalledTimes(2)
    expect(mockLogAiSample).toHaveBeenCalledTimes(2)
  })

  it('passes the same abort signal to the retry', async () => {
    respond(
      recorded('en-shellfish-allergy-paella', 'claude-sonnet-4-6', 1),
      recorded('en-shellfish-allergy-paella', 'claude-sonnet-5-5', 1),
    )
    const abortSignal = AbortSignal.timeout(40_000)

    await imagineMeals('x', paellaHousehold, 'en', undefined, undefined, abortSignal)

    expect(mockGenerateObject.mock.calls[1]![0]).toEqual(expect.objectContaining({ abortSignal }))
  })
})
