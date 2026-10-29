import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// What the export holds and redacts lives in `@/lib/auth/export`, tested
// against a database in `export.db.test.ts`. This file mocks that module at
// the seam and asserts what the route owns: the session, the rate limit, the
// envelope and the attachment headers (HON-1216).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 86_400),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/auth/export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/export')>()),
  exportUserData: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { exportUserData, type UserDataExport } from '@/lib/auth/export'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockExportUserData = vi.mocked(exportUserData)

const payload = {
  user: {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    acceptedTermsAt: null,
    acceptedTermsVersion: null,
    sessions: [],
    connectedApps: [],
  },
  households: [],
} as unknown as UserDataExport

function authedAs(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: 'Jane Doe', email: 'jane@example.com' },
    session: { id: 'session-1' },
  } as never)
}

describe('GET /api/auth/user/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authedAs('user-1')
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAt: new Date(Date.now() + 86_400_000),
    })
    mockExportUserData.mockResolvedValue(payload)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockExportUserData).not.toHaveBeenCalled()
  })

  it('rate-limits the user-id dimension and returns 429 with Retry-After', async () => {
    authedAs('user-429')
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: new Date('2026-04-21T00:00:00.000Z'),
    })

    const response = await GET()

    expect(mockCheckRateLimit).toHaveBeenCalledWith('user-429', 'data-export')
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('86400')
    expect(await response.json()).toEqual({
      error: 'Rate limit exceeded',
      message: 'Maximum 3 data exports per day',
      resetAt: '2026-04-21T00:00:00.000Z',
    })
    expect(mockExportUserData).not.toHaveBeenCalled()
  })

  it("wraps the session user's export in a versioned envelope", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-15T09:30:00.000Z'))

    try {
      const response = await GET()

      expect(mockExportUserData).toHaveBeenCalledWith('user-1')
      expect(response.status).toBe(200)
      expect(JSON.parse(await response.text())).toEqual({
        schemaVersion: 1,
        exportedAt: '2026-07-15T09:30:00.000Z',
        user: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          emailVerified: true,
          image: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
          acceptedTermsAt: null,
          acceptedTermsVersion: null,
          sessions: [],
          connectedApps: [],
        },
        households: [],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sets Content-Disposition attachment header with userId + YYYY-MM-DD filename', async () => {
    authedAs('user-attach')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-15T09:30:00.000Z'))

    try {
      const response = await GET()

      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="wobblepot-export-user-attach-2026-07-15.json"',
      )
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns 500 and reports the error when the export read fails', async () => {
    const error = new Error('User not found')
    mockExportUserData.mockRejectedValue(error)

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to export data' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/auth/user/export',
      userId: 'user-1',
    })
  })
})
