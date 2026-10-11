import { requireMcpAuth } from '@better-auth/mcp'
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { auth } from '@/lib/auth'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { buildMcpServer } from '@/lib/mcp/server'
import type { McpCallerContext } from '@/lib/mcp/context'
import { MCP_READ_SCOPE, MCP_RESOURCE_PATH, getMcpIssuer, getMcpResource } from '@/lib/mcp/oauth'

/**
 * The read-only Wobblepot MCP server (HON-1151): five tools over the
 * household's meal plan, shopping list, pantry and meals. Streamable HTTP,
 * stateless, so every request builds its own server and holds no session.
 *
 * `requireMcpAuth` verifies the bearer token against the JWKS of the OAuth
 * server from HON-1150: signature, issuer, audience (this resource) and the
 * `mcp:read` scope. A missing or bad token gets 401 with the RFC 9728
 * `WWW-Authenticate` challenge, a token without the scope gets 403. See
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
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id',
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
  (requestContext) => buildMcpServer(callerFrom(requestContext.authInfo)),
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
 * A token that verified but names no live user. A deleted account's tokens are
 * revoked in the deletion request, but an access token already issued stays
 * valid for up to an hour, so the route refuses it here. Same challenge shape
 * as a bad token, so the client re-authorizes.
 */
function invalidTokenResponse(origin: string): Response {
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`
  return jsonRpcError(401, 'This access token is no longer valid. Connect Wobblepot again.', {
    'WWW-Authenticate': `Bearer error="invalid_token", error_description="no active account", resource_metadata="${metadataUrl}"`,
  })
}

async function serveAuthorized(
  request: Request,
  claims: { sub?: string; scope?: unknown; azp?: unknown; client_id?: unknown; exp?: number },
  origin: string,
): Promise<Response> {
  const userId = claims.sub
  if (!userId) return invalidTokenResponse(origin)

  let caller: McpCallerContext
  try {
    const [user, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } }),
      getHouseholdMembership(userId),
    ])
    if (!user || user.deletedAt) return invalidTokenResponse(origin)
    caller = { userId, household: membership?.household ?? null }
  } catch (error) {
    // Outside any tool handler, so `@posthog/mcp` does not see it.
    captureApiError(error, { route: ROUTE, userId })
    return jsonRpcError(500, 'Wobblepot could not load this account. Try again later.')
  }

  const authInfo: AuthInfo = {
    // The raw token is not needed past verification, so it is not passed on.
    token: '',
    clientId: String(claims.azp ?? claims.client_id ?? ''),
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
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
