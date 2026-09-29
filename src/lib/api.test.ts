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
