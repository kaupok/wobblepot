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
  it('does not init posthog-js when consent is undecided', async () => {
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

    // No init → no SDK assets fetched from posthog.com, which is the whole
    // point of consent gating under EDPB/AKI. `opt_out_capturing_by_default`
    // is a post-init guard and does not prevent those fetches on its own.
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.identify).not.toHaveBeenCalled()
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled()
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('does not init posthog-js when consent is declined', async () => {
    const consent = makeConsent(false)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.identify).not.toHaveBeenCalled()
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled()
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled()
  })

  it('inits with capture enabled once consent is granted', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )

    await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: false,
        disable_session_recording: true,
      }),
    )
    // We no longer pass opt_out_capturing_by_default — init only happens on
    // grant, so the SDK starts in capture-enabled state by default.
    expect(posthogMock.init.mock.calls[0]?.[1]).not.toHaveProperty('opt_out_capturing_by_default')
  })

  it('calls opt_in_capturing once init completes on grant', async () => {
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
    // Covered by the decline + undecided cases above — this guards against
    // a future regression where identify might slip past the gate via
    // prop changes rather than consent changes.
    const consent = makeConsent(false)
    const { rerender } = render(
      wrap(
        consent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    rerender(
      wrap(
        consent,
        <PostHogProvider userId="user-2" householdId="hh-2">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
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

  it('opts out mid-session when the user withdraws consent after granting', async () => {
    const grantedConsent = makeConsent(true)
    const { rerender } = render(
      wrap(
        grantedConsent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(posthogMock.opt_in_capturing).toHaveBeenCalledTimes(1))

    // User revokes consent without a remount — e.g. via a preferences toggle.
    const withdrawnConsent = makeConsent(false)
    rerender(
      wrap(
        withdrawnConsent,
        <PostHogProvider userId="user-1" householdId="hh-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1))
    // The SDK was already loaded when consent was granted; opt_out stops
    // events and clears ph_* cookies but does not re-init.
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
  })

  it('forwards the bootstrap prop to posthog.init for flicker-free flag reads', async () => {
    const consent = makeConsent(true)
    const bootstrap = {
      distinctID: 'user-7',
      featureFlags: {
        ai_generation_enabled: false,
        recipe_import_enabled: true,
        invite_code_required: true,
      },
    } as const
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-7" bootstrap={bootstrap}>
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ bootstrap }),
    )
  })

  it('omits the bootstrap option when no bootstrap is supplied', async () => {
    const consent = makeConsent(true)
    render(
      wrap(
        consent,
        <PostHogProvider userId="user-1">
          <p>child</p>
        </PostHogProvider>,
      ),
    )
    await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
    // Conditional spread keeps the option absent rather than `undefined`,
    // so PostHog's own default behaviour applies.
    expect(posthogMock.init.mock.calls[0]?.[1]).not.toHaveProperty('bootstrap')
  })

  // HON-528: posthog-js stamps the project token at properties.token; the
  // PII redactor strips it as a sensitive key, so before_send MUST re-add it
  // — otherwise every client event 401s with "submitted without an api_key".
  describe('before_send (HON-528 regression-guard)', () => {
    type CaptureResult = {
      uuid: string
      event: string
      properties: Record<string, unknown>
    }

    async function captureBeforeSend(): Promise<(cr: CaptureResult | null) => unknown> {
      const consent = makeConsent(true)
      render(
        wrap(
          consent,
          <PostHogProvider userId="user-1">
            <p>child</p>
          </PostHogProvider>,
        ),
      )
      await waitFor(() => expect(posthogMock.init).toHaveBeenCalledTimes(1))
      const initOptions = posthogMock.init.mock.calls[0]?.[1] as
        | { before_send?: (cr: CaptureResult | null) => unknown }
        | undefined
      const fn = initOptions?.before_send
      expect(fn).toBeTypeOf('function')
      return fn as (cr: CaptureResult | null) => unknown
    }

    it('preserves properties.token for $pageview', async () => {
      const before_send = await captureBeforeSend()
      const cr: CaptureResult = {
        uuid: 'evt-1',
        event: '$pageview',
        properties: {
          distinct_id: 'user-1',
          token: 'phc_test_token_value',
          $config_defaults: '2026-01-30',
          $current_url: 'https://example.com/',
        },
      }
      const out = before_send(cr) as CaptureResult
      expect(out.properties.token).toBe('phc_test_token_value')
      // Untouched SDK-internal and id keys still present.
      expect(out.properties.$current_url).toBe('https://example.com/')
      expect(out.properties.distinct_id).toBe('user-1')
    })

    it('preserves properties.token for a generic custom event and keeps safe keys', async () => {
      const before_send = await captureBeforeSend()
      const cr: CaptureResult = {
        uuid: 'evt-2',
        event: 'meal_plan_generated',
        properties: {
          distinct_id: 'user-1',
          token: 'phc_test_token_value',
          household_id: 'hh_1',
          plan_id: 'p_42',
        },
      }
      const out = before_send(cr) as CaptureResult
      expect(out.properties.token).toBe('phc_test_token_value')
      expect(out.properties.household_id).toBe('hh_1')
      expect(out.properties.plan_id).toBe('p_42')
    })

    it('still strips other sensitive keys (PII redaction unchanged)', async () => {
      const before_send = await captureBeforeSend()
      const cr: CaptureResult = {
        uuid: 'evt-3',
        event: 'meal_plan_generated',
        properties: {
          distinct_id: 'user-1',
          token: 'phc_test_token_value',
          email: 'leak@example.com',
          household_id: 'hh_1',
        },
      }
      const out = before_send(cr) as CaptureResult
      expect(out.properties.token).toBe('phc_test_token_value')
      expect(out.properties.email).toBeUndefined()
      expect(out.properties.household_id).toBe('hh_1')
    })

    it('returns the input unchanged when given a falsy CaptureResult', async () => {
      const before_send = await captureBeforeSend()
      expect(before_send(null)).toBeNull()
    })
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
