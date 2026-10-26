import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_SECRET = 'x'.repeat(32)

vi.mock('@/lib/env', () => ({
  // Literal (not VALID_SECRET): vi.mock factories are hoisted above the const.
  serverEnv: {
    CRON_SECRET: 'x'.repeat(32),
    NEXT_PUBLIC_APP_ENV: 'test',
  },
}))

// Which users are due lives in `findUsersDueForPurge`, tested against a
// database in `purge-user.db.test.ts` (HON-1216).
vi.mock('@/lib/auth/purge-user', () => ({
  findUsersDueForPurge: vi.fn(),
  purgeUser: vi.fn(),
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

import { GET } from './route'
import { serverEnv } from '@/lib/env'
import { findUsersDueForPurge, purgeUser } from '@/lib/auth/purge-user'
import { purgeExpiredWaitlistRequests } from '@/lib/waitlist'
import { purgeExpiredOauthTokens } from '@/lib/auth/purge-expired-oauth-tokens'
import { purgeExpiredDeletedMealImages } from '@/lib/meal-images/purge-deleted-meal-images'
import { discardMealImage } from '@/lib/meal-images/storage'

const mockFindDue = vi.mocked(findUsersDueForPurge)
const mockPurgeUser = vi.mocked(purgeUser)
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
    mockFindDue.mockResolvedValue([])
    mockPurgeWaitlist.mockResolvedValue({ unconfirmed: 0, confirmed: 0 })
    mockPurgeOauthTokens.mockResolvedValue({ accessTokens: 0, refreshTokens: 0 })
    mockPurgeMealImages.mockResolvedValue([])
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(mockFindDue).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer secret does not match', async () => {
    const response = await GET(req('Bearer wrong-secret'))
    expect(response.status).toBe(401)
    expect(mockPurgeUser).not.toHaveBeenCalled()
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

  it('purges every expired user and reports the count', async () => {
    mockFindDue.mockResolvedValue(['u1', 'u2'])

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
    expect(mockPurgeUser).toHaveBeenCalledTimes(2)
    expect(mockPurgeUser).toHaveBeenCalledWith('u1')
    expect(mockPurgeUser).toHaveBeenCalledWith('u2')
  })

  it('selects the users due as of the request time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T03:00:00.000Z'))

    try {
      await GET(req(`Bearer ${VALID_SECRET}`))
    } finally {
      vi.useRealTimers()
    }

    expect(mockFindDue).toHaveBeenCalledWith(new Date('2026-10-15T03:00:00.000Z'))
  })

  it('answers 500 when the selection fails, and purges no one', async () => {
    mockFindDue.mockRejectedValue(new Error('db down'))

    const response = await GET(req(`Bearer ${VALID_SECRET}`))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Purge failed' })
    expect(mockPurgeUser).not.toHaveBeenCalled()
  })

  it('continues the batch when one purge fails (partial count, still 200)', async () => {
    mockFindDue.mockResolvedValue(['u1', 'u2'])
    mockPurgeUser.mockRejectedValueOnce(new Error('cascade failed'))

    const response = await GET(req(`Bearer ${VALID_SECRET}`))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.purged).toBe(1)
    expect(data.scanned).toBe(2)
  })

  describe('waitlist retention (HON-846)', () => {
    it('purges expired waitlist requests in the same run and reports both counts', async () => {
      mockPurgeWaitlist.mockResolvedValue({ unconfirmed: 3, confirmed: 1 })

      const response = await GET(req(`Bearer ${VALID_SECRET}`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.waitlist).toEqual({ unconfirmed: 3, confirmed: 1 })
      // The same instant as the user purge, so both read one clock.
      expect(mockPurgeWaitlist).toHaveBeenCalledWith(mockFindDue.mock.calls[0]![0])
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
      expect(mockPurgeOauthTokens).toHaveBeenCalledWith(mockFindDue.mock.calls[0]![0])
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
      expect(mockPurgeMealImages).toHaveBeenCalledWith(mockFindDue.mock.calls[0]![0])
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
