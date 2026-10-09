import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

vi.mock('@/lib/household-claim', () => ({
  runHouseholdClaim: vi.fn(),
}))

// The error classes stay real, so the route's `instanceof` checks are the ones
// under test. `household-leave.test.ts` owns the leave rules themselves.
vi.mock('@/lib/household-leave', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/household-leave')>()),
  leaveHousehold: vi.fn(),
  afterHouseholdLeft: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { runHouseholdClaim } from '@/lib/household-claim'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  afterHouseholdLeft,
  leaveHousehold,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
} from '@/lib/household-leave'
import { POST } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockRunHouseholdClaim = vi.mocked(runHouseholdClaim)
const mockLeaveHousehold = vi.mocked(leaveHousehold)
const mockAfterHouseholdLeft = vi.mocked(afterHouseholdLeft)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const ALLOWED = { allowed: true, limit: 3, remaining: 2, resetAt: new Date('2030-01-01') }

const SESSION = {
  user: { id: 'user-1', name: 'Mari', email: 'mari@example.com' },
  session: { id: 'session-1' },
}
const tx = { marker: 'tx' }

describe('POST /api/households/me/leave', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetSession.mockResolvedValue(SESSION as never)
    mockCheckRateLimit.mockResolvedValue(ALLOWED)
    mockRunHouseholdClaim.mockImplementation((_userId, callback) =>
      (callback as (client: unknown) => Promise<unknown>)(tx),
    )
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST()

    expect(response.status).toBe(401)
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it("leaves under the user's own claim lock and reports the result", async () => {
    const result = {
      householdId: 'household-1',
      role: 'member' as const,
      deletedHousehold: false,
      imageUrls: [],
    }
    mockLeaveHousehold.mockResolvedValue(result)

    const response = await POST()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deletedHousehold: false })
    expect(mockRunHouseholdClaim).toHaveBeenCalledWith('user-1', expect.any(Function))
    expect(mockLeaveHousehold).toHaveBeenCalledWith(tx, 'user-1')
    expect(mockAfterHouseholdLeft).toHaveBeenCalledWith(result, {
      route: '/api/households/me/leave',
      userId: 'user-1',
    })
  })

  it('reports a deleted household for a sole-account owner', async () => {
    mockLeaveHousehold.mockResolvedValue({
      householdId: 'household-1',
      role: 'owner',
      deletedHousehold: true,
      imageUrls: [],
    })

    const response = await POST()

    expect(await response.json()).toEqual({ deletedHousehold: true })
  })

  it('returns 429 once the user has used their leaves, before touching the household', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...ALLOWED, allowed: false, remaining: 0 })

    const response = await POST()

    // Leaving and onboarding again would reset the household's AI spend cap.
    expect(mockCheckRateLimit).toHaveBeenCalledWith('user-1', 'household-leave')
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect((await response.json()).error).toBe('rate_limited')
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns 404 no_household when the user has no household', async () => {
    mockLeaveHousehold.mockRejectedValue(new NotInHouseholdError())

    const response = await POST()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'no_household' })
    expect(mockAfterHouseholdLeft).not.toHaveBeenCalled()
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 409 with the count when the owner has other account holders', async () => {
    mockLeaveHousehold.mockRejectedValue(new OwnerHasOtherAccountsError(2))

    const response = await POST()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'owner_has_other_accounts', count: 2 })
    expect(mockAfterHouseholdLeft).not.toHaveBeenCalled()
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports any other failure', async () => {
    mockLeaveHousehold.mockRejectedValue(new Error('connection lost'))

    const response = await POST()

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})
