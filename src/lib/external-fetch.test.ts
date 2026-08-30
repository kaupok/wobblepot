import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalApiError, externalFetch } from './external-fetch'

const captureApiErrorMock = vi.fn()
const captureExternalApiTimeoutMock = vi.fn()
vi.mock('@/lib/errors', () => ({
  captureApiError: (...args: unknown[]) => captureApiErrorMock(...args),
  captureExternalApiTimeout: (...args: unknown[]) => captureExternalApiTimeoutMock(...args),
}))

const originalFetch = globalThis.fetch

describe('externalFetch', () => {
  beforeEach(() => {
    captureApiErrorMock.mockReset()
    captureExternalApiTimeoutMock.mockReset()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('passes 2xx responses through without capturing', async () => {
    globalThis.fetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const res = await externalFetch('https://api.example.com/x', undefined, {
      feature: 'test',
    })
    expect(res.status).toBe(200)
    expect(captureApiErrorMock).not.toHaveBeenCalled()
  })

  it('captures once on non-2xx and still returns the response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 503 }))
    const res = await externalFetch('https://api.example.com/x', undefined, {
      feature: 'test',
    })
    expect(res.status).toBe(503)
    expect(captureApiErrorMock).toHaveBeenCalledOnce()
    const [errArg, ctxArg] = captureApiErrorMock.mock.calls[0]!
    expect(errArg).toBeInstanceOf(ExternalApiError)
    expect(ctxArg).toMatchObject({
      feature: 'test',
      statusCode: 503,
      url: 'https://api.example.com/x',
    })
  })

  it('captures once on network throw and re-throws', async () => {
    const networkErr = new Error('connect ECONNREFUSED')
    globalThis.fetch = vi.fn(async () => {
      throw networkErr
    })
    await expect(
      externalFetch('https://api.example.com/x', undefined, { feature: 'test' }),
    ).rejects.toBe(networkErr)
    expect(captureApiErrorMock).toHaveBeenCalledOnce()
    const [errArg, ctxArg] = captureApiErrorMock.mock.calls[0]!
    expect(errArg).toBe(networkErr)
    expect(ctxArg).toMatchObject({ feature: 'test', url: 'https://api.example.com/x' })
  })

  it('records a caller-initiated abort as a timeout event, not an exception', async () => {
    // Mirrors the real ordering: the caller's timer aborts, then fetch rejects.
    const controller = new AbortController()
    const abortErr = new DOMException('This operation was aborted', 'AbortError')
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (init?.signal?.aborted) throw abortErr
      throw new Error('unreachable')
    })
    controller.abort()

    await expect(
      externalFetch(
        'https://api.example.com/x?token=secret',
        { signal: controller.signal },
        { feature: 'test' },
      ),
    ).rejects.toBe(abortErr)

    expect(captureApiErrorMock).not.toHaveBeenCalled()
    expect(captureExternalApiTimeoutMock).toHaveBeenCalledOnce()
    expect(captureExternalApiTimeoutMock.mock.calls[0]![0]).toMatchObject({
      feature: 'test',
      $exception_source: 'externalFetch.timeout',
      url: 'https://api.example.com/x',
    })
  })

  it('treats an AbortSignal.timeout rejection as a caller deadline too', async () => {
    const timeoutErr = new DOMException('The operation timed out', 'TimeoutError')
    const signal = AbortSignal.timeout(1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    globalThis.fetch = vi.fn(async () => {
      throw timeoutErr
    })

    await expect(
      externalFetch('https://api.example.com/x', { signal }, { feature: 'test' }),
    ).rejects.toBe(timeoutErr)

    expect(captureApiErrorMock).not.toHaveBeenCalled()
    expect(captureExternalApiTimeoutMock).toHaveBeenCalledOnce()
  })

  it('still captures a genuine network error that races the abort', async () => {
    // The signal is aborted, but the rejection is a real connection failure —
    // checking `signal.aborted` alone would have swallowed this.
    const controller = new AbortController()
    controller.abort()
    const networkErr = new TypeError('fetch failed')
    globalThis.fetch = vi.fn(async () => {
      throw networkErr
    })

    await expect(
      externalFetch(
        'https://api.example.com/x',
        { signal: controller.signal },
        { feature: 'test' },
      ),
    ).rejects.toBe(networkErr)

    expect(captureExternalApiTimeoutMock).not.toHaveBeenCalled()
    expect(captureApiErrorMock).toHaveBeenCalledOnce()
    expect(captureApiErrorMock.mock.calls[0]![1]).toMatchObject({
      $exception_source: 'externalFetch.networkError',
    })
  })

  it('strips query string from the captured URL', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 }))
    await externalFetch('https://api.example.com/x?token=secret', undefined, {
      feature: 'test',
    })
    expect(captureApiErrorMock.mock.calls[0]![1].url).toBe('https://api.example.com/x')
  })
})
