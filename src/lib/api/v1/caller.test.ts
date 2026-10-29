import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-keys', () => ({
  API_KEY_PATTERN: /^wp_[A-Za-z0-9]{32}$/,
  verifyApiKey: vi.fn(),
  isActiveApiKeyUser: vi.fn(),
}))
vi.mock('@/lib/household', () => ({ getHouseholdMembership: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(), retryAfterSeconds: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { isActiveApiKeyUser, verifyApiKey } from '@/lib/api-keys'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { ToolInputError } from '@/lib/mcp/context'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { mcpHousehold } from '@/test/mcp'

import { resolveApiKeyCaller, serveApiRead } from './caller'

const KEY = 'wp_abcdefghijklmnopqrstuvwxyz012345'
const ROUTE = '/api/v1/test'
const household = mcpHousehold({ id: 'household-1' })

function request(authorization?: string) {
  return new Request('http://localhost:3000/api/v1/test', {
    headers: {
      'x-forwarded-for': '203.0.113.7',
      ...(authorization ? { authorization } : {}),
    },
  })
}

async function errorOf(result: unknown) {
  expect(result).toBeInstanceOf(Response)
  const response = result as Response
  return { status: response.status, body: await response.json(), headers: response.headers }
}

describe('resolveApiKeyCaller (HON-1220)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: 'user-1' })
    vi.mocked(isActiveApiKeyUser).mockResolvedValue(true)
    vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(),
    })
  })

  it('resolves the household of a valid key', async () => {
    expect(await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE)).toEqual({
      userId: 'user-1',
      household,
    })
    expect(verifyApiKey).toHaveBeenCalledWith(KEY)
  })

  it('accepts the scheme in any case', async () => {
    await resolveApiKeyCaller(request(`bearer ${KEY}`), ROUTE)
    expect(verifyApiKey).toHaveBeenCalledWith(KEY)
  })

  it.each([
    ['no header', undefined],
    ['another scheme', `Basic ${KEY}`],
    ['no key after the scheme', 'Bearer '],
    ['a malformed key', 'Bearer wp_short'],
  ])('answers 401 invalid_key for %s, without a lookup', async (_label, header) => {
    const { status, body, headers } = await errorOf(
      await resolveApiKeyCaller(request(header), ROUTE),
    )

    expect(status).toBe(401)
    expect(body.code).toBe('invalid_key')
    expect(headers.get('cache-control')).toBe('no-store')
    expect(verifyApiKey).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("answers 429 from the client IP's bucket before it looks the key up", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      limit: 600,
      remaining: 0,
      resetAt: new Date('2026-10-14T12:00:00Z'),
    })
    vi.mocked(retryAfterSeconds).mockReturnValue(30)

    const { status, body, headers } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(429)
    expect(body.code).toBe('rate_limited')
    expect(headers.get('retry-after')).toBe('30')
    expect(checkRateLimit).toHaveBeenCalledWith('203.0.113.7', 'api-key-ip')
    expect(verifyApiKey).not.toHaveBeenCalled()
  })

  it('answers 401 invalid_key for an unknown or revoked key', async () => {
    vi.mocked(verifyApiKey).mockResolvedValue(null)

    const { status, body } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(401)
    expect(body.code).toBe('invalid_key')
  })

  it('answers 401 invalid_key for an account waiting for deletion', async () => {
    vi.mocked(isActiveApiKeyUser).mockResolvedValue(false)

    const { status, body } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(401)
    expect(body.code).toBe('invalid_key')
    expect(checkRateLimit).not.toHaveBeenCalledWith(expect.anything(), 'api-key')
  })

  it('answers 403 no_household with the MCP wording for an account without a household', async () => {
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    const { status, body } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(403)
    expect(body).toEqual({
      code: 'no_household',
      error: 'This account has no household yet. Finish onboarding in Wobblepot first.',
    })
  })

  it('answers 429 rate_limited with Retry-After from the api-key bucket, never mcp', async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (_id, feature) => ({
      allowed: feature !== 'api-key',
      limit: 120,
      remaining: 0,
      resetAt: new Date('2026-10-14T12:00:00Z'),
    }))
    vi.mocked(retryAfterSeconds).mockReturnValue(42)

    const { status, body, headers } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(429)
    expect(body.code).toBe('rate_limited')
    expect(headers.get('retry-after')).toBe('42')
    expect(checkRateLimit).toHaveBeenCalledWith('household-1', 'api-key')
    expect(checkRateLimit).not.toHaveBeenCalledWith(expect.anything(), 'mcp')
  })

  it('reports a failed lookup and answers 500 internal_error', async () => {
    const failure = new Error('database down')
    vi.mocked(verifyApiKey).mockRejectedValue(failure)

    const { status, body } = await errorOf(
      await resolveApiKeyCaller(request(`Bearer ${KEY}`), ROUTE),
    )

    expect(status).toBe(500)
    expect(body.code).toBe('internal_error')
    expect(captureApiError).toHaveBeenCalledWith(failure, { route: ROUTE })
  })
})

describe('serveApiRead (HON-1220)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: 'user-1' })
    vi.mocked(isActiveApiKeyUser).mockResolvedValue(true)
    vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(),
    })
  })

  it('answers the read as JSON that no one may cache, with no CORS header', async () => {
    const read = vi.fn().mockResolvedValue({ hello: 'world' })

    const response = await serveApiRead(request(`Bearer ${KEY}`), ROUTE, read)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hello: 'world' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(read).toHaveBeenCalledWith(household)
  })

  it('does not run the read for a refused caller', async () => {
    const read = vi.fn()

    const response = await serveApiRead(request(), ROUTE, read)

    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
  })

  it('answers 400 bad_request with a ToolInputError message, unreported', async () => {
    const read = vi
      .fn()
      .mockRejectedValue(new ToolInputError('Ask for 31 days or fewer in one call.'))

    const response = await serveApiRead(request(`Bearer ${KEY}`), ROUTE, read)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'bad_request',
      error: 'Ask for 31 days or fewer in one call.',
    })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('reports any other failure and answers 500 internal_error', async () => {
    const failure = new Error('boom')
    const read = vi.fn().mockRejectedValue(failure)

    const response = await serveApiRead(request(`Bearer ${KEY}`), ROUTE, read)

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('internal_error')
    expect(captureApiError).toHaveBeenCalledWith(failure, {
      route: ROUTE,
      userId: 'user-1',
      householdId: 'household-1',
    })
  })
})
