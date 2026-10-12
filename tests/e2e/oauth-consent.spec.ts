// ROUTES: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource, /api/auth/oauth2/*, /api/auth/user/mcp-consents, /api/mcp, /consent, /profile, /sign-in · COMPONENTS: ConsentCard, SignInForm, ConnectedAssistantsList, McpServerUrl
import { test, expect, type APIRequestContext } from '@playwright/test'
import { signOut, signUpWithHousehold, TEST_PASSWORD } from './utils/test-helpers'
import {
  authorizePath,
  connectMcpClient,
  decodeJwtPayload,
  discover,
  pathOf,
  pkcePair,
  REDIRECT_URI,
  registerClient,
  waitForRedirectUri,
} from './utils/oauth'

/**
 * Wobblepot as the OAuth 2.1 authorization server for MCP clients (HON-1150),
 * driven the way Claude's custom connector drives it: discovery, dynamic
 * client registration, authorization code with PKCE, consent, token exchange.
 * The helpers are in `utils/oauth.ts`.
 *
 * **Not `@smoke`:** every test signs up a throwaway account, which needs
 * `/api/e2e-seed` for the invite code (404 on preview and staging).
 */

/** `tools/list` on the MCP server with a bearer token; returns the HTTP status. */
async function mcpToolsListStatus(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  return response.status()
}

test.describe('OAuth for MCP clients', () => {
  test('publishes discovery metadata at the origin root', async ({ request }) => {
    const { server, resource } = await discover(request)

    expect(server.authorization_endpoint).toMatch(/\/api\/auth\/oauth2\/authorize$/)
    expect(server.token_endpoint).toMatch(/\/api\/auth\/oauth2\/token$/)
    expect(server.registration_endpoint).toMatch(/\/api\/auth\/oauth2\/register$/)
    expect(server.jwks_uri).toMatch(/\/api\/auth\/jwks$/)
    expect(server.code_challenge_methods_supported).toContain('S256')

    expect(resource.resource).toBe(`${server.issuer}/api/mcp`)
    expect(resource.authorization_servers).toEqual([server.issuer])
    expect(new URL(server.issuer).pathname).toBe('/')
  })

  test('sends an anonymous visitor to sign in before consent', async ({ request }) => {
    const response = await request.get('/consent?client_id=abc', { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toContain(
      `/sign-in?returnUrl=${encodeURIComponent('/consent?client_id=abc')}`,
    )
  })

  test('Allow returns a code that exchanges for an access token bound to the MCP resource', async ({
    page,
    request,
  }) => {
    const { server, resource } = await discover(request)
    const clientId = await registerClient(request, server)
    await signUpWithHousehold(page, { householdName: 'OAuth E2E household' })

    const { verifier, challenge } = pkcePair()
    await page.goto(
      authorizePath(server, { clientId, challenge, resource: resource.resource, state: 'allow-1' }),
    )

    await page.waitForURL(/\/consent\?/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Connect E2E MCP client?' }),
    ).toBeVisible()
    await expect(page.getByText('Household: OAuth E2E household')).toBeVisible()
    await expect(
      page.getByText('Read your meal plan, shopping list, pantry and recipes.'),
    ).toBeVisible()
    // Registration is open, so the name is self-declared; the card shows the
    // host that receives the answer.
    await expect(page.getByText('Your answer is sent to mcp-client.example.')).toBeVisible()

    const callbackPromise = waitForRedirectUri(page)
    await page.getByRole('button', { name: 'Allow' }).click()
    const callback = await callbackPromise

    expect(callback.searchParams.get('state')).toBe('allow-1')
    expect(callback.searchParams.get('iss')).toBe(server.issuer)
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()

    const tokenResponse = await request.post(pathOf(server.token_endpoint), {
      form: {
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: resource.resource,
      },
    })
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200)
    const tokens = (await tokenResponse.json()) as {
      access_token: string
      refresh_token?: string
      token_type: string
    }
    expect(tokens.token_type.toLowerCase()).toBe('bearer')
    expect(tokens.refresh_token, 'offline_access grants a refresh token').toBeTruthy()

    const claims = decodeJwtPayload(tokens.access_token)
    expect([claims.aud].flat()).toContain(resource.resource)
    expect(claims.iss).toBe(server.issuer)
    expect(String(claims.scope).split(' ')).toContain('mcp:read')
  })

  test('Deny returns access_denied to the redirect URI', async ({ page, request }) => {
    const { server, resource } = await discover(request)
    const clientId = await registerClient(request, server)
    await signUpWithHousehold(page)

    const { challenge } = pkcePair()
    await page.goto(
      authorizePath(server, { clientId, challenge, resource: resource.resource, state: 'deny-1' }),
    )
    await page.waitForURL(/\/consent\?/)

    const callbackPromise = waitForRedirectUri(page)
    await page.getByRole('button', { name: 'Deny' }).click()
    const callback = await callbackPromise

    expect(callback.searchParams.get('error')).toBe('access_denied')
    expect(callback.searchParams.get('state')).toBe('deny-1')
    expect(callback.searchParams.has('code')).toBe(false)
  })

  test('a signed-out user signs in and continues to consent', async ({ page, request }) => {
    const { server, resource } = await discover(request)
    const clientId = await registerClient(request, server)
    const { email } = await signUpWithHousehold(page)
    await signOut(page)

    const { challenge } = pkcePair()
    await page.goto(
      authorizePath(server, { clientId, challenge, resource: resource.resource, state: 'login-1' }),
    )

    // The provider sends a signed-out user to the sign-in page with the signed
    // query; the auth client forwards it, and sign-in continues to consent.
    await page.waitForURL(/\/sign-in\?/)
    await page.locator('input#email').fill(email)
    await page.locator('input#password').fill(TEST_PASSWORD)
    await page.locator('form button[type="submit"]').click()

    await page.waitForURL(/\/consent\?/)
    await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible()
  })

  test('sign-in during an authorization tells a new user to set up first, then connect again', async ({
    page,
    request,
  }) => {
    const note =
      'Sign up first and set up your household. Then start connecting again from the app.'
    const { server, resource } = await discover(request)
    const clientId = await registerClient(request, server)

    // Sign-up does not carry the signed query through (HON-1162), so the page
    // says so next to the sign-up link.
    const { challenge } = pkcePair()
    await page.goto(
      authorizePath(server, { clientId, challenge, resource: resource.resource, state: 'note-1' }),
    )
    await page.waitForURL(/\/sign-in\?/)
    await expect(page.getByText(note)).toBeVisible()

    await page.goto('/sign-in')
    await expect(page.locator('form').getByRole('link', { name: 'Sign up' })).toBeVisible()
    await expect(page.getByText(note)).toHaveCount(0)
  })

  test('prompt=login sends a signed-in user to sign in again, then to consent', async ({
    page,
    request,
  }) => {
    const { server, resource } = await discover(request)
    const clientId = await registerClient(request, server)
    const { email } = await signUpWithHousehold(page)

    const { challenge } = pkcePair()
    await page.goto(
      authorizePath(server, {
        clientId,
        challenge,
        resource: resource.resource,
        state: 'relogin-1',
        prompt: 'login',
      }),
    )

    // The session exists, but the client asked for a fresh sign-in. The page
    // must show the form rather than send a signed-in user home.
    await page.waitForURL(/\/sign-in\?/)
    await page.locator('input#email').fill(email)
    await page.locator('input#password').fill(TEST_PASSWORD)
    await page.locator('form button[type="submit"]').click()

    await page.waitForURL(/\/consent\?/)
    await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible()
  })

  test('the profile page lists a connected client, and Disconnect stops its token at once (HON-1153)', async ({
    page,
    request,
  }) => {
    await signUpWithHousehold(page, { householdName: 'Disconnect E2E household' })
    const token = await connectMcpClient(page, request)
    expect(await mcpToolsListStatus(request, token)).toBe(200)

    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Connect to an AI assistant' })
    await expect(section.getByText(/\/api\/mcp$/)).toBeVisible()
    const row = section.getByRole('listitem').filter({ hasText: 'E2E MCP client' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Disconnect: E2E MCP client' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect E2E MCP client?' })
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expect(dialog).toBeHidden()
    await expect(section.getByText('No assistant is connected.')).toBeVisible()

    // The JWT has not expired; the route refuses it because the grant is gone.
    expect(await mcpToolsListStatus(request, token)).toBe(401)

    await page.reload()
    await expect(
      page
        .getByRole('region', { name: 'Connect to an AI assistant' })
        .getByText('No assistant is connected.'),
    ).toBeVisible()

    // A Client ID Metadata Document client's id is a URL. Encoded, it must reach
    // the `[clientId]` route as one segment, not fall through to Better Auth's
    // catch-all: this user has no such consent, so the route's own 404 answers.
    const urlClientId = 'https://assistant.example/oauth/client.json'
    const response = await page.request.delete(
      `/api/auth/user/mcp-consents/${encodeURIComponent(urlClientId)}`,
    )
    expect(response.status()).toBe(404)
    expect(await response.json()).toEqual({ error: 'Connected assistant not found' })
  })
})
