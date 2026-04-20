import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetHandler = vi.fn(async () => new Response('ok-get', { status: 200 }))
const mockPostHandler = vi.fn(async () => new Response('ok-post', { status: 200 }))
const mockToNextJsHandler = vi.fn((_auth: unknown) => ({
  GET: mockGetHandler,
  POST: mockPostHandler,
}))

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>()
const mockRetryAfterSeconds = vi.fn<(...args: unknown[]) => number>()
const mockGetClientIp = vi.fn<(...args: unknown[]) => string>(() => '203.0.113.7')

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (authInstance: unknown) => mockToNextJsHandler(authInstance),
}))

vi.mock('@/lib/auth', () => ({
  auth: { __brand: 'auth-instance' },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  retryAfterSeconds: (...args: unknown[]) => mockRetryAfterSeconds(...args),
}))

vi.mock('@/lib/request-ip', () => ({
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}))

function allow() {
  return {
    allowed: true,
    limit: 5,
    remaining: 4,
    resetAt: new Date(Date.now() + 60_000),
  }
}

function deny() {
  return {
    allowed: false,
    limit: 5,
    remaining: 0,
    resetAt: new Date(Date.now() + 60_000),
  }
}

describe('Better Auth catch-all route (/api/auth/[...all])', () => {
  beforeEach(() => {
    mockGetHandler.mockClear()
    mockPostHandler.mockClear()
    mockCheckRateLimit.mockReset()
    mockRetryAfterSeconds.mockReset()
    mockGetClientIp.mockClear()
    mockRetryAfterSeconds.mockReturnValue(42)
  })

  it('wires GET and POST exports through toNextJsHandler(auth)', async () => {
    const { auth } = await import('@/lib/auth')
    const route = await import('./route')

    expect(mockToNextJsHandler).toHaveBeenCalledWith(auth)
    expect(typeof route.GET).toBe('function')
    expect(typeof route.POST).toBe('function')
  })

  it('forwards GET requests to the Better Auth handler without rate-limiting', async () => {
    const route = await import('./route')
    const request = new Request('http://localhost/api/auth/session')

    const response = await route.GET(request)

    expect(mockGetHandler).toHaveBeenCalledWith(request)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok-get')
  })

  it('forwards POST to unmatched paths without rate-limiting', async () => {
    const route = await import('./route')
    const request = new Request('http://localhost/api/auth/list-accounts', {
      method: 'POST',
    })

    const response = await route.POST(request)

    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockPostHandler).toHaveBeenCalledWith(request)
    expect(response.status).toBe(200)
  })

  it.each([
    { path: '/api/auth/sign-up/email', feature: 'sign-up' },
    { path: '/api/auth/sign-in/email', feature: 'sign-in' },
    { path: '/api/auth/request-password-reset', feature: 'forgot-password' },
  ] as const)('rate-limits $path against feature $feature', async ({ path, feature }) => {
    mockCheckRateLimit.mockResolvedValue(allow())
    const route = await import('./route')
    const request = new Request(`http://localhost${path}`, { method: 'POST' })

    const response = await route.POST(request)

    expect(mockGetClientIp).toHaveBeenCalledWith(request)
    expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.7', feature)
    expect(mockPostHandler).toHaveBeenCalledWith(request)
    expect(response.status).toBe(200)
  })

  it.each([
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/email',
    '/api/auth/request-password-reset',
  ])('returns 429 with Retry-After for %s when the limiter denies', async (path) => {
    mockCheckRateLimit.mockResolvedValue(deny())
    mockRetryAfterSeconds.mockReturnValue(120)
    const route = await import('./route')
    const request = new Request(`http://localhost${path}`, { method: 'POST' })

    const response = await route.POST(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(await response.json()).toEqual({ error: 'Too many requests' })
    expect(mockPostHandler).not.toHaveBeenCalled()
  })

  it('returns a generic 429 body that does not name the feature or account', async () => {
    // Whether the caller is hitting sign-up, sign-in, or forgot-password, the
    // 429 payload must not differ — otherwise it becomes an enumeration oracle.
    mockCheckRateLimit.mockResolvedValue(deny())
    const route = await import('./route')

    const bodies = await Promise.all(
      [
        '/api/auth/sign-up/email',
        '/api/auth/sign-in/email',
        '/api/auth/request-password-reset',
      ].map(async (path) => {
        const request = new Request(`http://localhost${path}`, {
          method: 'POST',
          body: JSON.stringify({ email: 'real@user.com', password: 'correct-horse-battery' }),
        })
        return (await route.POST(request)).text()
      }),
    )

    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).toBe('{"error":"Too many requests"}')
    expect(bodies[0]).not.toMatch(/sign-in|sign_in|sign-up|password|email|account/i)
  })
})
