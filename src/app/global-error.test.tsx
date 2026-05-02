import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsentDecision } from '@/lib/consent'
import { MealPlanValidationError } from '@/lib/ai/types'
import GlobalError from './global-error'

const { posthogMock, envMock, consentMock } = vi.hoisted(() => ({
  posthogMock: {
    __loaded: false as boolean,
    init: vi.fn(),
    captureException: vi.fn(),
  },
  envMock: {
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_test' as string | undefined,
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com' as string | undefined,
  },
  consentMock: {
    read: vi.fn<() => ConsentDecision | null>(),
  },
}))

vi.mock('posthog-js', () => ({ default: posthogMock }))
vi.mock('@/lib/env', () => ({ clientEnv: envMock, serverEnv: envMock }))
vi.mock('@/lib/consent.client', () => ({
  readConsentCookieClient: () => consentMock.read(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  posthogMock.__loaded = false
  envMock.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
  envMock.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
  consentMock.read.mockReset()
})

const reset = vi.fn()

function makeError(): Error & { digest?: string } {
  return Object.assign(new Error('boom'), { digest: 'abc-123' })
}

describe('GlobalError', () => {
  it('does not init or capture when consent is undecided', async () => {
    consentMock.read.mockReturnValue(null)
    render(<GlobalError error={makeError()} reset={reset} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.captureException).not.toHaveBeenCalled()
  })

  it('does not init or capture when consent is essential-only', async () => {
    consentMock.read.mockReturnValue('essential')
    render(<GlobalError error={makeError()} reset={reset} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.captureException).not.toHaveBeenCalled()
  })

  it('inits posthog and captures with the expected source + digest when consent is granted', async () => {
    consentMock.read.mockReturnValue('all')
    const err = makeError()
    render(<GlobalError error={err} reset={reset} />)

    await waitFor(() => expect(posthogMock.captureException).toHaveBeenCalledTimes(1))
    expect(posthogMock.init).toHaveBeenCalledTimes(1)
    // Mirrors PostHogProvider's init — without `before_send` and `defaults` the
    // PII sanitiser is silently dropped for the rest of the session because
    // posthog-js no-ops re-init.
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: false,
        disable_session_recording: true,
        defaults: '2026-01-30',
        before_send: expect.any(Function),
      }),
    )
    expect(posthogMock.captureException).toHaveBeenCalledWith(err, {
      $exception_source: 'app.global-error',
      digest: 'abc-123',
      errorType: 'Error',
    })
  })

  it('skips init but still captures when posthog is already loaded', async () => {
    consentMock.read.mockReturnValue('all')
    posthogMock.__loaded = true
    const err = makeError()
    render(<GlobalError error={err} reset={reset} />)

    await waitFor(() => expect(posthogMock.captureException).toHaveBeenCalledTimes(1))
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.captureException).toHaveBeenCalledWith(err, {
      $exception_source: 'app.global-error',
      digest: 'abc-123',
      errorType: 'Error',
    })
  })

  it('attaches $exception_fingerprint for typed errors so PostHog groups them stably', async () => {
    consentMock.read.mockReturnValue('all')
    posthogMock.__loaded = true
    const err = new MealPlanValidationError('bad plan')
    render(<GlobalError error={err} reset={reset} />)

    await waitFor(() => expect(posthogMock.captureException).toHaveBeenCalledTimes(1))
    expect(posthogMock.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        $exception_source: 'app.global-error',
        errorType: 'MealPlanValidationError',
        $exception_fingerprint: 'MealPlanValidation',
      }),
    )
  })

  it('does not init or capture when the PostHog env vars are unset', async () => {
    consentMock.read.mockReturnValue('all')
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined
    envMock.NEXT_PUBLIC_POSTHOG_HOST = undefined
    render(<GlobalError error={makeError()} reset={reset} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(posthogMock.init).not.toHaveBeenCalled()
    expect(posthogMock.captureException).not.toHaveBeenCalled()
  })

  it('renders the support email link regardless of consent state', () => {
    consentMock.read.mockReturnValue(null)
    render(<GlobalError error={makeError()} reset={reset} />)

    const link = screen.getByRole('link', { name: /support@honkadori\.xyz/i })
    expect(link).toHaveAttribute('href', 'mailto:support@honkadori.xyz')
  })
})
