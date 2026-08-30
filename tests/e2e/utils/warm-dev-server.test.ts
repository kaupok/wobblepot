// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shouldWarmDevServer, warmRoutes, WARM_ROUTES } from './warm-dev-server'

describe('shouldWarmDevServer', () => {
  it('warms a plain local run', () => {
    expect(shouldWarmDevServer({})).toBe(true)
  })

  it('skips CI (prebuilt next start — nothing to compile)', () => {
    expect(shouldWarmDevServer({ CI: 'true' })).toBe(false)
  })

  it('skips remote tiers (PLAYWRIGHT_BASE_URL)', () => {
    expect(shouldWarmDevServer({ PLAYWRIGHT_BASE_URL: 'https://wobblepot.dev' })).toBe(false)
  })
})

describe('warmRoutes', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('fetches every warm route against the base URL, serially', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      return new Response(null, { status: 200 })
    })
    await warmRoutes('http://localhost:3100', fetchImpl as unknown as typeof fetch)
    expect(seen).toEqual(WARM_ROUTES.map((r) => new URL(r, 'http://localhost:3100').href))
  })

  it('continues past a rejected fetch (non-fatal)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(new Response(null, { status: 200 }))
    await expect(
      warmRoutes('http://localhost:3100', fetchImpl as unknown as typeof fetch),
    ).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(WARM_ROUTES.length)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
