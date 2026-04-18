import { describe, it, expect, vi } from 'vitest'

const mockGetHandler = vi.fn(async () => new Response('ok-get', { status: 200 }))
const mockPostHandler = vi.fn(async () => new Response('ok-post', { status: 200 }))
const mockToNextJsHandler = vi.fn((_auth: unknown) => ({
  GET: mockGetHandler,
  POST: mockPostHandler,
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (authInstance: unknown) => mockToNextJsHandler(authInstance),
}))

vi.mock('@/lib/auth', () => ({
  auth: { __brand: 'auth-instance' },
}))

describe('Better Auth catch-all route (/api/auth/[...all])', () => {
  it('wires GET and POST exports through toNextJsHandler(auth)', async () => {
    const { auth } = await import('@/lib/auth')
    const route = await import('./route')

    expect(mockToNextJsHandler).toHaveBeenCalledTimes(1)
    expect(mockToNextJsHandler).toHaveBeenCalledWith(auth)
    expect(typeof route.GET).toBe('function')
    expect(typeof route.POST).toBe('function')
  })

  it('forwards GET requests to the Better Auth handler', async () => {
    const route = await import('./route')
    const request = new Request('http://localhost/api/auth/session')

    const response = await route.GET(request)

    expect(mockGetHandler).toHaveBeenCalledWith(request)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok-get')
  })

  it('forwards POST requests to the Better Auth handler', async () => {
    const route = await import('./route')
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
    })

    const response = await route.POST(request)

    expect(mockPostHandler).toHaveBeenCalledWith(request)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok-post')
  })
})
