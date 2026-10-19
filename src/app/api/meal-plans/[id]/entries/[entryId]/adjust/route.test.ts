import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The pipeline — the entry read, the prompt, the model call and the matching —
// lives in `@/lib/meal-planning/adjust-entry` and is tested with a mock model
// in `adjust-entry.test.ts`. This file mocks it and asserts what the route
// owns: the session, the body, the guards and the status of each answer.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/meal-planning/adjust-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-planning/adjust-entry')>()),
  loadAdjustContext: vi.fn(),
  proposeAdjustment: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 90),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import {
  AdjustEntryError,
  loadAdjustContext,
  proposeAdjustment,
} from '@/lib/meal-planning/adjust-entry'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoad = vi.mocked(loadAdjustContext)
const mockPropose = vi.mocked(proposeAdjustment)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockCap = vi.mocked(assertUnderCap)
const mockFlag = vi.mocked(getServerFlag)

const URL = 'http://localhost/api/meal-plans/plan-1/entries/entry-1/adjust'
const params = { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) }
const RESET_AT = new Date('2026-10-19T12:00:00Z')

const household = { id: 'household-1', locale: 'en', members: [], preferences: null }

const post = (body: unknown) =>
  POST(
    new Request(URL, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params,
  )

const yoghurt = {
  op: 'replace',
  original: { id: 'cream', name: 'cream' },
  originalIngredientId: 'cream',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: { id: 'yoghurt', name: 'yoghurt', defaultUnit: 'g', measuredByVolume: false },
    quantityPerServing: 50,
  },
  reason: 'Yoghurt keeps the sauce creamy.',
} as const

describe('POST /api/meal-plans/[id]/entries/[entryId]/adjust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household } as never)
    mockLoad.mockResolvedValue({ id: 'entry-1' } as never)
    mockRateLimit.mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetAt: RESET_AT,
    } as never)
    mockFlag.mockResolvedValue(true)
    mockCap.mockResolvedValue(undefined as never)
  })

  it('returns the proposals and the unmatched names, and writes nothing itself', async () => {
    mockPropose.mockResolvedValue({ changes: [yoghurt], unmatched: ['smoked tofu'] } as never)

    const response = await post({ instruction: '  No cream, use yoghurt  ' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ changes: [yoghurt], unmatched: ['smoked tofu'] })
    expect(mockPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        household,
        context: { id: 'entry-1' },
        instruction: 'No cream, use yoghurt',
        locale: 'en',
        abortSignal: expect.any(AbortSignal),
      }),
    )
    expect(mockLoad).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', 'en')
  })

  it('returns an empty list as it is', async () => {
    mockPropose.mockResolvedValue({
      changes: [],
      followInSteps: false,
      unmatched: [],
      notInMeal: [],
    })

    const response = await post({ instruction: 'Make it vegetarian' })

    expect(await response.json()).toEqual({
      changes: [],
      followInSteps: false,
      unmatched: [],
      notInMeal: [],
    })
  })

  it('counts the request against the adjust-recipe bucket', async () => {
    mockPropose.mockResolvedValue({
      changes: [],
      followInSteps: false,
      unmatched: [],
      notInMeal: [],
    })

    await post({ instruction: 'Less salt' })

    expect(mockRateLimit).toHaveBeenCalledWith('household-1', 'adjust-recipe')
  })

  it.each([
    ['an empty instruction', { instruction: '   ' }],
    ['an instruction over 500 characters', { instruction: 'x'.repeat(501) }],
    ['no instruction', {}],
    ['a body that is not JSON', '{'],
  ])('answers 400 invalid_instruction for %s', async (_label, body) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_instruction')
    expect(mockPropose).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', 404, 'entry_not_found'],
    ['no_meal', 400, 'no_meal'],
    ['not_planned', 409, 'not_planned'],
  ] as const)('maps %s to %i before the rate limit', async (reason, status, code) => {
    mockLoad.mockRejectedValue(new AdjustEntryError(reason))

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('answers 429 with the cook-question shape when the hour is used up', async () => {
    mockRateLimit.mockResolvedValue({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetAt: RESET_AT,
    } as never)

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    expect(await response.json()).toEqual({
      error: 'Rate limit exceeded',
      code: 'rate_limited',
      message: 'Maximum 30 recipe adjustments per hour',
      resetAt: RESET_AT.toISOString(),
    })
    expect(mockPropose).not.toHaveBeenCalled()
  })

  it('answers 503 generation_disabled when the kill switch is off', async () => {
    mockFlag.mockResolvedValue(false)

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('generation_disabled')
    expect(mockPropose).not.toHaveBeenCalled()
  })

  it('answers with the cap response when the month is used up', async () => {
    mockCap.mockRejectedValue(new AiCostCapExceededError(RESET_AT, 'Europe/Tallinn'))

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('ai_cap_exceeded')
    expect(mockPropose).not.toHaveBeenCalled()
  })

  it('answers 504 adjust_timeout when the budget runs out', async () => {
    mockPropose.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(504)
    expect((await response.json()).code).toBe('adjust_timeout')
  })

  it('answers 500 adjust_failed for any other failure', async () => {
    mockPropose.mockRejectedValue(new Error('boom'))

    const response = await post({ instruction: 'No cream' })

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('adjust_failed')
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null as never)

    expect((await post({ instruction: 'No cream' })).status).toBe(401)
  })
})
