import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHogProvider } from '@/components/PostHogProvider'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'

// Hoisted mocks — vi.mock factories run before top-level `const` bindings.
const { posthogMock, envMock } = vi.hoisted(() => ({
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  },
  envMock: {
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' as string | undefined,
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com' as string | undefined,
  },
}))

vi.mock('posthog-js', () => ({ default: posthogMock }))
vi.mock('@/lib/env', () => ({ clientEnv: envMock, serverEnv: envMock }))

// Next.js navigation hooks — the provider calls these inside
// SuspendedPostHogPageView but we don't assert pageview fires in these
// unit tests (Storybook / E2E cover that path).
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// @posthog/react's PHProvider renders a real context that our provider wraps
// around children. We only care that children render after the client loads.
vi.mock('@posthog/react', async () => {
  const React = await import('react')
  return {
    PostHogProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    usePostHog: () => posthogMock,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  envMock.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
  envMock.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
})

afterEach(() => {
  envMock.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
  envMock.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
})

function wrap(consentValue: AnalyticsConsent, ui: React.ReactElement) {
  return <ConsentContext.Provider value={consentValue}>{ui}</ConsentContext.Provider>
}

function makeConsent(granted: boolean | null): AnalyticsConsent {
  return { granted, grant: vi.fn(), withdraw: vi.fn() }
}

describe('PostHogProvider', () => {
  it('renders children without initializing posthog when consent is undecided', async () => {
    const consent = makeConsent(null)
    const { getByTestId } = render(
      wrap(
        consent,
        <PostHogProvider>
          <p data-testid="child">child</p>
        </PostHogProvider>,
      ),
    )
    expect(getByTestId('child').textContent).toBe('child')

    // Wait one macrotask so the lazy-load effect has a chance to resolve.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // posthog.init ran (lazy-load always runs when key + host are set), but
    // identify and opt_in did NOT because consent is null.
    await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        // Consent undecided → SDK starts opted-out so no events leak before
        // the user decides.
        opt_out_capturing_by_default: true,
        capture_pageview: false,
        disable_session_recording: true,
      }),
    )
    expect(posthogMock.identify).not.toHaveBeenCalled()
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled()
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('inits with opt_out_capturing_by_default=false when consent is already granted', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    // Without this, the first $pageview on load (fired by child effects that
    // run before the parent opt-in effect) would be dropped by the SDK's
    // opt-out guard. See PostHogProvider.tsx for the effect-ordering rationale.
    await waitFor(() =>
      expect(posthogMock.init).toHaveBeenCalledWith(
        'phc_test',
        expect.objectContaining({ opt_out_capturing_by_default: false }),
      ),
    )
  })

  it('calls opt_in_capturing when consent is granted', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.opt_in_capturing).toHaveBeenCalledTimes(1))
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('calls opt_out_capturing when consent is declined', async () => {
    const consent = makeConsent(false)
    render(
      wrap(
        consent,
        <PostHogProvider>
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1))
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled()
  })

  it('identifies only with userId + household_id — never email/name/tokens', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-42" householdId="hh-9">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.identify).toHaveBeenCalledTimes(1))
    expect(posthogMock.identify).toHaveBeenCalledWith('user-42', { household_id: 'hh-9' })

    // Guard the PII rule explicitly — the identify payload must have no
    // other keys than household_id.
    const call = posthogMock.identify.mock.calls[0]
    expect(call).toBeDefined()
    const props = call![1] as Record<string, unknown>
    expect(Object.keys(props)).toEqual(['household_id'])
  })

  it('does not identify when consent is not granted', async () => {
    const consent = makeConsent(false)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1))
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })

  it('does not identify when there is no userId (anonymous session)', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider>
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.opt_in_capturing).toHaveBeenCalledTimes(1))
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })

  it('skips the lazy load entirely when NEXT_PUBLIC_POSTHOG_KEY is unset', async () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined
    envMock.NEXT_PUBLIC_POSTHOG_HOST = undefined

    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })
})
