import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const constructorSpy = vi.fn()
const shutdownSpy = vi.fn(async () => {})

vi.mock('posthog-node', () => {
  class MockPostHog {
    constructor(key: string, opts: Record<string, unknown>) {
      constructorSpy(key, opts)
    }
    async shutdown() {
      await shutdownSpy()
    }
  }
  return { PostHog: MockPostHog }
})

describe('posthog-server', () => {
  beforeEach(() => {
    vi.resetModules()
    constructorSpy.mockClear()
    shutdownSpy.mockClear()
    delete (globalThis as { posthog?: unknown }).posthog
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST
  })

  afterEach(() => {
    delete (globalThis as { posthog?: unknown }).posthog
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST
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
})
