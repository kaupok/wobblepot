import { describe, it, expect, vi, beforeEach } from 'vitest'

// The draw after a claim (`drawClaimedMealImage`) runs for real under
// `POST /api/meals/[id]/image` in that route's test, with only the SDKs
// mocked. This file covers what saving a recipe adds on top (HON-1364): the
// claim in the request, and the gates that run after the response. Every
// query is mocked here; `persist.db.test.ts` runs them against a database.

const env = vi.hoisted(() => ({ OPENAI_API_KEY: 'sk-test' as string | undefined }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({ serverEnv: env }))

vi.mock('@/lib/meal-images/persist', () => ({
  loadMealForImage: vi.fn(),
  claimMealImage: vi.fn(),
  attachMealImage: vi.fn(),
  releaseMealImageClaim: vi.fn(),
  markMealImageFailed: vi.fn(),
}))

vi.mock('@/lib/meal-images/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-images/generate')>()),
  generateMealImage: vi.fn(),
}))

vi.mock('@/lib/meal-images/storage', () => ({
  putMealImage: vi.fn(),
  discardMealImage: vi.fn(),
}))

vi.mock('@/lib/meal-images/colour', () => ({
  extractHue: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
  recordAiUsage: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import {
  attachMealImage,
  claimMealImage,
  loadMealForImage,
  markMealImageFailed,
  releaseMealImageClaim,
  type ImageClaim,
  type MealForImage,
} from '@/lib/meal-images/persist'
import { generateMealImage } from '@/lib/meal-images/generate'
import { putMealImage } from '@/lib/meal-images/storage'
import { extractHue } from '@/lib/meal-images/colour'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { captureApiError } from '@/lib/errors'
import { claimSavedMealImage, drawSavedMealImage } from './start'

const mockLoadMeal = vi.mocked(loadMealForImage)
const mockClaim = vi.mocked(claimMealImage)
const mockAttach = vi.mocked(attachMealImage)
const mockRelease = vi.mocked(releaseMealImageClaim)
const mockMarkFailed = vi.mocked(markMealImageFailed)
const mockGenerate = vi.mocked(generateMealImage)
const mockPut = vi.mocked(putMealImage)
const mockExtractHue = vi.mocked(extractHue)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockGetServerFlag = vi.mocked(getServerFlag)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockRecordAiUsage = vi.mocked(recordAiUsage)
const mockCaptureApiError = vi.mocked(captureApiError)

const HOUSEHOLD_ID = 'household-123'
const ROUTE = '/api/households/me/meals'
const BLOB_URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1-abc.png'
const EDITED_AT = new Date('2026-10-28T10:00:00Z')

const meal: MealForImage = {
  id: 'meal-1',
  name: 'Tomato pasta',
  description: null,
  preparationNotes: null,
  householdId: HOUSEHOLD_ID,
  updatedAt: EDITED_AT,
  imageUrl: null,
  imageStatus: 'none',
  imageHue: null,
  imagePromptVersion: null,
  imageClaimedAt: null,
  imageAttempts: 0,
  components: [
    {
      quantityPerServing: 100,
      ingredient: { name: 'pasta', defaultUnit: 'g', gramsPerPiece: null, densityGPerMl: null },
    },
  ],
}

const claim: ImageClaim = {
  mealId: 'meal-1',
  claimedAt: new Date('2026-10-28T10:00:01Z'),
  updatedAt: EDITED_AT,
  redraw: false,
}

const context = { householdId: HOUSEHOLD_ID, userId: 'user-123', route: ROUTE }

beforeEach(() => {
  vi.clearAllMocks()
  env.OPENAI_API_KEY = 'sk-test'
  mockLoadMeal.mockResolvedValue(meal)
  mockClaim.mockResolvedValue(claim)
  mockCheckRateLimit.mockResolvedValue({ allowed: true } as never)
  mockGetServerFlag.mockResolvedValue(true)
  mockAssertUnderCap.mockResolvedValue(undefined as never)
  mockGenerate.mockImplementation(async (_input, options) => {
    await options?.onUsage?.({ model: 'gpt-image-1', costUsd: 0.04 } as never)
    return { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png', vessel: null } as never
  })
  mockPut.mockResolvedValue(BLOB_URL)
  mockExtractHue.mockResolvedValue({ hue: 30 } as never)
  mockAttach.mockResolvedValue(true)
  mockRelease.mockResolvedValue(true)
  mockMarkFailed.mockResolvedValue(true)
})

describe('claimSavedMealImage', () => {
  it('claims the saved recipe’s image', async () => {
    const result = await claimSavedMealImage(HOUSEHOLD_ID, 'meal-1', ROUTE)

    expect(result).toEqual({ meal, claim })
    expect(mockLoadMeal).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-1')
    expect(mockClaim).toHaveBeenCalledExactlyOnceWith(meal, expect.any(Date))
  })

  it('claims nothing without an OpenAI key', async () => {
    env.OPENAI_API_KEY = undefined

    expect(await claimSavedMealImage(HOUSEHOLD_ID, 'meal-1', ROUTE)).toBeNull()
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('claims nothing for a global meal', async () => {
    mockLoadMeal.mockResolvedValue({ ...meal, householdId: null })

    expect(await claimSavedMealImage(HOUSEHOLD_ID, 'meal-1', ROUTE)).toBeNull()
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('logs a claim that throws and returns null, so the save still answers', async () => {
    const error = new Error('connection lost')
    mockClaim.mockRejectedValue(error)

    expect(await claimSavedMealImage(HOUSEHOLD_ID, 'meal-1', ROUTE)).toBeNull()
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: ROUTE,
      operation: 'meal-image-claim',
      householdId: HOUSEHOLD_ID,
      mealId: 'meal-1',
    })
  })

  it('returns null when another request holds the claim', async () => {
    mockClaim.mockResolvedValue(null)

    expect(await claimSavedMealImage(HOUSEHOLD_ID, 'meal-1', ROUTE)).toBeNull()
  })
})

describe('drawSavedMealImage', () => {
  it('draws and attaches the image, and records the spend on the household', async () => {
    await drawSavedMealImage({ meal, claim }, context)

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockAttach).toHaveBeenCalledExactlyOnceWith(claim, {
      url: BLOB_URL,
      hue: 30,
      vessel: null,
    })
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: HOUSEHOLD_ID, feature: 'meal_image' }),
    )
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('checks the kill-switch for the user who saved', async () => {
    await drawSavedMealImage({ meal, claim }, context)

    expect(mockCheckRateLimit).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-image')
    expect(mockGetServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-123')
    expect(mockAssertUnderCap).toHaveBeenCalledWith(HOUSEHOLD_ID)
  })

  it.each([
    ['rate-limited', () => mockCheckRateLimit.mockResolvedValue({ allowed: false } as never)],
    ['ai_generation_enabled is off', () => mockGetServerFlag.mockResolvedValue(false)],
    [
      'over the AI cap',
      () =>
        mockAssertUnderCap.mockRejectedValue(
          new AiCostCapExceededError(new Date(), 'Europe/Tallinn'),
        ),
    ],
  ])('gives the claim back without drawing when %s', async (_label, arrange) => {
    arrange()

    await drawSavedMealImage({ meal, claim }, context)

    expect(mockRelease).toHaveBeenCalledExactlyOnceWith(claim)
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('logs a gate that throws, gives the claim back, and does not throw', async () => {
    const error = new Error('flag service down')
    mockGetServerFlag.mockRejectedValue(error)

    await expect(drawSavedMealImage({ meal, claim }, context)).resolves.toBeUndefined()

    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: ROUTE,
      userId: 'user-123',
      feature: 'meal_image',
      householdId: HOUSEHOLD_ID,
    })
    expect(mockRelease).toHaveBeenCalledExactlyOnceWith(claim)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('logs a failed generation, marks the image failed, and does not throw', async () => {
    const error = new Error('model refused')
    mockGenerate.mockRejectedValue(error)

    await expect(drawSavedMealImage({ meal, claim }, context)).resolves.toBeUndefined()

    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: ROUTE,
      userId: 'user-123',
      feature: 'meal_image',
      householdId: HOUSEHOLD_ID,
    })
    expect(mockMarkFailed).toHaveBeenCalledExactlyOnceWith(claim, { countAttempt: true })
    expect(mockAttach).not.toHaveBeenCalled()
  })
})
