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
    // Non-local release by default so capture runs; local-skip has its own test.
    process.env.VERCEL_GIT_COMMIT_SHA = 'sha-test'
  })

  afterEach(() => {
    delete process.env.NEXT_RUNTIME
    delete process.env.VERCEL_GIT_COMMIT_SHA
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

  it('skips capture when release is local (VERCEL_GIT_COMMIT_SHA unset)', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(new Error('boom'), baseRequest)
    expect(getPosthogServerMock).not.toHaveBeenCalled()
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it.each([
    [
      'message "The destination stream closed early"',
      new Error('The destination stream closed early'),
    ],
    [
      'code ERR_STREAM_PREMATURE_CLOSE',
      Object.assign(new Error('premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }),
    ],
    ['name AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' })],
    [
      'digest NEXT_REDIRECT',
      Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;replace;/home;307;' }),
    ],
    [
      'digest NEXT_HTTP_ERROR_FALLBACK;404',
      Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }),
    ],
    [
      'digest NEXT_HTTP_ERROR_FALLBACK;403',
      Object.assign(new Error('forbidden'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' }),
    ],
  ])('skips framework noise: %s', async (_label, err) => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(err, baseRequest)
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('captures a genuine application error', async () => {
    getPosthogServerMock.mockReturnValue({
      captureException: captureExceptionMock,
    })
    await onRequestError(new Error('real failure'), baseRequest)
    expect(captureExceptionMock).toHaveBeenCalledOnce()
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
