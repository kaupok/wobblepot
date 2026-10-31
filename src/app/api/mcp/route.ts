import { requireMcpAuth } from '@better-auth/mcp'
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server'

import { auth } from '@/lib/auth'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import type { McpCallerContext } from '@/lib/mcp/context'
import { loadMcpCaller, McpGrantError } from '@/lib/mcp/grant'
import {
  getMcpIssuer,
  getMcpResource,
  MCP_READ_SCOPE,
  MCP_RESOURCE_PATH,
  MCP_WRITE_SCOPE,
} from '@/lib/mcp/oauth'
import { buildMcpServer } from '@/lib/mcp/server'

/**
 * The Wobblepot MCP server: read tools over the household's meal plan,
 * shopping list, pantry and meals (HON-1151), and write tools for the shopping
 * list (HON-1154). Streamable HTTP, stateless, so every request builds its own
 * server and holds no session.
 *
 * `requireMcpAuth` verifies the bearer token against the JWKS of the OAuth
 * server from HON-1150: signature, issuer, audience (this resource) and the
 * `mcp:read` scope. A missing or bad token gets 401 with the RFC 9728
 * `WWW-Authenticate` challenge, a token without the scope gets 403. A write
 * tool also needs `mcp:write`, which `runTool` checks per call. See
 * docs/MCP_SERVER.md.
 */

const ROUTE = '/api/mcp'

/**
 * Browser-based MCP clients call cross-origin. The token is a bearer header and
 * no cookie is read, so `*` gives a page nothing it could not send itself. The
 * client must read `WWW-Authenticate` to start the OAuth flow.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // `Mcp-Method` and `Mcp-Name` ride on every 2026-07-28 request; the SDK
  // refuses a request without them.
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
} as const

/**
 * `legacy: 'stateless'` also serves 2025-era clients, which open with an
 * `initialize` handshake: each such request gets a fresh server with no
 * session. `'reject'` would refuse them, and most clients, Claude's connector
 * included, speak that era today.
 */
const mcpHandler = createMcpHandler(
  (requestContext) => buildMcpServer(callerFrom(requestContext.authInfo), getServerBaseURL()),
  {
    legacy: 'stateless',
  },
)

/** The caller the POST handler resolved, carried to the factory on `authInfo.extra`. */
function callerFrom(authInfo: AuthInfo | undefined): McpCallerContext {
  const caller = authInfo?.extra?.caller as McpCallerContext | undefined
  // Unreachable: the factory only runs behind `requireMcpAuth`, which sets it.
  if (!caller) throw new Error('MCP request reached the server without a caller')
  return caller
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function jsonRpcError(status: number, message: string, extraHeaders?: HeadersInit): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32603, message }, id: null },
    { status, headers: extraHeaders },
  )
}

/**
 * A token that verified but no longer stands for a live grant (see
 * `loadMcpCaller`). Same challenge shape as a bad token, so the client
 * re-authorizes.
 */
function invalidTokenResponse(origin: string, description: string): Response {
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`
  return jsonRpcError(401, 'This access token is no longer valid. Connect Wobblepot again.', {
    'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}", resource_metadata="${metadataUrl}"`,
  })
}

const REFUSAL_DESCRIPTIONS = {
  noAccount: 'no active account',
  noGrant: 'no active grant',
} as const

async function serveAuthorized(
  request: Request,
  claims: {
    sub?: string
    scope?: unknown
    azp?: unknown
    client_id?: unknown
    exp?: number
    iat?: number
  },
  origin: string,
): Promise<Response> {
  const userId = claims.sub
  if (!userId) return invalidTokenResponse(origin, REFUSAL_DESCRIPTIONS.noAccount)
  // `azp` is the client the token was issued to; `client_id` is the RFC 9068 name.
  const clientId = String(claims.azp ?? claims.client_id ?? '')
  if (!clientId) return invalidTokenResponse(origin, REFUSAL_DESCRIPTIONS.noGrant)

  const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : []

  let caller: McpCallerContext
  try {
    caller = await loadMcpCaller({ userId, clientId, issuedAt: claims.iat, scopes })
  } catch (error) {
    if (error instanceof McpGrantError) {
      return invalidTokenResponse(origin, REFUSAL_DESCRIPTIONS[error.reason])
    }
    // Outside any tool handler, so `@posthog/mcp` does not see it.
    captureApiError(error, { route: ROUTE, userId })
    return jsonRpcError(500, 'Wobblepot could not load this account. Try again later.')
  }

  const authInfo: AuthInfo = {
    // The raw token is not needed past verification, so it is not passed on.
    token: '',
    clientId,
    scopes,
    ...(typeof claims.exp === 'number' ? { expiresAt: claims.exp } : {}),
    extra: { caller },
  }
  return mcpHandler.fetch(request, { authInfo })
}

export async function POST(request: Request): Promise<Response> {
  const origin = getServerBaseURL()
  const protectedHandler = requireMcpAuth(
    auth,
    (verifiedRequest, claims) => serveAuthorized(verifiedRequest, claims, origin),
    {
      // The issuer is the bare origin and the JWKS sits under the auth base
      // path, so neither default (`<origin>/api/auth`) is right (HON-1150).
      resource: getMcpResource(origin),
      issuer: getMcpIssuer(origin),
      jwksUrl: `${origin}/api/auth/jwks`,
      requiredScopes: [MCP_READ_SCOPE],
      // The 401 challenge names the scopes to ask for, and an MCP client reads
      // it before `scopes_supported`. Left to default to `requiredScopes`, it
      // says `mcp:read` only, so a client would never ask for `mcp:write` and
      // "connect again" would loop back to a read-only token (HON-1154).
      challengeScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    },
  )
  try {
    return withCors(await protectedHandler(request))
  } catch (error) {
    // The auth wrapper or the transport failed outside any tool, so no user
    // is known here and `runTool` did not report it.
    captureApiError(error, { route: ROUTE })
    return withCors(jsonRpcError(500, 'Wobblepot could not answer this request. Try again later.'))
  }
}

/**
 * Platform execution ceiling for this route, in seconds. `adjust_meal` makes a
 * model call under `ADJUST_AI_BUDGET_MS`, so it is stated as on every AI route,
 * and the budget's refusal stays reachable (HON-1246). `create_meal` and
 * `update_meal` draw the recipe's image in `after()` (HON-1503), which runs
 * under this ceiling as it does on the app's meal routes. The other tools
 * finish far below it.
 */
export const maxDuration = 60

/** Stateless serving opens no server-to-client stream, so there is nothing to GET. */
export function GET(): Response {
  return withCors(
    new Response(JSON.stringify({ error: 'Method not allowed. Send MCP requests as POST.' }), {
      status: 405,
      headers: { Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' },
    }),
  )
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
