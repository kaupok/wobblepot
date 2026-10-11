import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The OAuth provider client plugin (HON-1150) is what lets the existing
 * sign-in form continue an MCP client's authorization: it copies the signed
 * query from the page URL into the POST body as `oauth_query`.
 */

// What the provider puts on `/sign-in` when it sends a signed-out user there:
// the authorization parameters, the names it signed (`ba_param`), and `sig`.
const SIGNED_SEARCH =
  '?client_id=client-123&scope=openid+mcp%3Aread&exp=4102444800' +
  '&ba_param=ba_param&ba_param=client_id&ba_param=exp&ba_param=scope&sig=signature-abc'

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls.at(-1)! as [RequestInfo | URL, RequestInit?]
  return JSON.parse(String(init?.body))
}

describe('authClient OAuth query forwarding', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const originalPath = window.location.pathname + window.location.search

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ redirect: false, token: 't', user: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    // The client keeps the `fetch` it saw when it was created, so build it
    // after the stub.
    vi.resetModules()
  })

  async function signIn() {
    const { authClient } = await import('@/lib/auth-client')
    await authClient.signIn.email({ email: 'a@example.com', password: 'correct-horse-1' })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', originalPath)
  })

  it('sends the signed query as oauth_query when the page carries one', async () => {
    window.history.replaceState(null, '', `/sign-in${SIGNED_SEARCH}`)

    await signIn()

    expect(fetchMock).toHaveBeenCalled()
    const body = lastRequestBody(fetchMock)
    expect(body.email).toBe('a@example.com')
    const oauthQuery = new URLSearchParams(String(body.oauth_query))
    expect(oauthQuery.get('client_id')).toBe('client-123')
    expect(oauthQuery.get('scope')).toBe('openid mcp:read')
    expect(oauthQuery.get('sig')).toBe('signature-abc')
  })

  it('sends no oauth_query on a plain sign-in', async () => {
    window.history.replaceState(null, '', '/sign-in?returnUrl=%2Fpantry')

    await signIn()

    expect(lastRequestBody(fetchMock)).not.toHaveProperty('oauth_query')
  })
})
