import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { knownScopes, type McpScope } from '@/lib/mcp/oauth'

/** Query parameter that lists the names the provider signed. */
const SIGNED_PARAM_NAMES = 'ba_param'

/**
 * The part of `/consent`'s query the provider signed: `sig`, the `ba_param`
 * list, and every parameter that list names. Anything else on the URL (a
 * tracking parameter, Next's `_rsc`) is dropped, so it cannot break the
 * signature check. Mirrors `buildSignedOAuthQuery`, which the client plugin
 * uses to build `oauth_query` from the same URL. Null when the query was not
 * signed.
 */
export function signedOAuthQuery(search: URLSearchParams): string | null {
  if (!search.has('sig')) return null
  const names = new Set(search.getAll(SIGNED_PARAM_NAMES))
  if (names.size === 0) return null
  const signed = new URLSearchParams()
  for (const [key, value] of search.entries()) {
    if (key === 'sig' || key === SIGNED_PARAM_NAMES || names.has(key)) signed.append(key, value)
  }
  return signed.toString()
}

export type ConsentRequest =
  | { status: 'invalid' }
  | {
      status: 'ready'
      /** The client's self-declared `client_name`; null when it sent none. */
      clientName: string | null
      householdName: string | null
      scopes: McpScope[]
    }

/**
 * What `/consent` shows for an authorization request (HON-1150).
 *
 * The page reads the client from the URL, so it first checks the provider's
 * signature and expiry: an unsigned or expired query is `invalid`, and no
 * client name from it is ever shown. A client id with no registered client is
 * `invalid` too. The consent endpoint repeats the signature check on submit,
 * so this check protects what the user reads, not what is granted.
 */
export async function loadConsentRequest(
  search: URLSearchParams,
  userId: string,
): Promise<ConsentRequest> {
  const query = signedOAuthQuery(search)
  if (!query) return { status: 'invalid' }

  const { secret } = await auth.$context
  if (!(await verifyOAuthQueryParams(query, secret))) return { status: 'invalid' }

  const signed = new URLSearchParams(query)
  const clientId = signed.get('client_id')
  if (!clientId) return { status: 'invalid' }

  const [client, membership] = await Promise.all([
    prisma.oauthClient.findUnique({
      where: { clientId },
      select: { name: true, disabled: true },
    }),
    prisma.householdMember.findFirst({
      where: { userId },
      select: { household: { select: { name: true } } },
    }),
  ])
  if (!client || client.disabled) return { status: 'invalid' }

  return {
    status: 'ready',
    clientName: client.name?.trim() || null,
    householdName: membership?.household.name ?? null,
    scopes: knownScopes(signed.get('scope')),
  }
}
