import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Prisma } from '@/generated/prisma/client'

import { POST } from './route'

// The household create, its claim lock and its rows live in
// `@/lib/household-claim`: the lock and retry are tested in
// `household-claim.test.ts`, the rows against a database in
// `household-claim.db.test.ts`. This file mocks `createHousehold` at the seam
// and asserts what the route owns: the session, body validation, the locale
// it picks, and the status and body each answer maps to (HON-1213).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/household-claim', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-claim')>()),
  createHousehold: vi.fn(),
}))

import { headers } from 'next/headers'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { AlreadyInHouseholdError, createHousehold } from '@/lib/household-claim'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreateHousehold = vi.mocked(createHousehold)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const PREFERENCES = { id: 'prefs-123', allergensToAvoid: [], weekdayMealTypes: ['dinner'] }

const HOUSEHOLD = {
  id: 'household-123',
  name: 'My Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  preferences: PREFERENCES,
}

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/households', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

/** What `createHousehold` was asked to create. */
const created = () => mockCreateHousehold.mock.calls[0]![1]

const ALREADY_IN_HOUSEHOLD = {
  status: 400,
  body: { error: 'already_in_household', message: 'You are already a member of a household.' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockCreateHousehold.mockResolvedValue(HOUSEHOLD as never)
})

describe('POST /api/households', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ name: 'My Household' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
  })

  it('answers 400 for invalid JSON', async () => {
    expect(await answer(post('{not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it.each([
    ['a missing name', {}, 'name'],
    ['an empty name', { name: '' }, 'name'],
    ['a name over 100 characters', { name: 'a'.repeat(101) }, 'name'],
    // One past the route's bound. Each member costs writes inside the claim
    // transaction, re-run once per retry, so the rejection comes first.
    [
      'more than 20 additional members',
      { name: 'Home', members: Array.from({ length: 21 }, (_, i) => ({ name: `M${i}` })) },
      'members',
    ],
    [
      'an unknown allergen',
      { name: 'Home', allergensToAvoid: ['nuts', 'kiwi'] },
      'allergensToAvoid',
    ],
    [
      'more allergens than exist',
      { name: 'Home', allergensToAvoid: Array(10).fill('nuts') },
      'allergensToAvoid',
    ],
  ])('answers 400 for %s, and creates nothing', async (_label, body, field) => {
    const { status, body: answered } = await answer(post(body))

    expect(status).toBe(400)
    expect(answered.error).toBe('Validation failed')
    expect(Object.keys(answered.details)).toEqual([field])
    expect(mockCreateHousehold).not.toHaveBeenCalled()
  })

  it('creates the household for the session user and answers 201 with it', async () => {
    expect(await answer(post({ name: 'My Household' }))).toEqual({
      status: 201,
      body: JSON.parse(JSON.stringify(HOUSEHOLD)),
    })
    expect(mockCreateHousehold).toHaveBeenCalledWith('user-123', {
      name: 'My Household',
      locale: 'en',
    })
  })

  it('passes the members, each an adult unless it says child, and the allergens', async () => {
    await post({
      name: 'Home',
      members: [{ name: 'Partner' }, { name: 'Kid', portionType: 'child' }],
      allergensToAvoid: ['nuts', 'sesame'],
      unknown: 'dropped',
    })

    expect(created()).toEqual({
      name: 'Home',
      locale: 'en',
      members: [
        { name: 'Partner', portionType: 'adult' },
        { name: 'Kid', portionType: 'child' },
      ],
      allergensToAvoid: ['nuts', 'sesame'],
    })
  })

  it('accepts a members array exactly at the bound', async () => {
    const members = Array.from({ length: 20 }, (_, i) => ({ name: `M${i}` }))

    expect((await answer(post({ name: 'Home', members }))).status).toBe(201)
    expect(created().members).toHaveLength(20)
  })

  describe('the locale it stores (HON-549)', () => {
    it.each([
      ['et,en;q=0.9', 'et'],
      ['et-EE', 'et'],
      ['fr-FR,fr;q=0.9', 'en'],
    ])('stores %s as %s', async (acceptLanguage, locale) => {
      vi.mocked(headers).mockResolvedValueOnce(
        new Headers({ 'accept-language': acceptLanguage }) as never,
      )

      await post({ name: 'Home' })

      expect(created().locale).toBe(locale)
    })

    it('stores the default locale when the request has no Accept-Language', async () => {
      await post({ name: 'Home' })

      expect(created().locale).toBe('en')
    })
  })

  it('answers already_in_household when the user has a household', async () => {
    mockCreateHousehold.mockRejectedValue(new AlreadyInHouseholdError())

    expect(await answer(post({ name: 'Home' }))).toEqual(ALREADY_IN_HOUSEHOLD)
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  // A concurrent create or invite join committed a membership after the
  // check ran, and the unique index rejected the owner row (HON-696).
  // `OnboardingFlow` branches on the string, so the answer is the same.
  it('maps a unique-index rejection of the owner row to already_in_household, not a 500', async () => {
    mockCreateHousehold.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`userId`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { modelName: 'HouseholdMember', target: ['userId'] },
        },
      ),
    )

    expect(await answer(post({ name: 'Home' }))).toEqual(ALREADY_IN_HOUSEHOLD)
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  describe('a failed create', () => {
    const databaseDown = new Error('connection terminated unexpectedly')

    beforeEach(() => {
      mockCreateHousehold.mockRejectedValue(databaseDown)
      // Hermetic against a developer who has the capture opt-in set in `.env`:
      // it makes `shouldSkipLocalCapture()` false whatever the release.
      vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    // A rethrow would let Next render an HTML error page, which reaches
    // `OnboardingFlow` with no `error` to branch on, and nothing is reported.
    it('answers a reported JSON 500', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(await answer(post({ name: 'Home' }))).toEqual({
        status: 500,
        body: { error: 'Failed to create household' },
      })
      expect(mockCaptureApiError).toHaveBeenCalledWith(databaseDown, {
        route: '/api/households',
        userId: 'user-123',
      })
    })

    // Capture returns early on a dev server or a local E2E run, so without
    // this log a failed onboarding create leaves no trace at all (HON-838).
    it('logs the error on a local machine, where capture is skipped', async () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await post({ name: 'Home' })

      expect(consoleError).toHaveBeenCalledWith(expect.any(String), databaseDown)
    })

    it('does not log in a deployment, which reports to PostHog instead', async () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await post({ name: 'Home' })

      expect(consoleError).not.toHaveBeenCalled()
    })
  })
})
