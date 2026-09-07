import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { captureApiError, captureExternalApiTimeout } from './errors'
import { captureClientError } from './errors-client'
import { MealPlanValidationError, InsufficientCandidatesError } from '@/lib/ai/types'

const captureExceptionMock = vi.fn()
const captureMock = vi.fn()
const flushMock = vi.fn()
const getRequestIdMock = vi.fn()
const getPosthogServerMock = vi.fn()
const afterMock = vi.fn()

vi.mock('next/server', () => ({
  // Kept as a spy, not a caller: `captureApiError` no longer schedules a flush
  // through `after` (HON-534 — the SDK's own `waitUntil` owns that now), and the
  // spy is what proves it. Deleting the mock would only prove the import is
  // gone, which type-check already covers.
  after: (fn: () => void) => afterMock(fn),
}))

vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: () => getPosthogServerMock(),
}))

vi.mock('@/lib/request-id', () => ({
  getRequestId: () => getRequestIdMock(),
}))

const clientCaptureExceptionMock = vi.fn()
let clientLoaded = true

vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return clientLoaded
    },
    captureException: (...args: unknown[]) => clientCaptureExceptionMock(...args),
  },
}))

describe('captureApiError', () => {
  beforeEach(() => {
    captureExceptionMock.mockReset()
    flushMock.mockReset()
    afterMock.mockReset()
    getRequestIdMock.mockReset()
    getPosthogServerMock.mockReset()
    // Default to a deployed release so capture-path tests exercise capture.
    // The local-machine skip is covered by its own test below.
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeef')
    // Hermetic against a developer who has the escape hatch set in `.env`.
    vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('no-ops silently when PostHog is not configured', () => {
    getPosthogServerMock.mockReturnValue(null)
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('skips capture on a local machine (release=local)', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(getPosthogServerMock).not.toHaveBeenCalled()
  })

  it('captures on a local machine when POSTHOG_CAPTURE_LOCAL opts in', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '1')
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock).toHaveBeenCalledOnce()
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({ release: 'local' })
  })

  it('captures with requestId, release, route, and errorType', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    getRequestIdMock.mockReturnValue('req-123')
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123'
    const err = new Error('boom')

    captureApiError(err, {
      route: '/api/x',
      userId: 'u-1',
      householdId: 'hh-1',
      feature: 'plan_generate',
    })

    expect(captureExceptionMock).toHaveBeenCalledOnce()
    const [errorArg, distinctIdArg, propsArg] = captureExceptionMock.mock.calls[0]!
    expect(errorArg).toBe(err)
    expect(distinctIdArg).toBe('u-1')
    expect(propsArg).toMatchObject({
      route: '/api/x',
      userId: 'u-1',
      householdId: 'hh-1',
      feature: 'plan_generate',
      requestId: 'req-123',
      release: 'abc123',
      errorType: 'Error',
    })
  })

  it('passes undefined as distinctId when userId is missing', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x', householdId: 'hh-1' })
    expect(captureExceptionMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('attaches $exception_fingerprint for typed errors', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    const err = new MealPlanValidationError('bad plan')
    captureApiError(err, { route: '/api/meal-plans/generate' })
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({
      $exception_fingerprint: 'MealPlanValidation',
      errorType: 'MealPlanValidationError',
    })
  })

  it('attaches a fingerprint for InsufficientCandidatesError', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    const err = new InsufficientCandidatesError('fish')
    captureApiError(err, { route: '/api/meal-plans/generate' })
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({
      $exception_fingerprint: 'InsufficientCandidates',
    })
  })

  it('does not attach fingerprint for unknown errors', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock.mock.calls[0]![2].$exception_fingerprint).toBeUndefined()
  })

  it('swallows internal errors (capture must never propagate)', () => {
    getPosthogServerMock.mockImplementation(() => {
      throw new Error('client-init-failed')
    })
    expect(() => captureApiError(new Error('x'), { route: '/api' })).not.toThrow()
  })

  it('handles non-Error throws (string, number, undefined)', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError('string-throw', { route: '/api' })
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({ errorType: 'string' })
  })

  it('leaves the per-request flush to the SDK (no next/after wrapping)', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock).toHaveBeenCalledOnce()
    // `flushAt: 1` + the constructor `waitUntil` in `posthog-server.ts` keep the
    // isolate alive now, so the callsite must not schedule a second flush.
    expect(afterMock).not.toHaveBeenCalled()
    expect(flushMock).not.toHaveBeenCalled()
  })
})

describe('captureExternalApiTimeout', () => {
  beforeEach(() => {
    captureMock.mockReset()
    captureExceptionMock.mockReset()
    getRequestIdMock.mockReset()
    getPosthogServerMock.mockReset()
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeef')
    vi.stubEnv('POSTHOG_CAPTURE_LOCAL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('records an analytics event, not an exception', () => {
    getRequestIdMock.mockReturnValue('req-1')
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({
      feature: 'breached_password_check',
      url: 'https://api.example.com/x',
    })

    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(captureMock).toHaveBeenCalledOnce()
    expect(captureMock.mock.calls[0]![0]).toMatchObject({
      distinctId: 'req-1',
      event: 'external_api_timeout',
      properties: {
        feature: 'breached_password_check',
        url: 'https://api.example.com/x',
        requestId: 'req-1',
        release: 'deadbeef',
      },
    })
  })

  it('prefers userId as distinct id when the caller has one', () => {
    getRequestIdMock.mockReturnValue('req-1')
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({ feature: 'test', userId: 'user-9' })

    expect(captureMock.mock.calls[0]![0]).toMatchObject({ distinctId: 'user-9' })
  })

  it('falls back to "system" outside a request scope', () => {
    getRequestIdMock.mockReturnValue(undefined)
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({ feature: 'test' })

    expect(captureMock.mock.calls[0]![0]).toMatchObject({ distinctId: 'system' })
  })

  it('skips on a local machine', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({ feature: 'test' })

    expect(captureMock).not.toHaveBeenCalled()
    expect(getPosthogServerMock).not.toHaveBeenCalled()
  })

  it('no-ops when PostHog is not configured', () => {
    getPosthogServerMock.mockReturnValue(null)
    expect(() => captureExternalApiTimeout({ feature: 'test' })).not.toThrow()
  })

  it('swallows capture failures', () => {
    getPosthogServerMock.mockReturnValue({
      capture: () => {
        throw new Error('posthog-down')
      },
    })
    expect(() => captureExternalApiTimeout({ feature: 'test' })).not.toThrow()
  })
})

describe('captureClientError', () => {
  beforeEach(() => {
    clientCaptureExceptionMock.mockReset()
    clientLoaded = true
  })

  it('no-ops when posthog-js has not loaded', async () => {
    clientLoaded = false
    await captureClientError(new Error('boom'), { digest: 'abc' })
    expect(clientCaptureExceptionMock).not.toHaveBeenCalled()
  })

  it('captures with digest and errorType', async () => {
    await captureClientError(new Error('boom'), { digest: 'abc' })
    expect(clientCaptureExceptionMock).toHaveBeenCalledOnce()
    const [errorArg, propsArg] = clientCaptureExceptionMock.mock.calls[0]!
    expect(errorArg).toBeInstanceOf(Error)
    expect(propsArg).toMatchObject({ digest: 'abc', errorType: 'Error' })
  })

  it('attaches fingerprint for typed errors', async () => {
    const err = new MealPlanValidationError('boom')
    await captureClientError(err)
    expect(clientCaptureExceptionMock.mock.calls[0]![1]).toMatchObject({
      $exception_fingerprint: 'MealPlanValidation',
    })
  })

  it('swallows internal errors', async () => {
    clientCaptureExceptionMock.mockImplementation(() => {
      throw new Error('capture-failed')
    })
    await expect(captureClientError(new Error('x'))).resolves.toBeUndefined()
  })
})
