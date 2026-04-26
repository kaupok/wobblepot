import { describe, it, expect, vi, beforeEach } from 'vitest'

// `RATE_LIMIT_BYPASS_ACTIVE` is computed once at module init, so we mock the
// module rather than poking process.env after the fact. The two test groups
// re-import the route fresh under each mock value to assert both gate paths.
const setBypass = (active: boolean) => {
  vi.doMock('@/lib/rate-limit', () => ({ RATE_LIMIT_BYPASS_ACTIVE: active }))
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    signupCode: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('POST /api/e2e-seed — production gate', () => {
  it('returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false (production / staging / preview)', async () => {
    setBypass(false)
    const { POST } = await import('./route')

    const res = await POST()
    expect(res.status).toBe(404)
  })

  it('mints an invite code when RATE_LIMIT_BYPASS_ACTIVE is true (ci/test/dev only)', async () => {
    setBypass(true)
    const { POST } = await import('./route')

    const res = await POST()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.code).toMatch(/^e2e-/)
  })
})

describe('DELETE /api/e2e-seed — production gate', () => {
  it('returns 404 when RATE_LIMIT_BYPASS_ACTIVE is false', async () => {
    setBypass(false)
    const { DELETE } = await import('./route')

    const res = await DELETE(new Request('http://x/?code=abc', { method: 'DELETE' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 when no code query param is provided', async () => {
    setBypass(true)
    const { DELETE } = await import('./route')

    const res = await DELETE(new Request('http://x/', { method: 'DELETE' }))
    expect(res.status).toBe(400)
  })

  it('removes a code when bypass is active', async () => {
    setBypass(true)
    const { DELETE } = await import('./route')

    const res = await DELETE(new Request('http://x/?code=abc', { method: 'DELETE' }))
    expect(res.status).toBe(200)
  })
})
