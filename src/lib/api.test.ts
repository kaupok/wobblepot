import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api'

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(body === undefined ? null : JSON.stringify(body), { status }),
      ),
  )
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed body on success', async () => {
    mockResponse(200, { ok: true })
    await expect(apiFetch('/api/x')).resolves.toEqual({ ok: true })
  })

  it('prefers the route error over the fallback message', async () => {
    mockResponse(400, { error: 'Name is required' })
    await expect(apiFetch('/api/x', undefined, 'Save failed')).rejects.toMatchObject({
      message: 'Name is required',
      status: 400,
    })
  })

  it('uses the fallback message when the route sends no error', async () => {
    mockResponse(500, undefined)
    const error = await apiFetch('/api/x', undefined, 'Save failed').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'Save failed', status: 500 })
  })

  it('falls back to the status when no fallback is given', async () => {
    mockResponse(503, {})
    await expect(apiFetch('/api/x')).rejects.toThrow('Request failed: 503')
  })
})

describe('ApiError body and code', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carries the route code and the whole parsed body', async () => {
    const body = { success: false, error: 'Timed out', code: 'imagine_timeout', message: 'detail' }
    mockResponse(504, body)
    const error = await apiFetch('/api/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      message: 'Timed out',
      status: 504,
      code: 'imagine_timeout',
      body,
    })
  })

  it('leaves code undefined when the route sends a non-string code', async () => {
    mockResponse(400, { error: 'Bad', code: 42 })
    const error = await apiFetch('/api/x').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: undefined, body: { error: 'Bad', code: 42 } })
  })

  it('leaves code undefined and body empty for a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })),
    )
    const error = await apiFetch('/api/x', undefined, 'Save failed').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'Save failed', status: 502, code: undefined, body: {} })
  })

  it('keeps the existing two-argument constructor', () => {
    const error = new ApiError('Nope', 404)
    expect(error).toMatchObject({ message: 'Nope', status: 404, code: undefined, body: {} })
  })
})

describe('apiFetch with no response body', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a 204 to undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(apiFetch<void>('/api/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
