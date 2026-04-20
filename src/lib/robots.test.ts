// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()

vi.mock('@/lib/upstash', () => ({
  getRedis: () => ({ get: mockGet, set: mockSet }),
}))

import { checkRobotsAllowed, HONKADORI_BOT_USER_AGENT, HONKADORI_BOT_TOKEN } from './robots'

describe('checkRobotsAllowed', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(null)
    mockSet.mockReset().mockResolvedValue('OK')
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('fetches robots.txt with the bot UA', async () => {
    fetchSpy.mockResolvedValue(
      new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/robots.txt',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': HONKADORI_BOT_USER_AGENT }),
      }),
    )
  })

  it('returns true and caches the robots.txt body for 24h when robots.txt allows', async () => {
    const body = 'User-agent: *\nAllow: /\n'
    fetchSpy.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    const allowed = await checkRobotsAllowed('https://example.com/recipe/123')

    expect(allowed).toBe(true)
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', body, { ex: 86400 })
  })

  it('returns false and logs disallow when the UA token is disallowed for the path', async () => {
    const body = `User-agent: ${HONKADORI_BOT_TOKEN}\nDisallow: /private/\n`
    fetchSpy.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    const allowed = await checkRobotsAllowed('https://example.com/private/recipe')

    expect(allowed).toBe(false)
    expect(infoSpy).toHaveBeenCalledWith('[robots] Disallowed', { origin: 'https://example.com' })
    // The body is cached; the disallow decision itself is not — it is derived
    // from the body on each call so sibling paths on the same origin get the
    // correct per-path answer.
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', body, { ex: 86400 })
  })

  it('returns false when a wildcard rule disallows the path', async () => {
    const body = 'User-agent: *\nDisallow: /secret/\n'
    fetchSpy.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    const allowed = await checkRobotsAllowed('https://example.com/secret/page')

    expect(allowed).toBe(false)
  })

  it('re-evaluates each URL against the cached body so sibling paths get per-path answers', async () => {
    // First call: fetch robots.txt with a mix of allowed and disallowed paths.
    const body = 'User-agent: *\nDisallow: /private/\n'
    fetchSpy.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    const allowedPath = await checkRobotsAllowed('https://example.com/public/a')
    expect(allowedPath).toBe(true)

    // Second call: cache hit — should not re-fetch, should return false for
    // a Disallow path even though the previous call allowed a sibling.
    mockGet.mockResolvedValueOnce(body)
    const disallowedPath = await checkRobotsAllowed('https://example.com/private/b')
    expect(disallowedPath).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns the per-URL decision on cache hit without re-fetching', async () => {
    mockGet.mockResolvedValue('User-agent: *\nAllow: /\n')

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('treats empty cached body as allow (no rules apply)', async () => {
    mockGet.mockResolvedValue('')

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns true, logs info, and caches empty body for 24h when robots.txt returns 404', async () => {
    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404 }))

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(infoSpy).toHaveBeenCalledWith('[robots] Allowing due to fetch failure', {
      origin: 'https://example.com',
      reason: 'not-found',
    })
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', '', { ex: 86400 })
  })

  it('returns true, logs info, and caches with a short TTL when robots.txt returns 5xx', async () => {
    fetchSpy.mockResolvedValue(new Response('Server Error', { status: 503 }))

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(infoSpy).toHaveBeenCalledWith('[robots] Allowing due to fetch failure', {
      origin: 'https://example.com',
      reason: 'status-503',
    })
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', '', { ex: 300 })
  })

  it('returns true, logs info, and caches with a short TTL when robots.txt fetch times out', async () => {
    fetchSpy.mockRejectedValue(new DOMException('aborted', 'TimeoutError'))

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(infoSpy).toHaveBeenCalledWith('[robots] Allowing due to fetch failure', {
      origin: 'https://example.com',
      reason: 'timeout',
    })
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', '', { ex: 300 })
  })

  it('returns true, logs info, and caches with a short TTL on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ENETUNREACH'))

    const allowed = await checkRobotsAllowed('https://example.com/recipe')

    expect(allowed).toBe(true)
    expect(infoSpy).toHaveBeenCalledWith('[robots] Allowing due to fetch failure', {
      origin: 'https://example.com',
      reason: 'network-error',
    })
    expect(mockSet).toHaveBeenCalledWith('robots:https://example.com', '', { ex: 300 })
  })

  it('scopes cache keys to the origin so paths on the same host share a decision', async () => {
    fetchSpy.mockResolvedValue(
      new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await checkRobotsAllowed('https://example.com/recipe/a')
    await checkRobotsAllowed('https://example.com/recipe/b')

    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(mockGet).toHaveBeenNthCalledWith(1, 'robots:https://example.com')
    expect(mockGet).toHaveBeenNthCalledWith(2, 'robots:https://example.com')
  })
})
