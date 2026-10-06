import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogProvider } from '@/components/PostHogProvider'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'

// HON-1051: a browser without a loaded client and with consent `false` still
// loses the stored identity, and posthog-js is never imported to do it. The
// storage is jsdom's real cookie jar, localStorage and sessionStorage.

const TOKEN = 'phc_sweep_test'
const STORAGE_KEY = `ph_${TOKEN}_posthog`

const { posthogImported, posthogMock } = vi.hoisted(() => ({
  posthogImported: vi.fn(),
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    capture: vi.fn(),
    reset: vi.fn(),
    get_property: vi.fn((): unknown => undefined),
    get_distinct_id: vi.fn(() => 'anon-device-id'),
  },
}))

// The factory runs on the first import of posthog-js, so a call records an import.
vi.mock('posthog-js', () => {
  posthogImported()
  return { default: posthogMock }
})
vi.mock('@/lib/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_sweep_test',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function storeIdentity() {
  localStorage.setItem(STORAGE_KEY, '{"distinct_id":"user-1"}')
  document.cookie = `${STORAGE_KEY}=${encodeURIComponent('{"distinct_id":"user-1"}')}; path=/`
}

function phCookie(): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${STORAGE_KEY}=`))
}

async function renderWithConsent(granted: boolean | null) {
  const consent: AnalyticsConsent = { granted, grant: vi.fn(), withdraw: vi.fn() }
  render(
    <ConsentContext.Provider value={consent}>
      <PostHogProvider>
        <p>child</p>
      </PostHogProvider>
    </ConsentContext.Provider>,
  )
  // Let the idle-callback lazy load run, so a `true` render reaches the SDK.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
}

beforeEach(() => {
  storeIdentity()
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.cookie = `${STORAGE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
})

describe('PostHogProvider identity sweep without a client (HON-1051)', () => {
  it('removes the stored identity when consent is false, without importing posthog-js', async () => {
    await renderWithConsent(false)

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(phCookie()).toBeUndefined()
    expect(posthogImported).not.toHaveBeenCalled()
    expect(posthogMock.init).not.toHaveBeenCalled()
  })

  it('removes nothing when consent is not yet answered', async () => {
    await renderWithConsent(null)

    expect(localStorage.getItem(STORAGE_KEY)).toContain('user-1')
    expect(phCookie()).toBeDefined()
  })

  it('removes nothing when consent is granted', async () => {
    await renderWithConsent(true)

    expect(posthogMock.init).toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('user-1')
    expect(phCookie()).toBeDefined()
  })
})
