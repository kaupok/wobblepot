import { render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PostHog } from 'posthog-js'
import { PostHogProvider } from '@/components/PostHogProvider'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'

// HON-1002: this file runs the real posthog-js, not a mock, because the bug is
// in what the SDK writes to storage. PostHogProvider.test.tsx covers the calls.

const TOKEN = 'phc_storage_test'
const STORAGE_KEY = `ph_${TOKEN}_posthog`

vi.mock('@/lib/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_storage_test',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

beforeAll(() => {
  // Keep the SDK's config, flags and capture requests off the network.
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn(() => true) })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function consent(granted: boolean): AnalyticsConsent {
  return { granted, grant: vi.fn(), withdraw: vi.fn() }
}

function ui(granted: boolean) {
  return (
    <ConsentContext.Provider value={consent(granted)}>
      <PostHogProvider userId="user-1" householdId="hh-1">
        <p>child</p>
      </PostHogProvider>
    </ConsentContext.Provider>
  )
}

function phCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('ph_'))
    ?.split('=')
    .slice(1)
    .join('=')
}

/** Every PostHog value in cookies, localStorage and sessionStorage, decoded. */
function storedPostHogState(): string {
  const cookies = document.cookie
    .split('; ')
    .filter((c) => c.startsWith('ph_'))
    .map((c) => decodeURIComponent(c))
  const fromStorage = (storage: Storage) =>
    Object.keys(storage)
      .filter((k) => k.includes(TOKEN))
      .map((k) => `${k}=${storage.getItem(k) ?? ''}`)
  return [...cookies, ...fromStorage(localStorage), ...fromStorage(sessionStorage)].join('\n')
}

describe('PostHogProvider storage with the real posthog-js (HON-1002)', () => {
  it('deletes the stored identity on withdrawal and starts a fresh one on a new grant', async () => {
    const { default: posthog } = await import('posthog-js')
    const identify = vi.spyOn(posthog as PostHog, 'identify')

    const { rerender } = render(ui(true))

    // Granted: the SDK loads, identifies the user and persists the identity.
    await waitFor(() => expect(identify).toHaveBeenCalledWith('user-1', { household_id: 'hh-1' }))
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toContain('user-1'))
    expect(decodeURIComponent(phCookie() ?? '')).toContain('user-1')
    const oldDeviceId = posthog.get_property('$device_id') as string
    expect(oldDeviceId).toBeTruthy()
    expect(storedPostHogState()).toContain(oldDeviceId)

    // Withdrawn: no cookie and no storage entry holds the previous identity.
    rerender(ui(false))
    await waitFor(() => expect(posthog.has_opted_out_capturing()).toBe(true))
    expect(phCookie()).toBeUndefined()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(storedPostHogState()).not.toContain('user-1')
    expect(storedPostHogState()).not.toContain(oldDeviceId)

    // Granted again: a fresh anonymous identity, then identify for the user.
    identify.mockClear()
    rerender(ui(true))
    await waitFor(() => expect(posthog.has_opted_out_capturing()).toBe(false))
    await waitFor(() => expect(identify).toHaveBeenCalledWith('user-1', { household_id: 'hh-1' }))
    const newDeviceId = posthog.get_property('$device_id') as string
    expect(newDeviceId).toBeTruthy()
    expect(newDeviceId).not.toBe(oldDeviceId)
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toContain(newDeviceId))
    expect(storedPostHogState()).not.toContain(oldDeviceId)
    expect(posthog.get_distinct_id()).toBe('user-1')
  })
})
