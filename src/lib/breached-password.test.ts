import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isPasswordBreached } from './breached-password'

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD = 'password'
const PREFIX = '5BAA6'
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

describe('isPasswordBreached', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false for empty password without calling HIBP', async () => {
    const result = await isPasswordBreached('')
    expect(result).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries HIBP with the first 5 SHA-1 hex chars and Add-Padding header', async () => {
    fetchMock.mockResolvedValue(new Response('ABCDE:0\n', { status: 200 }))

    await isPasswordBreached(PASSWORD)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    expect(call[1].headers).toMatchObject({ 'Add-Padding': 'true' })
    expect(call[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('returns true when suffix appears with a count > 0', async () => {
    fetchMock.mockResolvedValue(new Response(`${SUFFIX}:12345\n`, { status: 200 }))

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(true)
  })

  it('treats padded rows (count = 0) as not-breached even when suffix matches', async () => {
    fetchMock.mockResolvedValue(new Response(`${SUFFIX}:0\n`, { status: 200 }))

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(false)
  })

  it('returns false when suffix is not in the response', async () => {
    fetchMock.mockResolvedValue(
      new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:42\n', { status: 200 }),
    )

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(false)
  })

  it('matches case-insensitively against returned suffix', async () => {
    fetchMock.mockResolvedValue(new Response(`${SUFFIX.toLowerCase()}:7\n`, { status: 200 }))

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(true)
  })

  it('fail-open: returns false on non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('upstream issue', { status: 503 }))

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(false)
  })

  it('fail-open: returns false when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(false)
  })

  it('fail-open: returns false on AbortError (timeout)', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    const result = await isPasswordBreached(PASSWORD)

    expect(result).toBe(false)
  })
})
