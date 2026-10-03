import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: vi.fn(),
}))

import { getPosthogServer } from '@/lib/posthog-server'
import {
  bootstrapFlags,
  FLAG_CACHE_TTL_MS,
  FLAG_DEFAULTS,
  getServerFlag,
  resetFlagCacheForTests,
  type FlagKey,
} from './feature-flags'

const mockedGetPosthogServer = vi.mocked(getPosthogServer)

interface MockPosthogClient {
  getFeatureFlag: ReturnType<typeof vi.fn>
  getAllFlags: ReturnType<typeof vi.fn>
}

function makeClient(overrides: Partial<MockPosthogClient> = {}): MockPosthogClient {
  return {
    getFeatureFlag: vi.fn(),
    getAllFlags: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFlagCacheForTests()
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
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue(true) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(true)
    // A user id keeps the default `$feature_flag_called` event: no options.
    expect(client.getFeatureFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user_1')
    expect(client.getAllFlags).not.toHaveBeenCalled()
  })

  it('reads the shared anonymous id through getAllFlags, which sends no $feature_flag_called', async () => {
    const client = makeClient({
      getAllFlags: vi.fn().mockResolvedValue({ invite_code_required: false }),
    })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('invite_code_required', 'anonymous')

    expect(result).toBe(false)
    expect(client.getAllFlags).toHaveBeenCalledWith('anonymous')
    expect(client.getFeatureFlag).not.toHaveBeenCalled()
  })

  it('does not cache user-id reads', async () => {
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue(true) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    await getServerFlag('ai_generation_enabled', 'user_1')
    await getServerFlag('ai_generation_enabled', 'user_1')

    expect(client.getFeatureFlag).toHaveBeenCalledTimes(2)
  })

  it('returns false when PostHog returns false', async () => {
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue(false) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('recipe_import_enabled', 'user_1')

    expect(result).toBe(false)
  })

  it('returns the default when PostHog returns undefined (flag not configured)', async () => {
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue(undefined) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('invite_code_required', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.invite_code_required)
  })

  it('returns the default when PostHog returns a multivariate string we do not model as boolean', async () => {
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue('control') })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.ai_generation_enabled)
  })

  it('returns the default when PostHog rejects synchronously fast', async () => {
    const error = new Error('network down')
    // The .catch wrapper swallows the rejection and returns undefined → default.
    const client = makeClient({ getFeatureFlag: vi.fn().mockRejectedValue(error) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const result = await getServerFlag('ai_generation_enabled', 'user_1')

    expect(result).toBe(FLAG_DEFAULTS.ai_generation_enabled)
    expect(console.warn).toHaveBeenCalledWith('[feature-flags] late error', {
      key: 'ai_generation_enabled',
      error,
    })
  })

  it('does not propagate a late rejection as unhandledRejection after the timeout fires', async () => {
    vi.useFakeTimers()
    try {
      let rejectFn: (e: Error) => void = () => {}
      const lateRejection = new Promise<boolean | string | undefined>((_, reject) => {
        rejectFn = reject
      })
      const client = makeClient({ getFeatureFlag: vi.fn().mockReturnValue(lateRejection) })
      mockedGetPosthogServer.mockReturnValue(client as never)

      const promise = getServerFlag('recipe_import_enabled', 'user_1')

      // Race ends with the timeout default (we return).
      await vi.advanceTimersByTimeAsync(101)
      const result = await promise
      expect(result).toBe(FLAG_DEFAULTS.recipe_import_enabled)

      // Now the original promise rejects — the .catch on flagPromise must
      // swallow it. If the .catch is missing, this triggers
      // unhandledRejection and Node's default policy ('throw' on Node 15+)
      // would crash the test runner.
      const error = new Error('late PostHog 5xx')
      rejectFn(error)
      await vi.advanceTimersByTimeAsync(0)

      expect(console.warn).toHaveBeenCalledWith('[feature-flags] late error', {
        key: 'recipe_import_enabled',
        error,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the default and warns when PostHog hangs past the 100ms timeout', async () => {
    vi.useFakeTimers()
    try {
      // A promise that never resolves — only the timeout can settle the race.
      const client = makeClient({
        getFeatureFlag: vi.fn().mockImplementation(() => new Promise(() => {})),
      })
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
    const client = makeClient({ getFeatureFlag: vi.fn().mockResolvedValue(true) })
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
    // All defaults — null PostHog is the easiest way to assert the
    // per-flag fallback covers every key in the union.
    expect(data.featureFlags).toEqual(FLAG_DEFAULTS)
  })

  it('omits distinctID for anonymous visitors so PostHog generates its own client UUID', async () => {
    mockedGetPosthogServer.mockReturnValue(null)

    const data = await bootstrapFlags('anonymous')

    expect(data.distinctID).toBeUndefined()
    expect(data.featureFlags).toEqual(FLAG_DEFAULTS)
  })

  it('uses a single batched getAllFlags call rather than one call per flag', async () => {
    const getAllFlags = vi.fn().mockResolvedValue({
      ai_generation_enabled: false,
      recipe_import_enabled: true,
      invite_code_required: true,
    })
    const getFeatureFlag = vi.fn()
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags, getFeatureFlag }) as never)

    const data = await bootstrapFlags('user_42')

    expect(getAllFlags).toHaveBeenCalledTimes(1)
    expect(getAllFlags).toHaveBeenCalledWith('user_42')
    expect(getFeatureFlag).not.toHaveBeenCalled()
    expect(data.featureFlags).toEqual({
      ai_generation_enabled: false,
      recipe_import_enabled: true,
      invite_code_required: true,
    })
  })

  it('falls back to defaults when getAllFlags omits a key (e.g. flag not yet created in PostHog)', async () => {
    const getAllFlags = vi.fn().mockResolvedValue({
      ai_generation_enabled: false,
      // recipe_import_enabled and invite_code_required missing on purpose
    })
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

    const data = await bootstrapFlags('user_1')

    expect(data.featureFlags).toEqual({
      ai_generation_enabled: false,
      recipe_import_enabled: FLAG_DEFAULTS.recipe_import_enabled,
      invite_code_required: FLAG_DEFAULTS.invite_code_required,
    })
  })

  it('returns all defaults and warns when getAllFlags rejects', async () => {
    const error = new Error('PostHog 5xx')
    const getAllFlags = vi.fn().mockRejectedValue(error)
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

    const data = await bootstrapFlags('user_1')

    expect(data.featureFlags).toEqual(FLAG_DEFAULTS)
    expect(console.warn).toHaveBeenCalledWith('[feature-flags] bootstrap late error', { error })
  })

  it('returns all defaults and warns when getAllFlags hangs past the timeout', async () => {
    vi.useFakeTimers()
    try {
      const getAllFlags = vi.fn().mockImplementation(() => new Promise(() => {}))
      mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

      const promise = bootstrapFlags('user_1')

      await vi.advanceTimersByTimeAsync(101)

      const data = await promise

      expect(data.featureFlags).toEqual(FLAG_DEFAULTS)
      expect(console.warn).toHaveBeenCalledWith('[feature-flags] bootstrap timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('coerces non-boolean values from getAllFlags to per-flag defaults', async () => {
    const getAllFlags = vi.fn().mockResolvedValue({
      ai_generation_enabled: 'control', // multivariate string → default
      recipe_import_enabled: false,
      invite_code_required: true,
    })
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

    const data = await bootstrapFlags('user_1')

    expect(data.featureFlags).toEqual({
      ai_generation_enabled: FLAG_DEFAULTS.ai_generation_enabled,
      recipe_import_enabled: false,
      invite_code_required: true,
    })
  })
})

describe('flag cache', () => {
  const ALL_ON = {
    ai_generation_enabled: true,
    recipe_import_enabled: true,
    invite_code_required: true,
  }

  it('makes one flags request for a landing render: layout bootstrap plus the page read', async () => {
    const client = makeClient({ getAllFlags: vi.fn().mockResolvedValue(ALL_ON) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    // The layout and the page render concurrently.
    const [bootstrap, inviteRequired] = await Promise.all([
      bootstrapFlags('anonymous'),
      getServerFlag('invite_code_required', 'anonymous'),
    ])

    expect(bootstrap.featureFlags).toEqual(ALL_ON)
    expect(inviteRequired).toBe(true)
    expect(client.getAllFlags.mock.calls.length + client.getFeatureFlag.mock.calls.length).toBe(1)
  })

  it('serves a repeat evaluation for the same distinct id from the cache (cache hit)', async () => {
    const client = makeClient({ getAllFlags: vi.fn().mockResolvedValue(ALL_ON) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    await bootstrapFlags('user_1')
    const second = await bootstrapFlags('user_1')

    expect(second.featureFlags).toEqual(ALL_ON)
    expect(client.getAllFlags).toHaveBeenCalledTimes(1)
  })

  it('evaluates again for a different distinct id (cache miss)', async () => {
    const client = makeClient({ getAllFlags: vi.fn().mockResolvedValue(ALL_ON) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    await bootstrapFlags('user_1')
    await bootstrapFlags('user_2')

    expect(client.getAllFlags).toHaveBeenCalledTimes(2)
    expect(client.getAllFlags).toHaveBeenNthCalledWith(1, 'user_1')
    expect(client.getAllFlags).toHaveBeenNthCalledWith(2, 'user_2')
  })

  it('honours a kill-switch flip once the 30 s window has passed', async () => {
    vi.useFakeTimers()
    try {
      const getAllFlags = vi
        .fn()
        .mockResolvedValueOnce(ALL_ON)
        .mockResolvedValueOnce({ ...ALL_ON, invite_code_required: false })
      mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

      expect(await getServerFlag('invite_code_required', 'anonymous')).toBe(true)

      // Inside the window the cached value stands.
      await vi.advanceTimersByTimeAsync(FLAG_CACHE_TTL_MS - 1)
      expect(await getServerFlag('invite_code_required', 'anonymous')).toBe(true)
      expect(getAllFlags).toHaveBeenCalledTimes(1)

      // At 30 s the entry expires and the flip is read.
      await vi.advanceTimersByTimeAsync(1)
      expect(await getServerFlag('invite_code_required', 'anonymous')).toBe(false)
      expect(getAllFlags).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache a timeout, so the next read asks PostHog again', async () => {
    vi.useFakeTimers()
    try {
      const getAllFlags = vi
        .fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce({ ...ALL_ON, ai_generation_enabled: false })
      mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

      const first = bootstrapFlags('user_1')
      await vi.advanceTimersByTimeAsync(101)
      expect((await first).featureFlags).toEqual(FLAG_DEFAULTS)
      expect(console.warn).toHaveBeenCalledWith('[feature-flags] bootstrap timeout')

      const second = await bootstrapFlags('user_1')
      expect(second.featureFlags.ai_generation_enabled).toBe(false)
      expect(getAllFlags).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache a rejection, so the next read asks PostHog again', async () => {
    const getAllFlags = vi
      .fn()
      .mockRejectedValueOnce(new Error('PostHog 5xx'))
      .mockResolvedValueOnce(ALL_ON)
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

    expect((await bootstrapFlags('user_1')).featureFlags).toEqual(FLAG_DEFAULTS)
    expect((await bootstrapFlags('user_1')).featureFlags).toEqual(ALL_ON)
    expect(getAllFlags).toHaveBeenCalledTimes(2)
  })

  it('does not cache an empty result, which is how posthog-node reports a failed request', async () => {
    const getAllFlags = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(ALL_ON)
    mockedGetPosthogServer.mockReturnValue(makeClient({ getAllFlags }) as never)

    expect((await bootstrapFlags('user_1')).featureFlags).toEqual(FLAG_DEFAULTS)
    expect((await bootstrapFlags('user_1')).featureFlags).toEqual(ALL_ON)
    expect(getAllFlags).toHaveBeenCalledTimes(2)
  })

  it('hands each caller its own copy of the cached flags', async () => {
    const client = makeClient({ getAllFlags: vi.fn().mockResolvedValue(ALL_ON) })
    mockedGetPosthogServer.mockReturnValue(client as never)

    const first = await bootstrapFlags('user_1')
    first.featureFlags.ai_generation_enabled = false
    const second = await bootstrapFlags('user_1')

    expect(second.featureFlags.ai_generation_enabled).toBe(true)
  })
})
