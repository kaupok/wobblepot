import { beforeEach, describe, expect, it, vi } from 'vitest'

// The work after the response is `processWaitlistRequest` in `@/lib/waitlist`:
// its queries are tested against a database in `waitlist.db.test.ts`, its
// email in `waitlist.test.ts`. This file mocks it at the seam and asserts what
// the route owns: validation, the limit, the flag, the arguments it hands to
// `after()`, and the status and body (HON-1217).

// `after()` callbacks are collected and run by the test, so a case can assert
// on the response before any of the work has happened, as in production.
const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback)
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 3600),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/waitlist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waitlist')>()),
  processWaitlistRequest: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { captureApiError } from '@/lib/errors'
import { getServerFlag } from '@/lib/feature-flags'
import { checkRateLimit } from '@/lib/rate-limit'
import { processWaitlistRequest } from '@/lib/waitlist'

import { POST } from './route'

const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockGetServerFlag = vi.mocked(getServerFlag)
const mockProcess = vi.mocked(processWaitlistRequest)

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function runAfter() {
  const callbacks = afterCallbacks.splice(0)
  for (const callback of callbacks) await callback()
}

const ALLOWED = { allowed: true, limit: 3, remaining: 2, resetAt: new Date() }

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterCallbacks.length = 0
    mockCheckRateLimit.mockResolvedValue(ALLOWED)
    mockGetServerFlag.mockResolvedValue(true)
    mockProcess.mockResolvedValue()
  })

  describe('rejections', () => {
    it.each([
      ['a malformed address', { email: 'not-an-email' }],
      ['a missing address', {}],
      ['a non-JSON body', 'not json'],
    ])('answers 400 for %s', async (_label, body) => {
      const response = await POST(req(body))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid email' })
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 429 with Retry-After over the per-IP limit', async () => {
      mockCheckRateLimit.mockResolvedValue({ ...ALLOWED, allowed: false, remaining: 0 })

      const response = await POST(req({ email: 'new@example.com' }))

      expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.7', 'waitlist')
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('3600')
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 500 with a JSON error when a dependency throws', async () => {
      const failure = new Error('flag service down')
      mockGetServerFlag.mockRejectedValue(failure)

      const response = await POST(req({ email: 'new@example.com' }))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Request failed' })
      expect(captureApiError).toHaveBeenCalledWith(failure, { route: '/api/waitlist' })
      expect(afterCallbacks).toHaveLength(0)
    })

    it('answers 409 when sign-up is open', async () => {
      mockGetServerFlag.mockResolvedValue(false)

      const response = await POST(req({ email: 'new@example.com' }))

      expect(mockGetServerFlag).toHaveBeenCalledWith('invite_code_required', 'anonymous')
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'Sign-up is open' })
      expect(afterCallbacks).toHaveLength(0)
    })
  })

  describe('accepted requests', () => {
    it('answers { ok: true } before the request is processed', async () => {
      const response = await POST(req({ email: 'new@example.com', locale: 'en' }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(mockProcess).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(1)
    })

    it('processes the address trimmed and lowercased, in the page locale', async () => {
      await POST(req({ email: '  New.Person@Example.COM ', locale: 'et' }))
      await runAfter()

      expect(mockProcess).toHaveBeenCalledTimes(1)
      expect(mockProcess).toHaveBeenCalledWith({
        email: 'new.person@example.com',
        locale: 'et',
        source: undefined,
      })
    })

    it('falls back to Accept-Language when the body has no known locale', async () => {
      await POST(req({ email: 'uus@example.com', locale: 'xx' }, { 'accept-language': 'et-EE' }))
      await runAfter()

      expect(mockProcess).toHaveBeenCalledWith(expect.objectContaining({ locale: 'et' }))
    })

    it('passes a valid ref as the source', async () => {
      await POST(req({ email: 'new@example.com', locale: 'en', ref: 'reddit-ukparenting' }))
      await runAfter()

      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'reddit-ukparenting' }),
      )
    })

    it.each([
      ['markup', '<script>'],
      ['upper case', 'Mealime'],
      ['a space', 'expat group'],
      ['an empty string', ''],
      ['33 characters', 'a'.repeat(33)],
      ['a number', 42],
    ])('drops a ref with %s and still accepts the request', async (_label, ref) => {
      const response = await POST(req({ email: 'new@example.com', locale: 'en', ref }))
      await runAfter()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(mockProcess).toHaveBeenCalledTimes(1)
      expect(mockProcess.mock.calls[0]![0].source).toBeUndefined()
    })
  })
})
