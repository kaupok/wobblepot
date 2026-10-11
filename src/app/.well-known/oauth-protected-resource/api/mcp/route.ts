import {
  GET as getMetadata,
  OPTIONS as preflight,
} from '@/app/.well-known/oauth-protected-resource/route'

/**
 * The RFC 9728 path-inserted location for the resource `<origin>/api/mcp`:
 * clients that know the resource URL try this path before the bare one. Same
 * document as `/.well-known/oauth-protected-resource` (HON-1150).
 */
export const dynamic = 'force-dynamic'

export const GET = getMetadata
export const OPTIONS = preflight
