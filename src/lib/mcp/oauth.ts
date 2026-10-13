/**
 * Shared values for Wobblepot as an OAuth 2.1 authorization server for MCP
 * clients (HON-1150). `src/lib/auth.ts` passes them to the `mcp()` plugin, the
 * root `.well-known` routes publish them, and the MCP route (HON-1151) checks
 * access tokens against them, so the three cannot drift apart.
 *
 * Isomorphic on purpose: no server-only imports, so the consent page's client
 * component can read the scope list too.
 */

/** Path of the protected MCP resource. Its absolute URL is the token audience. */
export const MCP_RESOURCE_PATH = '/api/mcp'

/** The scope every MCP request requires: the read tools (HON-1151). */
export const MCP_READ_SCOPE = 'mcp:read'

/**
 * The scope a write tool requires (HON-1154): it changes the shopping list,
 * the pantry or the meal plan. A token without it still lists the write tools,
 * and calling one answers that the assistant must reconnect.
 */
export const MCP_WRITE_SCOPE = 'mcp:write'

/**
 * Scopes the authorization server accepts. `offline_access` gives the client a
 * refresh token, so the household does not consent again every hour.
 *
 * A client registers with this whole list stored on its row, and the authorize
 * endpoint refuses a scope outside it. So a scope added here also needs a
 * migration that adds it to the existing `oauth_client` rows
 * (`20261013120000_add_mcp_write_scope`), or every client registered before the
 * change fails with `invalid_scope` once it asks for the new one.
 */
export const MCP_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * Scopes that belong to the authorization server, not to the MCP resource.
 * RFC 9728 metadata lists only the resource's own scopes; this is the same
 * split `@better-auth/mcp` makes in its own resource metadata.
 */
const AUTHORIZATION_SERVER_ONLY_SCOPES: ReadonlySet<string> = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
])

/** The origin without a trailing slash, so `${origin}/path` never doubles it. */
function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/**
 * The MCP resource identifier (RFC 8707) for an origin:
 * `https://wobblepot.com/api/mcp` in production.
 */
export function getMcpResource(origin: string): string {
  return `${trimOrigin(origin)}${MCP_RESOURCE_PATH}`
}

/**
 * The issuer. The JWT plugin sets it to the bare origin rather than Better
 * Auth's default `<origin>/api/auth`, so RFC 8414 discovery lives at the root
 * `/.well-known/oauth-authorization-server`, where MCP clients look first.
 */
export function getMcpIssuer(origin: string): string {
  return trimOrigin(origin)
}

/** RFC 9728 Protected Resource Metadata for the MCP resource. */
export function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: getMcpResource(origin),
    authorization_servers: [getMcpIssuer(origin)],
    bearer_methods_supported: ['header'],
    scopes_supported: MCP_SCOPES.filter((scope) => !AUTHORIZATION_SERVER_ONLY_SCOPES.has(scope)),
  }
}

/**
 * Headers for the public discovery documents. Browser-based MCP clients fetch
 * them cross-origin, and they carry no credentials or user data.
 */
export const DISCOVERY_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
} as const

/** Catalog key under `consent.scopes` for each scope, in display order. */
export const SCOPE_MESSAGE_KEYS: Record<
  McpScope,
  'openid' | 'profile' | 'offlineAccess' | 'mcpRead' | 'mcpWrite'
> = {
  [MCP_READ_SCOPE]: 'mcpRead',
  [MCP_WRITE_SCOPE]: 'mcpWrite',
  openid: 'openid',
  profile: 'profile',
  offline_access: 'offlineAccess',
}

/** Narrow a requested scope string to a known scope, in `SCOPE_MESSAGE_KEYS` order. */
export function knownScopes(scope: string | null | undefined): McpScope[] {
  const requested = new Set((scope ?? '').split(' ').filter(Boolean))
  return (Object.keys(SCOPE_MESSAGE_KEYS) as McpScope[]).filter((s) => requested.has(s))
}
