import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'

import { auth } from '@/lib/auth'
import { DISCOVERY_CORS_HEADERS } from '@/lib/mcp/oauth'

/**
 * RFC 8414 Authorization Server Metadata at the origin root (HON-1150).
 *
 * Better Auth serves its endpoints under `/api/auth`, but the issuer is the
 * bare origin (see `getMcpIssuer`), so MCP clients look for this document at
 * `/.well-known/oauth-authorization-server`. The body comes from the `mcp()`
 * plugin: endpoint URLs, `jwks_uri`, `registration_endpoint`, and `S256` as
 * the only PKCE method.
 *
 * Dynamic: it awaits the auth context, whose init reads the database.
 */
export const dynamic = 'force-dynamic'

export const GET = oauthProviderAuthServerMetadata(auth, { headers: DISCOVERY_CORS_HEADERS })

/** CORS preflight for browser-based clients. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: DISCOVERY_CORS_HEADERS })
}
