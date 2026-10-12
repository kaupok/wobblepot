import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { sanitizeEventProperties } from '@/lib/redact'

export const MCP_CLIENT_CONNECTED_EVENT = 'mcp:client_connected'

interface ConsentHookInput {
  /** `ctx.body` of the `/oauth2/consent` request. */
  body: unknown
  /** The signed-in user the consent endpoint ran for. */
  userId: string | undefined
  /** `ctx.context.returned`: the endpoint's result, or the error it threw. */
  returned: unknown
}

/**
 * True when the consent endpoint ended in an authorization code for the
 * client. Deny returns `error=access_denied` instead, and an Allow that the
 * endpoint rejected returns an error, so neither persisted a consent here.
 */
function issuedAuthorizationCode(returned: unknown): boolean {
  if (typeof returned !== 'object' || returned === null || returned instanceof Error) return false
  const url = (returned as { url?: unknown }).url
  if (typeof url !== 'string') return false
  try {
    return new URL(url).searchParams.has('code')
  } catch {
    return false
  }
}

function clientIdFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const oauthQuery = (body as { oauth_query?: unknown }).oauth_query
  if (typeof oauthQuery !== 'string') return null
  return new URLSearchParams(oauthQuery).get('client_id')
}

/**
 * Captures `mcp:client_connected` after a household member allowed an MCP
 * client on `/consent` (HON-1150). Called from the `hooks.after` branch for
 * `/oauth2/consent` in `src/lib/auth.ts`, which runs after the plugin wrote the
 * consent row.
 *
 * A server event, listed under "Server events" in `src/lib/analytics.ts`. The
 * distinct id is the user id, so the event joins the person PostHog knows
 * from sign-in. No client id, redirect URI or token goes into the event.
 *
 * `is_reconsent`: the plugin creates a consent row with `createdAt` equal to
 * `updatedAt`, and on a later consent for the same user and client it updates
 * only `updatedAt`. Disconnect (HON-1153) deletes the row, so a reconnect after
 * it creates a new one and reads false. Analytics only: a failure is swallowed.
 */
export async function captureMcpClientConnected({
  body,
  userId,
  returned,
}: ConsentHookInput): Promise<void> {
  if (typeof body !== 'object' || body === null) return
  if ((body as { accept?: unknown }).accept !== true) return
  if (!userId || !issuedAuthorizationCode(returned)) return
  const clientId = clientIdFrom(body)
  if (!clientId) return

  try {
    const [consent, client, membership] = await Promise.all([
      prisma.oauthConsent.findFirst({
        where: { clientId, userId },
        select: { scopes: true, createdAt: true, updatedAt: true },
      }),
      prisma.oauthClient.findUnique({ where: { clientId }, select: { name: true } }),
      prisma.householdMember.findFirst({ where: { userId }, select: { householdId: true } }),
    ])
    if (!consent) return

    getPosthogServer()?.capture({
      distinctId: userId,
      event: MCP_CLIENT_CONNECTED_EVENT,
      properties: sanitizeEventProperties({
        household_id: membership?.householdId ?? null,
        client_name: client?.name ?? null,
        scopes: consent.scopes,
        is_reconsent:
          consent.createdAt !== null &&
          consent.updatedAt !== null &&
          consent.updatedAt.getTime() > consent.createdAt.getTime(),
      }),
    })
  } catch {
    // Analytics only.
  }
}
