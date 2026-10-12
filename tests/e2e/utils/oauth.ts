import { createHash, randomBytes } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Wobblepot as the OAuth 2.1 authorization server for MCP clients (HON-1150),
 * driven the way Claude's custom connector drives it. Shared by
 * `oauth-consent.spec.ts`, `mcp-read.spec.ts` and `mcp-write.spec.ts`.
 *
 * The redirect URI is an `https` callback on a reserved domain, as Claude's
 * connector registers one (the provider accepts plain `http` only for native
 * loopback clients). The browser's request to it is fulfilled by `page.route`,
 * so a spec reads the code or the error from the URL without a server.
 */

export const REDIRECT_URI = 'https://mcp-client.example/callback'
export const SCOPE = 'openid profile offline_access mcp:read'

/** What a client asks for to use the write tools too (HON-1154), as Claude's connector does. */
export const WRITE_SCOPE = `${SCOPE} mcp:write`

export interface AuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  jwks_uri: string
  code_challenge_methods_supported: string[]
}

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
}

/** The path and query of an endpoint URL, so requests follow Playwright's baseURL. */
export function pathOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function pkcePair() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  expect(payload, 'access token is a JWT').toBeTruthy()
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
}

export async function discover(request: APIRequestContext) {
  const asResponse = await request.get('/.well-known/oauth-authorization-server')
  expect(asResponse.status()).toBe(200)
  const prResponse = await request.get('/.well-known/oauth-protected-resource')
  expect(prResponse.status()).toBe(200)
  return {
    server: (await asResponse.json()) as AuthServerMetadata,
    resource: (await prResponse.json()) as ProtectedResourceMetadata,
  }
}

/** RFC 7591 registration of a public client, as Claude's connector registers. */
export async function registerClient(request: APIRequestContext, server: AuthServerMetadata) {
  const response = await request.post(pathOf(server.registration_endpoint), {
    data: {
      client_name: 'E2E MCP client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
    },
  })
  expect(response.status(), await response.text()).toBeLessThan(300)
  const body = (await response.json()) as { client_id: string }
  expect(body.client_id).toBeTruthy()
  return body.client_id
}

export function authorizePath(
  server: AuthServerMetadata,
  params: {
    clientId: string
    challenge: string
    resource: string
    state: string
    prompt?: string
    /** Default {@link SCOPE}, read-only. */
    scope?: string
  },
): string {
  const query = new URLSearchParams({
    ...(params.prompt ? { prompt: params.prompt } : {}),
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: REDIRECT_URI,
    scope: params.scope ?? SCOPE,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    resource: params.resource,
  })
  return `${pathOf(server.authorization_endpoint)}?${query}`
}

/** Answers the browser's request to the redirect URI and waits for it. */
export async function waitForRedirectUri(page: Page): Promise<URL> {
  await page.route(`${REDIRECT_URI}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'callback' }),
  )
  await page.waitForURL((url) => url.href.startsWith(REDIRECT_URI))
  return new URL(page.url())
}

/**
 * The whole connector flow for the signed-in user on `page`: discovery,
 * registration, authorization with PKCE, Allow on `/consent`, and the token
 * exchange. Returns the access token for the MCP resource.
 *
 * `scope` is what the client asks for, default read-only {@link SCOPE}.
 * `onConsent` runs on the consent page before Allow, for a spec to check it.
 */
export async function connectMcpClient(
  page: Page,
  request: APIRequestContext,
  options: { scope?: string; onConsent?: (page: Page) => Promise<void> } = {},
): Promise<string> {
  const { server, resource } = await discover(request)
  const clientId = await registerClient(request, server)
  const { verifier, challenge } = pkcePair()

  await page.goto(
    authorizePath(server, {
      clientId,
      challenge,
      resource: resource.resource,
      state: 'connect',
      scope: options.scope,
    }),
  )
  await page.waitForURL(/\/consent\?/)
  await options.onConsent?.(page)
  const callbackPromise = waitForRedirectUri(page)
  await page.getByRole('button', { name: 'Allow' }).click()
  const code = (await callbackPromise).searchParams.get('code')
  expect(code, 'Allow returns an authorization code').toBeTruthy()

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
  return ((await tokenResponse.json()) as { access_token: string }).access_token
}
