import { beforeEach, describe, expect, it, vi } from 'vitest'

// The factory runs each time `posthog-js` is imported into a fresh module
// graph, so its call count stands in for "the browser fetched the chunk".
const { posthogMock, posthogImported } = vi.hoisted(() => ({
  posthogMock: { __loaded: true as boolean },
  posthogImported: vi.fn(),
}))

vi.mock('posthog-js', () => {
  posthogImported()
  return { default: posthogMock }
})

// A fresh module graph per test, so the module-level flag starts false.
async function loadState() {
  return import('@/lib/posthog-client-state')
}

beforeEach(() => {
  vi.resetModules()
  posthogImported.mockClear()
  posthogMock.__loaded = true
})

describe('getLoadedPostHog', () => {
  it('returns null without importing posthog-js before init', async () => {
    const { getLoadedPostHog, isPostHogLoaded } = await loadState()

    expect(isPostHogLoaded()).toBe(false)
    await expect(getLoadedPostHog()).resolves.toBeNull()
    expect(posthogImported).not.toHaveBeenCalled()
  })

  it('returns the client once init has run', async () => {
    const { getLoadedPostHog, isPostHogLoaded, markPostHogLoaded } = await loadState()

    markPostHogLoaded()

    expect(isPostHogLoaded()).toBe(true)
    await expect(getLoadedPostHog()).resolves.toBe(posthogMock)
    expect(posthogImported).toHaveBeenCalledOnce()
  })

  it('returns null when the flag is set but posthog-js reports not loaded', async () => {
    const { getLoadedPostHog, markPostHogLoaded } = await loadState()
    posthogMock.__loaded = false

    markPostHogLoaded()

    await expect(getLoadedPostHog()).resolves.toBeNull()
  })
})
