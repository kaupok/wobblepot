import { metadataResponse } from '@better-auth/oauth-provider'
import { getServerBaseURL } from '@/lib/env'
import { DISCOVERY_CORS_HEADERS, buildProtectedResourceMetadata } from '@/lib/mcp/oauth'

/**
 * RFC 9728 Protected Resource Metadata for the MCP resource (HON-1150).
 *
 * The `mcp()` plugin builds this document only for requests that reach the
 * Better Auth handler under `/api/auth`, so the root path is served here from
 * the same constants `src/lib/auth.ts` passes to the plugin. An MCP client
 * reads `resource` (the token audience) and `authorization_servers` (where to
 * find `/.well-known/oauth-authorization-server`).
 *
 * The `/api/mcp` suffix is the RFC 9728 path-inserted form for the resource
 * `<origin>/api/mcp`; clients try it first, so both paths answer.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return metadataResponse(
    buildProtectedResourceMetadata(getServerBaseURL()),
    DISCOVERY_CORS_HEADERS,
  )
}

/** CORS preflight for browser-based clients. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: DISCOVERY_CORS_HEADERS })
}
