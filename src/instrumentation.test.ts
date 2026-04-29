import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getPosthogServerMock = vi.fn()
const captureExceptionMock = vi.fn()

vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: () => getPosthogServerMock(),
}))

import { onRequestError } from './instrumentation'

const baseRequest = {
  path: '/api/x',
  method: 'GET',
  headers: {} as NodeJS.Dict<string | string[]>,
}

describe('onRequestError', () => {
  beforeEach(() => {
    getPosthogServerMock.mockReset()
    captureExceptionMock.mockReset()
    process.env.NEXT_RUNTIME = 'nodejs'
    delete process.env.VERCEL_GIT_COMMIT_SHA
  })

  afterEach(() => {
    delete process.env.NEXT_RUNTIME
  })

  it('no-ops when NEXT_RUNTIME is not "nodejs"', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    await onRequestError(new Error('boom'), baseRequest)
    expect(getPosthogServerMock).not.toHaveBeenCalled()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('no-ops when PostHog is not configured (client null)', async () => {
    getPosthogServerMock.mockReturnValue(null)
    await onRequestError(new Error('boom'), baseRequest)
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('captures with source/path/method/release via captureException', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    process.env.VERCEL_GIT_COMMIT_SHA = 'sha-abc'
    const err = new Error('boom')

    await onRequestError(err, { ...baseRequest, path: '/api/foo', method: 'POST' })

    expect(captureExceptionMock).toHaveBeenCalledOnce()
    const [errArg, distinctIdArg, propsArg] = captureExceptionMock.mock.calls[0]!
    expect(errArg).toBe(err)
    expect(distinctIdArg).toBeUndefined()
    expect(propsArg).toEqual({
      $exception_source: 'instrumentation.onRequestError',
      path: '/api/foo',
      method: 'POST',
      release: 'sha-abc',
    })
  })

  it('falls back to release="local" when VERCEL_GIT_COMMIT_SHA is unset', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(new Error('x'), baseRequest)
    expect(captureExceptionMock.mock.calls[0]![2]).toMatchObject({ release: 'local' })
  })

  it('extracts distinct id from a PostHog cookie among other cookies', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    const cookieValue = encodeURIComponent(JSON.stringify({ distinct_id: 'user-42' }))
    await onRequestError(new Error('x'), {
      ...baseRequest,
      headers: { cookie: `theme=dark; ph_phc_TOKEN_posthog=${cookieValue}; foo=bar` },
    })
    expect(captureExceptionMock.mock.calls[0]![1]).toBe('user-42')
  })

  it('handles cookie header passed as an array', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    const cookieValue = encodeURIComponent(JSON.stringify({ distinct_id: 'user-7' }))
    await onRequestError(new Error('x'), {
      ...baseRequest,
      headers: { cookie: ['foo=bar', `ph_phc_X_posthog=${cookieValue}`] },
    })
    expect(captureExceptionMock.mock.calls[0]![1]).toBe('user-7')
  })

  it('returns undefined distinct id when cookie is missing', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(new Error('x'), { ...baseRequest, headers: {} })
    expect(captureExceptionMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('returns undefined distinct id when PostHog cookie value is not valid JSON', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(new Error('x'), {
      ...baseRequest,
      headers: { cookie: 'ph_phc_TOKEN_posthog=not-json' },
    })
    expect(captureExceptionMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('returns undefined distinct id when JSON parses but distinct_id is not a string', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    const cookieValue = encodeURIComponent(JSON.stringify({ distinct_id: 42 }))
    await onRequestError(new Error('x'), {
      ...baseRequest,
      headers: { cookie: `ph_phc_TOKEN_posthog=${cookieValue}` },
    })
    expect(captureExceptionMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('swallows synchronous errors thrown from captureException', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: () => {
        throw new Error('client-failed')
      },
    })
    await expect(onRequestError(new Error('x'), baseRequest)).resolves.toBeUndefined()
  })
})
