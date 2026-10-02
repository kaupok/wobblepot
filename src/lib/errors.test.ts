import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { captureApiError, captureExternalApiTimeout } from './errors'
import { captureClientError } from './errors-client'
import { markPostHogLoaded } from '@/lib/posthog-client-state'
import { MealPlanValidationError, InsufficientCandidatesError } from '@/lib/ai/types'

const captureExceptionMock = vi.fn()
const captureMock = vi.fn()
const flushMock = vi.fn()
const getRequestIdMock = vi.fn()
const getPosthogServerMock = vi.fn()

vi.mock('next/server', () => ({
  // Invoke the callback synchronously so tests can observe its effects.
  after: (fn: () => void) => fn(),
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

  it('captures with request_id, release, route, and error_type in snake_case', () => {
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
      statusCode: 502,
    })

    expect(captureExceptionMock).toHaveBeenCalledOnce()
    const [errorArg, distinctIdArg, propsArg] = captureExceptionMock.mock.calls[0]!
    expect(errorArg).toBe(err)
    expect(distinctIdArg).toBe('u-1')
    expect(propsArg).toMatchObject({
      route: '/api/x',
      user_id: 'u-1',
      household_id: 'hh-1',
      feature: 'plan_generate',
      status_code: 502,
      request_id: 'req-123',
      release: 'abc123',
      error_type: 'Error',
    })
    // One casing across server events: no camelCase key survives.
    const camelKeys = Object.keys(propsArg).filter((key) => /[A-Z]/.test(key))
    expect(camelKeys).toEqual([])
  })

  it('snake_cases free-form context keys too', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x', distinctIds: ['a'] })
    const props = captureExceptionMock.mock.calls[0]![2]
    expect(props).toMatchObject({ distinct_ids: ['a'] })
    expect(props).not.toHaveProperty('distinctIds')
  })

  it('tags $exception_source as captureApiError by default', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({
      $exception_source: 'captureApiError',
    })
  })

  it("keeps the caller's $exception_source", () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { $exception_source: 'externalFetch.nonOk' })
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({
      $exception_source: 'externalFetch.nonOk',
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
      error_type: 'MealPlanValidationError',
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
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({ error_type: 'string' })
  })

  it('schedules a flush via next/after to keep serverless isolates alive', () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
      flush: flushMock,
    })
    captureApiError(new Error('boom'), { route: '/api/x' })
    expect(captureExceptionMock).toHaveBeenCalledOnce()
    expect(flushMock).toHaveBeenCalledOnce()
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

  it('records a personless analytics event, not an exception, when there is no user', () => {
    getRequestIdMock.mockReturnValue('req-1')
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({
      feature: 'breached_password_check',
      url: 'https://api.example.com/x',
    })

    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(captureMock).toHaveBeenCalledOnce()
    const message = captureMock.mock.calls[0]![0]
    // No distinct id: a per-request id minted one PostHog person per timeout.
    expect(message.distinctId).toBeUndefined()
    expect(message).toMatchObject({
      event: 'external_api_timeout',
      properties: {
        feature: 'breached_password_check',
        url: 'https://api.example.com/x',
        request_id: 'req-1',
        release: 'deadbeef',
        $process_person_profile: false,
      },
    })
  })

  it('attributes to the user, with a person profile, when the caller has a userId', () => {
    getRequestIdMock.mockReturnValue('req-1')
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({ feature: 'test', userId: 'user-9' })

    const message = captureMock.mock.calls[0]![0]
    expect(message).toMatchObject({ distinctId: 'user-9', properties: { user_id: 'user-9' } })
    expect(message.properties).not.toHaveProperty('$process_person_profile')
    expect(message.properties).not.toHaveProperty('userId')
  })

  it('stays personless outside a request scope', () => {
    getRequestIdMock.mockReturnValue(undefined)
    getPosthogServerMock.mockReturnValue({ capture: captureMock })

    captureExternalApiTimeout({ feature: 'test' })

    expect(captureMock.mock.calls[0]![0].distinctId).toBeUndefined()
    expect(captureMock.mock.calls[0]![0].properties).toMatchObject({
      $process_person_profile: false,
    })
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
    // What PostHogProvider does after `posthog.init` once consent is granted.
    markPostHogLoaded()
    clientLoaded = true
  })

  it('no-ops when posthog-js has not loaded', async () => {
    clientLoaded = false
    await captureClientError(new Error('boom'), { digest: 'abc' })
    expect(clientCaptureExceptionMock).not.toHaveBeenCalled()
  })

  it('captures with digest and error_type', async () => {
    await captureClientError(new Error('boom'), { digest: 'abc' })
    expect(clientCaptureExceptionMock).toHaveBeenCalledOnce()
    const [errorArg, propsArg] = clientCaptureExceptionMock.mock.calls[0]!
    expect(errorArg).toBeInstanceOf(Error)
    expect(propsArg).toMatchObject({ digest: 'abc', error_type: 'Error' })
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
