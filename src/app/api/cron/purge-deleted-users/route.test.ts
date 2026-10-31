import { beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_SECRET = 'x'.repeat(32)

vi.mock('@/lib/env', () => ({
  // Literal (not VALID_SECRET): vi.mock factories are hoisted above the const.
  serverEnv: {
    CRON_SECRET: 'x'.repeat(32),
    NEXT_PUBLIC_APP_ENV: 'test',
  },
}))

// Which users are due, and the cap on them, live in `purgeDueUsers`, tested
// against a database in `purge-user.db.test.ts` (HON-1216, HON-1509).
vi.mock('@/lib/auth/purge-user', () => ({
  PURGE_MAX_USERS_PER_RUN: 25,
  purgeDueUsers: vi.fn(),
}))

vi.mock('@/lib/waitlist', () => ({
  purgeExpiredWaitlistRequests: vi.fn(),
}))

vi.mock('@/lib/auth/purge-expired-oauth-tokens', () => ({
  purgeExpiredOauthTokens: vi.fn(),
}))

vi.mock('@/lib/meal-images/purge-deleted-meal-images', () => ({
  purgeExpiredDeletedMealImages: vi.fn(),
}))

vi.mock('@/lib/meal-images/storage', () => ({
  discardMealImage: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { purgeExpiredOauthTokens } from '@/lib/auth/purge-expired-oauth-tokens'
import { purgeDueUsers } from '@/lib/auth/purge-user'
import { serverEnv } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { purgeExpiredDeletedMealImages } from '@/lib/meal-images/purge-deleted-meal-images'
import { discardMealImage } from '@/lib/meal-images/storage'
import { purgeExpiredWaitlistRequests } from '@/lib/waitlist'

import { GET } from './route'

const mockPurgeDue = vi.mocked(purgeDueUsers)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockPurgeWaitlist = vi.mocked(purgeExpiredWaitlistRequests)
const mockPurgeOauthTokens = vi.mocked(purgeExpiredOauthTokens)
const mockPurgeMealImages = vi.mocked(purgeExpiredDeletedMealImages)
const mockDiscardMealImage = vi.mocked(discardMealImage)
// Mutable mock env so individual tests can flip CRON_SECRET / app env.
const env = serverEnv as unknown as { CRON_SECRET?: string; NEXT_PUBLIC_APP_ENV: string }

function req(authHeader?: string) {
  return new Request('http://localhost/api/cron/purge-deleted-users', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('GET /api/cron/purge-deleted-users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.CRON_SECRET = VALID_SECRET
    env.NEXT_PUBLIC_APP_ENV = 'test'
    mockPurgeDue.mockResolvedValue({ capExceeded: false, scanned: 0, purged: 0 })
    mockPurgeWaitlist.mockResolvedValue({ unconfirmed: 0, confirmed: 0 })
    mockPurgeOauthTokens.mockResolvedValue({ accessTokens: 0, refreshTokens: 0 })
    mockPurgeMealImages.mockResolvedValue([])
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(mockPurgeDue).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer secret does not match', async () => {
    const response = await GET(req('Bearer wrong-secret'))
    expect(response.status).toBe(401)
    expect(mockPurgeDue).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is unset in production', async () => {
    env.CRON_SECRET = undefined
    env.NEXT_PUBLIC_APP_ENV = 'production'

    const response = await GET(req('Bearer anything'))
    expect(response.status).toBe(500)
  })

  it('returns 401 when CRON_SECRET is unset outside production', async () => {
    env.CRON_SECRET = undefined
    env.NEXT_PUBLIC_APP_ENV = 'dev'

    const response = await GET(req('Bearer anything'))
    expect(response.status).toBe(401)
  })

  it('purges the due users and reports the count', async () => {
    mockPurgeDue.mockResolvedValue({ capExceeded: false, scanned: 2, purged: 2 })

    const response = await GET(req(`Bearer ${VALID_SECRET}`))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      purged: 2,
      scanned: 2,
      waitlist: { unconfirmed: 0, confirmed: 0 },
      oauthTokens: { accessTokens: 0, refreshTokens: 0 },
      mealImages: 0,
    })
  })

  it('selects the users due as of the request time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T03:00:00.000Z'))

    try {
      await GET(req(`Bearer ${VALID_SECRET}`))
    } finally {
      vi.useRealTimers()
    }

    expect(mockPurgeDue.mock.calls[0]![0]).toEqual(new Date('2026-10-15T03:00:00.000Z'))
  })

  it('answers 500 when the selection fails', async () => {
    mockPurgeDue.mockRejectedValue(new Error('db down'))

    const response = await GET(req(`Bearer ${VALID_SECRET}`))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Purge failed' })
  })

  it('reports a failed purge with its user id and still answers 200', async () => {
    const failure = new Error('cascade failed')
    mockPurgeDue.mockImplementation(async (_now, onFailure) => {
      onFailure('u1', failure)
      return { capExceeded: false, scanned: 2, purged: 1 }
    })

    const response = await GET(req(`Bearer ${VALID_SECRET}`))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.purged).toBe(1)
    expect(data.scanned).toBe(2)
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/cron/purge-deleted-users',
      userId: 'u1',
    })
  })

  describe('cap on users per run (HON-1509)', () => {
    it('reports the error and answers 500 when more users are due than the cap', async () => {
      mockPurgeDue.mockResolvedValue({ capExceeded: true, due: 26 })

      const response = await GET(req(`Bearer ${VALID_SECRET}`))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Purge cap exceeded',
        due: 26,
        cap: 25,
        waitlist: { unconfirmed: 0, confirmed: 0 },
        oauthTokens: { accessTokens: 0, refreshTokens: 0 },
        mealImages: 0,
      })
      expect(mockCaptureApiError).toHaveBeenCalledWith(new Error('Purge cap exceeded'), {
        route: '/api/cron/purge-deleted-users',
        due: 26,
        cap: 25,
      })
    })

    it('still runs the waitlist, OAuth-token and image purges', async () => {
      mockPurgeDue.mockResolvedValue({ capExceeded: true, due: 26 })

      await GET(req(`Bearer ${VALID_SECRET}`))

      expect(mockPurgeWaitlist).toHaveBeenCalledTimes(1)
      expect(mockPurgeOauthTokens).toHaveBeenCalledTimes(1)
      expect(mockPurgeMealImages).toHaveBeenCalledTimes(1)
    })

    it('reports nothing when the due users are within the cap', async () => {
      mockPurgeDue.mockResolvedValue({ capExceeded: false, scanned: 25, purged: 25 })

      const response = await GET(req(`Bearer ${VALID_SECRET}`))

      expect(response.status).toBe(200)
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })
  })

  describe('waitlist retention (HON-846)', () => {
    it('purges expired waitlist requests in the same run and reports both counts', async () => {
      mockPurgeWaitlist.mockResolvedValue({ unconfirmed: 3, confirmed: 1 })

      const response = await GET(req(`Bearer ${VALID_SECRET}`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.waitlist).toEqual({ unconfirmed: 3, confirmed: 1 })
      // The same instant as the user purge, so both read one clock.
      expect(mockPurgeWaitlist).toHaveBeenCalledWith(mockPurgeDue.mock.calls[0]![0])
    })

    it('does not purge the waitlist on an unauthorized call', async () => {
      await GET(req('Bearer wrong-secret'))

      expect(mockPurgeWaitlist).not.toHaveBeenCalled()
    })

    it('answers 500 when the waitlist purge fails', async () => {
      mockPurgeWaitlist.mockRejectedValue(new Error('db down'))

      const response = await GET(req(`Bearer ${VALID_SECRET}`))

      expect(response.status).toBe(500)
    })
  })

  describe('expired OAuth tokens (HON-1165)', () => {
    it('deletes expired OAuth tokens in the same run and reports both counts', async () => {
      mockPurgeOauthTokens.mockResolvedValue({ accessTokens: 5, refreshTokens: 2 })

      const response = await GET(req(`Bearer ${VALID_SECRET}`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.oauthTokens).toEqual({ accessTokens: 5, refreshTokens: 2 })
      // The same instant as the user purge, so the run reads one clock.
      expect(mockPurgeOauthTokens).toHaveBeenCalledWith(mockPurgeDue.mock.calls[0]![0])
    })

    it('does not delete OAuth tokens on an unauthorized call', async () => {
      await GET(req('Bearer wrong-secret'))

      expect(mockPurgeOauthTokens).not.toHaveBeenCalled()
    })

    it('answers 500 when the OAuth token purge fails', async () => {
      mockPurgeOauthTokens.mockRejectedValue(new Error('db down'))

      const response = await GET(req(`Bearer ${VALID_SECRET}`))

      expect(response.status).toBe(500)
    })
  })

  describe('images of recipes past the restore window (HON-1336)', () => {
    it('clears them in the same run, discards each file, and reports the count', async () => {
      const urls = ['https://store.example/meals/a.png', 'https://store.example/meals/b.png']
      mockPurgeMealImages.mockResolvedValue(urls)

      const response = await GET(req(`Bearer ${VALID_SECRET}`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.mealImages).toBe(2)
      expect(mockDiscardMealImage.mock.calls).toEqual([
        [urls[0], '/api/cron/purge-deleted-users'],
        [urls[1], '/api/cron/purge-deleted-users'],
      ])
      // The same instant as the user purge, so the run reads one clock.
      expect(mockPurgeMealImages).toHaveBeenCalledWith(mockPurgeDue.mock.calls[0]![0])
    })

    it('does not clear images on an unauthorized call', async () => {
      await GET(req('Bearer wrong-secret'))

      expect(mockPurgeMealImages).not.toHaveBeenCalled()
    })

    it('answers 500 when the image purge fails', async () => {
      mockPurgeMealImages.mockRejectedValue(new Error('db down'))

      const response = await GET(req(`Bearer ${VALID_SECRET}`))

      expect(response.status).toBe(500)
      expect(mockDiscardMealImage).not.toHaveBeenCalled()
    })
  })
})
