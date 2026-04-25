import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalApiError, externalFetch } from './external-fetch'

const captureApiErrorMock = vi.fn()
vi.mock('@/lib/errors', () => ({
  captureApiError: (...args: unknown[]) => captureApiErrorMock(...args),
}))

const originalFetch = globalThis.fetch

describe('externalFetch', () => {
  beforeEach(() => {
    captureApiErrorMock.mockReset()
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

  it('strips query string from the captured URL', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 }))
    await externalFetch('https://api.example.com/x?token=secret', undefined, {
      feature: 'test',
    })
    expect(captureApiErrorMock.mock.calls[0]![1].url).toBe('https://api.example.com/x')
  })
})
