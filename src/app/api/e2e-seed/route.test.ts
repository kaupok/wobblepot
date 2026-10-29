import { beforeEach, describe, expect, it, vi } from 'vitest'

// The queries live in `@/lib/signup-codes`, tested against a database in
// `signup-codes.db.test.ts`. This file mocks them at the seam and asserts the
// gate and the status and body of each answer (HON-1217).

// `RATE_LIMIT_BYPASS_ACTIVE` is computed once at module init, so we mock the
// module rather than poking process.env after the fact. The two test groups
// re-import the route fresh under each mock value to assert both gate paths.
const setBypass = (active: boolean) => {
  vi.doMock('@/lib/rate-limit', () => ({ RATE_LIMIT_BYPASS_ACTIVE: active }))
}

vi.mock('@/lib/signup-codes', () => ({
  mintE2eSignupCode: vi.fn(),
  deleteUnusedSignupCode: vi.fn(),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// Imported after `vi.resetModules()`, so it is the same mock instance the
// freshly imported route holds.
const signupCodes = () => import('@/lib/signup-codes')

describe('POST /api/e2e-seed — production gate', () => {
  it('returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false (production / staging / preview)', async () => {
    setBypass(false)
    const { POST } = await import('./route')
    const { mintE2eSignupCode } = await signupCodes()

    const res = await POST()

    expect(res.status).toBe(404)
    expect(mintE2eSignupCode).not.toHaveBeenCalled()
  })

  it('mints an invite code when RATE_LIMIT_BYPASS_ACTIVE is true (ci/test/dev only)', async () => {
    setBypass(true)
    const { POST } = await import('./route')
    const { mintE2eSignupCode } = await signupCodes()
    vi.mocked(mintE2eSignupCode).mockResolvedValue('e2e-1-abc')

    const res = await POST()

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ code: 'e2e-1-abc' })
  })

  it('returns 500 with an error when the insert throws', async () => {
    setBypass(true)
    const { POST } = await import('./route')
    const { mintE2eSignupCode } = await signupCodes()
    vi.mocked(mintE2eSignupCode).mockRejectedValue(new Error('db down'))

    const res = await POST()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to seed invite code' })
  })
})

describe('DELETE /api/e2e-seed — production gate', () => {
  it('returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false', async () => {
    setBypass(false)
    const { DELETE } = await import('./route')
    const { deleteUnusedSignupCode } = await signupCodes()

    const res = await DELETE(new Request('http://x/?code=abc', { method: 'DELETE' }))

    expect(res.status).toBe(404)
    expect(deleteUnusedSignupCode).not.toHaveBeenCalled()
  })

  it('returns 400 when no code query param is provided', async () => {
    setBypass(true)
    const { DELETE } = await import('./route')
    const { deleteUnusedSignupCode } = await signupCodes()

    const res = await DELETE(new Request('http://x/', { method: 'DELETE' }))

    expect(res.status).toBe(400)
    expect(deleteUnusedSignupCode).not.toHaveBeenCalled()
  })

  it('removes the code and reports how many rows went', async () => {
    setBypass(true)
    const { DELETE } = await import('./route')
    const { deleteUnusedSignupCode } = await signupCodes()
    vi.mocked(deleteUnusedSignupCode).mockResolvedValue(1)

    const res = await DELETE(new Request('http://x/?code=abc', { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 1 })
    expect(deleteUnusedSignupCode).toHaveBeenCalledWith('abc')
  })

  it('returns 500 with an error when the delete throws', async () => {
    setBypass(true)
    const { DELETE } = await import('./route')
    const { deleteUnusedSignupCode } = await signupCodes()
    vi.mocked(deleteUnusedSignupCode).mockRejectedValue(new Error('db down'))

    const res = await DELETE(new Request('http://x/?code=abc', { method: 'DELETE' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to delete invite code' })
  })
})
