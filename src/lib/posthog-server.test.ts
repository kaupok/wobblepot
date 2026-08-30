import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const constructorSpy = vi.fn()
const shutdownSpy = vi.fn(async (_timeout?: number) => {})
const waitUntilMock = vi.fn()

vi.mock('posthog-node', () => {
  class MockPostHog {
    constructor(key: string, opts: Record<string, unknown>) {
      constructorSpy(key, opts)
    }
    async shutdown(timeout?: number) {
      await shutdownSpy(timeout)
    }
  }
  return { PostHog: MockPostHog }
})

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

describe('posthog-server', () => {
  let processOnceSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    constructorSpy.mockClear()
    shutdownSpy.mockClear()
    delete (globalThis as { posthog?: unknown }).posthog
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    delete process.env.VERCEL
    delete process.env.NEXT_RUNTIME
    // The runner sets VITEST, which the module treats as "return no client".
    // Blank it so the construction tests below reach the real client path; the
    // gate itself gets its own test that stubs VITEST back on. `stubEnv` keeps
    // the mutation scoped — `unstubAllEnvs` restores the runner's value even if
    // a test throws part-way through.
    vi.stubEnv('VITEST', '')
    processOnceSpy = vi.spyOn(process, 'once').mockImplementation(() => process)
  })

  afterEach(() => {
    processOnceSpy.mockRestore()
    delete (globalThis as { posthog?: unknown }).posthog
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    delete process.env.VERCEL
    delete process.env.NEXT_RUNTIME
    vi.unstubAllEnvs()
  })

  it('returns null under Vitest so fixture errors never reach the live project', async () => {
    vi.stubEnv('VITEST', 'true')
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    expect(getPosthogServer()).toBeNull()
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it('returns null when NEXT_PUBLIC_POSTHOG_KEY is unset', async () => {
    const { getPosthogServer } = await import('@/lib/posthog-server')
    expect(getPosthogServer()).toBeNull()
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it('returns null when NEXT_PUBLIC_POSTHOG_HOST is unset', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    const { getPosthogServer } = await import('@/lib/posthog-server')
    expect(getPosthogServer()).toBeNull()
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it('constructs a client with the project token and ingest host', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    const client = getPosthogServer()

    expect(client).not.toBeNull()
    expect(constructorSpy).toHaveBeenCalledTimes(1)
    expect(constructorSpy).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        host: 'https://eu.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
      }),
    )
  })

  it("passes Vercel's waitUntil so the SDK can extend the function lifetime", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    getPosthogServer()

    expect(constructorSpy).toHaveBeenCalledTimes(1)
    const opts = constructorSpy.mock.calls[0]![1] as { waitUntil?: unknown }
    expect(opts.waitUntil).toBe(waitUntilMock)
  })

  it('returns the same instance across calls (singleton)', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    const a = getPosthogServer()
    const b = getPosthogServer()

    expect(a).toBe(b)
    expect(constructorSpy).toHaveBeenCalledTimes(1)
  })

  it('shutdownPosthog awaits shutdown and clears the cache', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'

    const { getPosthogServer, shutdownPosthog } = await import('@/lib/posthog-server')
    getPosthogServer()
    await shutdownPosthog()

    expect(shutdownSpy).toHaveBeenCalledTimes(1)

    getPosthogServer()
    expect(constructorSpy).toHaveBeenCalledTimes(2)
  })

  it('registers a one-time SIGTERM handler that calls shutdown(2000) on Vercel Node', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.VERCEL = '1'
    process.env.NEXT_RUNTIME = 'nodejs'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    getPosthogServer()

    expect(processOnceSpy).toHaveBeenCalledTimes(1)
    const [signal, handler] = processOnceSpy.mock.calls[0]!
    expect(signal).toBe('SIGTERM')
    expect(typeof handler).toBe('function')

    await (handler as () => void | Promise<void>)()
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
    expect(shutdownSpy).toHaveBeenCalledWith(2000)
  })

  it('does not register a SIGTERM handler outside Vercel', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.NEXT_RUNTIME = 'nodejs'
    // VERCEL deliberately unset

    const { getPosthogServer } = await import('@/lib/posthog-server')
    getPosthogServer()

    expect(processOnceSpy).not.toHaveBeenCalled()
  })

  it('does not register a SIGTERM handler outside the nodejs runtime', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.VERCEL = '1'
    process.env.NEXT_RUNTIME = 'edge'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    getPosthogServer()

    expect(processOnceSpy).not.toHaveBeenCalled()
  })

  it('SIGTERM handler swallows shutdown rejections (partial drain is acceptable)', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.VERCEL = '1'
    process.env.NEXT_RUNTIME = 'nodejs'
    shutdownSpy.mockRejectedValueOnce('Timeout while shutting down PostHog.')

    const unhandledRejections: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      const { getPosthogServer } = await import('@/lib/posthog-server')
      getPosthogServer()

      const [, handler] = processOnceSpy.mock.calls[0]!
      expect(() => (handler as () => void)()).not.toThrow()

      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandledRejections).toEqual([])
      expect(shutdownSpy).toHaveBeenCalledTimes(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('registers the SIGTERM handler at most once across getPosthogServer calls', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.VERCEL = '1'
    process.env.NEXT_RUNTIME = 'nodejs'

    const { getPosthogServer } = await import('@/lib/posthog-server')
    getPosthogServer()
    getPosthogServer()
    getPosthogServer()

    expect(processOnceSpy).toHaveBeenCalledTimes(1)
  })
})
