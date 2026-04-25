import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: vi.fn(),
}))

import { getPosthogServer } from '@/lib/posthog-server'
import { bootstrapFlags, FLAG_DEFAULTS, getServerFlag, type FlagKey } from './feature-flags'

const mockedGetPosthogServer = vi.mocked(getPosthogServer)

interface MockPosthogClient {
  getFeatureFlag: ReturnType<typeof vi.fn>
}

function makeClient(impl: MockPosthogClient['getFeatureFlag']): MockPosthogClient {
  return { getFeatureFlag: impl }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FLAG_DEFAULTS', () => {
  it('defaults every kill-switch to true (safe value)', () => {
    expect(FLAG_DEFAULTS).toEqual({
      ai_generation_enabled: true,
      recipe_import_enabled: true,
      invite_code_required: true,
    })
  })
})

describe('getServerFlag', () => {
  it('returns the default when PostHog is unconfigured (getPosthogServer returns null)', async () => {
    mockedGetPosthogServer.mockReturnValue(null)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.ai_generation_enabled)
  })

  it('returns true when PostHog returns true', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(true))
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(true)
    expect(client.getFeatureFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user_1')
  })

  it('returns false when PostHog returns false', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(false))
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('recipe_import_enabled', 'user_1')

    expect(result).toBe(false)
  })

  it('returns the default when PostHog returns undefined (flag not configured)', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(undefined))
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('invite_code_required', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.invite_code_required)
  })

  it('returns the default when PostHog returns a multivariate string we do not model as boolean', async () => {
    const client = makeClient(vi.fn().mockResolvedValue('control'))
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.ai_generation_enabled)
  })

  it('returns the default and warns when PostHog rejects', async () => {
    const error = new Error('network down')
    const client = makeClient(vi.fn().mockRejectedValue(error))
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.ai_generation_enabled)
    expect(console.warn).toHaveBeenCalledWith('[feature-flags] error', {
      key: 'ai_generation_enabled',
      error,
    })
  })

  it('returns the default and warns when PostHog hangs past the 100ms timeout', async () => {
    vi.useFakeTimers()
    try {
      // A promise that never resolves — only the timeout can settle the race.
      const client = makeClient(vi.fn().mockImplementation(() => new Promise(() => {})))
      mockedGetPosthogServer.mockReturnValue(client as never)

      const promise = getServerFlag('recipe_import_enabled', 'user_1')

      await vi.advanceTimersByTimeAsync(101)

      const result = await promise

      expect(result).toBe(FLAG_DEFAULTS.recipe_import_enabled)
      expect(console.warn).toHaveBeenCalledWith('[feature-flags] timeout', {
        key: 'recipe_import_enabled',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not log a warning on the happy path', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(true))
    mockedGetPosthogServer.mockReturnValue(client as never)

    await getServerFlag('ai_generation_enabled', 'user_1')

    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('bootstrapFlags', () => {
  it('returns a BootstrapData payload with every known flag populated', async () => {
    mockedGetPosthogServer.mockReturnValue(null)

    const data = await bootstrapFlags('user_1')

    expect(data.distinctID).toBe('user_1')
    expect(Object.keys(data.featureFlags).sort()).toEqual(
      (Object.keys(FLAG_DEFAULTS) as FlagKey[]).sort(),
    )
    // All defaults — null PostHog is the easiest way to assert each flag
    // routes through getServerFlag rather than being short-circuited.
    expect(data.featureFlags).toEqual(FLAG_DEFAULTS)
  })

  it('passes the distinct id through to each per-flag PostHog call', async () => {
    const getFeatureFlag = vi.fn().mockResolvedValue(true)
    mockedGetPosthogServer.mockReturnValue(makeClient(getFeatureFlag) as never)

    await bootstrapFlags('user_42')

    const calledKeys = getFeatureFlag.mock.calls.map((call) => call[0]).sort()
    expect(calledKeys).toEqual((Object.keys(FLAG_DEFAULTS) as FlagKey[]).sort())
    for (const call of getFeatureFlag.mock.calls) {
      expect(call[1]).toBe('user_42')
    }
  })

  it('falls back to per-flag defaults when individual flag reads fail', async () => {
    const getFeatureFlag = vi.fn().mockImplementation((key: string) => {
      if (key === 'ai_generation_enabled') return Promise.reject(new Error('boom'))
      return Promise.resolve(false)
    })
    mockedGetPosthogServer.mockReturnValue(makeClient(getFeatureFlag) as never)

    const data = await bootstrapFlags('user_1')

    expect(data.featureFlags.ai_generation_enabled).toBe(FLAG_DEFAULTS.ai_generation_enabled)
    expect(data.featureFlags.recipe_import_enabled).toBe(false)
    expect(data.featureFlags.invite_code_required).toBe(false)
  })
})
