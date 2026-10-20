// @vitest-environment node
// Node, not jsdom: `jose` signs and verifies the verification-link JWT, and it
// rejects jsdom's cross-realm `Uint8Array`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every query lives in `@/lib/auth/e2e-support`, tested against a database in
// `e2e-support.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the gate, the parameters, the Better Auth links
// and the status and body each answer maps to (HON-1216).

// `RATE_LIMIT_BYPASS_ACTIVE` is computed once at module init, so we mock the
// module and re-import the route under each gate value — same shape as
// `src/app/api/e2e-seed/route.test.ts`.
const setBypass = (active: boolean) => {
  vi.doMock('@/lib/rate-limit', () => ({ RATE_LIMIT_BYPASS_ACTIVE: active }))
}

const TEST_SECRET = 'e2e-support-test-secret-at-least-32-characters'

vi.mock('@/lib/auth', () => ({
  auth: { $context: Promise.resolve({ secret: TEST_SECRET }) },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/auth/e2e-support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/e2e-support')>()),
  findPendingResetToken: vi.fn(),
  assertEmailUnverified: vi.fn(),
  readUserState: vi.fn(),
  readHouseholdState: vi.fn(),
  expirePurge: vi.fn(),
}))

import {
  assertEmailUnverified,
  E2eSupportError,
  expirePurge,
  findPendingResetToken,
  readHouseholdState,
  readUserState,
} from '@/lib/auth/e2e-support'
import { captureApiError } from '@/lib/errors'

const mockFindResetToken = vi.mocked(findPendingResetToken)
const mockAssertUnverified = vi.mocked(assertEmailUnverified)
const mockReadUserState = vi.mocked(readUserState)
const mockReadHouseholdState = vi.mocked(readHouseholdState)
const mockExpirePurge = vi.mocked(expirePurge)
const mockCaptureApiError = vi.mocked(captureApiError)

const url = (qs: string) => `http://localhost/api/e2e-support${qs}`
const post = (qs: string) => new Request(url(qs), { method: 'POST' })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockAssertUnverified.mockResolvedValue(undefined)
})

describe('/api/e2e-support — production gate', () => {
  it('GET returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false (production / staging / preview)', async () => {
    setBypass(false)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=a@b.c')))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(mockReadUserState).not.toHaveBeenCalled()
  })

  it('POST returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false', async () => {
    setBypass(false)
    const { POST } = await import('./route')

    const res = await POST(post('?action=expire-purge&email=a@b.c'))
    expect(res.status).toBe(404)
    expect(mockExpirePurge).not.toHaveBeenCalled()
  })
})

describe('GET /api/e2e-support?action=reset-token', () => {
  beforeEach(() => setBypass(true))

  it('returns 400 when email is missing', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token')))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing ?email=<value>' })
  })

  it('returns 404 when the user does not exist', async () => {
    mockFindResetToken.mockRejectedValue(new E2eSupportError('userNotFound'))
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=nobody@example.com')))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  it('returns 404 when the user has no pending reset token', async () => {
    mockFindResetToken.mockRejectedValue(new E2eSupportError('noResetToken'))
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=a@b.c')))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No pending reset token' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns the token with the Better Auth callback path', async () => {
    mockFindResetToken.mockResolvedValue({
      token: 'tok-123',
      expiresAt: new Date('2026-10-15T12:00:00.000Z'),
    })
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=%20a@b.c%20')))
    expect(mockFindResetToken).toHaveBeenCalledWith('a@b.c')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      token: 'tok-123',
      resetPath: '/api/auth/reset-password/tok-123?callbackURL=%2Freset-password',
      expiresAt: '2026-10-15T12:00:00.000Z',
    })
  })

  it('returns 500 and reports the error when the read fails', async () => {
    const error = new Error('db down')
    mockFindResetToken.mockRejectedValue(error)
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=reset-token&email=a@b.c')))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to read E2E support state' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, { route: '/api/e2e-support' })
  })
})

describe('GET /api/e2e-support?action=user-state', () => {
  beforeEach(() => setBypass(true))

  it('returns the state the lib reads, as JSON', async () => {
    mockReadUserState.mockResolvedValue({
      exists: true,
      emailVerified: false,
      deletedAt: new Date('2026-08-01T00:00:00.000Z'),
      purgeScheduledFor: new Date('2026-08-31T03:00:00.000Z'),
      householdIds: ['h1'],
      sessions: 0,
      memberships: 1,
      households: 1,
      pantryItems: 3,
      mealPlans: 1,
    })
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=a@b.c')))
    expect(mockReadUserState).toHaveBeenCalledWith('a@b.c')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      exists: true,
      emailVerified: false,
      deletedAt: '2026-08-01T00:00:00.000Z',
      purgeScheduledFor: '2026-08-31T03:00:00.000Z',
      householdIds: ['h1'],
      sessions: 0,
      memberships: 1,
      households: 1,
      pantryItems: 3,
      mealPlans: 1,
    })
  })

  it('reports exists: false for a purged account', async () => {
    mockReadUserState.mockResolvedValue({ exists: false })
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=user-state&email=gone@example.com')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: false })
  })

  it('rejects an unknown action', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=drop-tables&email=a@b.c')))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown action: drop-tables' })
    expect(mockReadUserState).not.toHaveBeenCalled()
  })
})

describe('GET /api/e2e-support?action=verify-email-link', () => {
  beforeEach(() => setBypass(true))

  it("returns Better Auth's verify-email path with a token for the address", async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=verify-email-link&email=New@Example.com')))
    expect(mockAssertUnverified).toHaveBeenCalledWith('New@Example.com')
    expect(res.status).toBe(200)
    const { verifyPath } = (await res.json()) as { verifyPath: string }
    const link = new URL(verifyPath, 'http://localhost')
    expect(link.pathname).toBe('/api/auth/verify-email')
    expect(link.searchParams.get('callbackURL')).toBe('/account?verified=1')

    // Signed with Better Auth's secret, in the shape its verify-email reads.
    const { verifyJWT } = await import('better-auth/crypto')
    const payload = await verifyJWT(link.searchParams.get('token')!, TEST_SECRET)
    expect(payload?.email).toBe('new@example.com')
    expect(payload!.exp! - payload!.iat!).toBe(60 * 60 * 24)
  })

  it('mints an already-expired token with expired=1', async () => {
    const { GET } = await import('./route')

    const res = await GET(
      new Request(url('?action=verify-email-link&email=new@example.com&expired=1')),
    )
    expect(res.status).toBe(200)
    const { verifyPath } = (await res.json()) as { verifyPath: string }
    const token = new URL(verifyPath, 'http://localhost').searchParams.get('token')!

    // Signed with the right secret, but past its expiry: `verifyJWT` rejects
    // it, and decoding the payload shows `exp` is before now.
    const { verifyJWT } = await import('better-auth/crypto')
    expect(await verifyJWT(token, TEST_SECRET)).toBeNull()
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      exp: number
    }
    expect(payload.exp).toBeLessThan(Date.now() / 1000)
  })

  it('404s for an unknown address', async () => {
    mockAssertUnverified.mockRejectedValue(new E2eSupportError('userNotFound'))
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=verify-email-link&email=none@example.com')))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  it('409s for an address that is already verified', async () => {
    mockAssertUnverified.mockRejectedValue(new E2eSupportError('alreadyVerified'))
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=verify-email-link&email=done@example.com')))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Email already verified' })
  })

  it('requires an email', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=verify-email-link')))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/e2e-support?action=change-email-link (HON-1137)', () => {
  beforeEach(() => setBypass(true))

  it("returns Better Auth's verify-email path with a change token", async () => {
    const { GET } = await import('./route')

    const res = await GET(
      new Request(url('?action=change-email-link&email=old@example.com&newEmail=new@example.com')),
    )
    expect(res.status).toBe(200)
    const { verifyPath } = (await res.json()) as { verifyPath: string }
    const link = new URL(verifyPath, 'http://localhost')
    expect(link.pathname).toBe('/api/auth/verify-email')
    expect(link.searchParams.get('callbackURL')).toBe('/account?emailChanged=1')

    const { verifyJWT } = await import('better-auth/crypto')
    const payload = await verifyJWT(link.searchParams.get('token')!, TEST_SECRET)
    expect(payload).toMatchObject({
      email: 'old@example.com',
      updateTo: 'new@example.com',
      requestType: 'change-email-verification',
    })
    expect(payload!.exp! - payload!.iat!).toBe(60 * 60 * 24)
  })

  it('mints an already-expired token with expired=1', async () => {
    const { GET } = await import('./route')

    const res = await GET(
      new Request(
        url('?action=change-email-link&email=old@example.com&newEmail=new@example.com&expired=1'),
      ),
    )
    const { verifyPath } = (await res.json()) as { verifyPath: string }
    const token = new URL(verifyPath, 'http://localhost').searchParams.get('token')!

    const { verifyJWT } = await import('better-auth/crypto')
    expect(await verifyJWT(token, TEST_SECRET)).toBeNull()
  })

  it.each([
    '?action=change-email-link&newEmail=new@example.com',
    '?action=change-email-link&email=old@example.com',
  ])('requires both addresses (%s)', async (query) => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url(query)))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/e2e-support?action=household-state', () => {
  beforeEach(() => setBypass(true))

  it('requires householdId rather than email', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state')))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing ?householdId=<value>' })
  })

  it('returns the state the lib reads, as JSON', async () => {
    mockReadHouseholdState.mockResolvedValue({
      exists: true,
      members: 2,
      pantryItems: 5,
      mealPlans: 1,
    })
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state&householdId=h1')))
    expect(mockReadHouseholdState).toHaveBeenCalledWith('h1')
    expect(await res.json()).toEqual({ exists: true, members: 2, pantryItems: 5, mealPlans: 1 })
  })

  it('answers 500 with the error contract when the read fails', async () => {
    mockReadHouseholdState.mockRejectedValue(new Error('db down'))
    const { GET } = await import('./route')

    const res = await GET(new Request(url('?action=household-state&householdId=h1')))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to read E2E support state' })
  })
})

describe('POST /api/e2e-support?action=expire-purge', () => {
  beforeEach(() => setBypass(true))

  it('back-dates the purge for the address and reports the count', async () => {
    mockExpirePurge.mockResolvedValue(1)
    const { POST } = await import('./route')

    const res = await POST(post('?action=expire-purge&email=a@b.c'))
    expect(mockExpirePurge).toHaveBeenCalledWith('a@b.c')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updated: 1 })
  })

  it('returns 404 when no soft-deleted user matches (live accounts are untouchable)', async () => {
    mockExpirePurge.mockRejectedValue(new E2eSupportError('noSoftDeletedUser'))
    const { POST } = await import('./route')

    const res = await POST(post('?action=expire-purge&email=live@example.com'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No soft-deleted user with that email' })
  })

  it('requires an email', async () => {
    const { POST } = await import('./route')

    const res = await POST(post('?action=expire-purge'))
    expect(res.status).toBe(400)
    expect(mockExpirePurge).not.toHaveBeenCalled()
  })

  it('rejects an unknown action', async () => {
    const { POST } = await import('./route')

    const res = await POST(post('?action=nuke&email=a@b.c'))
    expect(res.status).toBe(400)
    expect(mockExpirePurge).not.toHaveBeenCalled()
  })

  it('answers 500 when the write fails', async () => {
    mockExpirePurge.mockRejectedValue(new Error('db down'))
    const { POST } = await import('./route')

    const res = await POST(post('?action=expire-purge&email=a@b.c'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update E2E support state' })
  })
})
