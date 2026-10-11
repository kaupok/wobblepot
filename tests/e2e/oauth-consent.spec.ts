// ROUTES: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource, /api/auth/oauth2/*, /consent, /sign-in · COMPONENTS: ConsentCard, SignInForm
import { test, expect } from '@playwright/test'
import { signOut, signUpWithHousehold, TEST_PASSWORD } from './utils/test-helpers'
import {
  authorizePath,
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
})
