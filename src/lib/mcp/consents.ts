import 'server-only'

import { getPosthogServer } from '@/lib/posthog-server'
import { prisma } from '@/lib/prisma'
import { sanitizeEventProperties } from '@/lib/redact'

export const MCP_CLIENT_DISCONNECTED_EVENT = 'mcp:client_disconnected'

const DAY_MS = 24 * 60 * 60 * 1000

/** One connected assistant, as `GET /api/auth/user/mcp-consents` returns it. */
export interface McpConsentSummary {
  clientId: string
  /** Self-declared at registration, so it can be missing. */
  clientName: string | null
  scopes: string[]
  /** ISO timestamp, or null for a row the plugin wrote without one. */
  createdAt: string | null
}

/**
 * The assistants a user has allowed on `/consent` (HON-1153), oldest first.
 * The plugin keeps one consent row per user and client, but the list is keyed
 * by client, so a second row for the same client is folded into the first.
 */
export async function listMcpConsents(userId: string): Promise<McpConsentSummary[]> {
  const rows = await prisma.oauthConsent.findMany({
    where: { userId },
    select: {
      clientId: true,
      scopes: true,
      createdAt: true,
      client: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const byClient = new Map<string, McpConsentSummary>()
  for (const row of rows) {
    if (byClient.has(row.clientId)) continue
    byClient.set(row.clientId, {
      clientId: row.clientId,
      clientName: row.client.name ?? null,
      scopes: row.scopes,
      createdAt: row.createdAt?.toISOString() ?? null,
    })
  }
  return [...byClient.values()]
}

/**
 * Disconnects one assistant for one user: deletes the user's consent, refresh
 * tokens and stored access tokens for that client in one transaction. The MCP
 * route refuses a JWT access token without a consent row
 * (`src/app/api/mcp/route.ts`), so a token issued before this stops working
 * on the next call, not when it expires.
 *
 * Returns false when the user has no consent for the client, which includes a
 * client id that belongs to another user's grant: the route answers 404 for
 * both, so it does not confirm that someone else's grant exists.
 *
 * After the commit it captures `mcp:client_disconnected`, a server event
 * listed under "Server events" in `src/lib/analytics.ts`. Analytics only: a
 * capture failure never fails the disconnect.
 */
export async function disconnectMcpClient(userId: string, clientId: string): Promise<boolean> {
  const where = { userId, clientId }
  const consent = await prisma.$transaction(async (tx) => {
    const found = await tx.oauthConsent.findFirst({
      where,
      select: { createdAt: true, client: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    if (!found) return null
    await tx.oauthRefreshToken.deleteMany({ where })
    await tx.oauthAccessToken.deleteMany({ where })
    await tx.oauthConsent.deleteMany({ where })
    return found
  })
  if (!consent) return false

  try {
    const membership = await prisma.householdMember.findFirst({
      where: { userId },
      select: { householdId: true },
    })
    getPosthogServer()?.capture({
      distinctId: userId,
      event: MCP_CLIENT_DISCONNECTED_EVENT,
      properties: sanitizeEventProperties({
        household_id: membership?.householdId ?? null,
        client_name: consent.client.name ?? null,
        days_connected: consent.createdAt
          ? Math.floor((Date.now() - consent.createdAt.getTime()) / DAY_MS)
          : null,
      }),
    })
  } catch {
    // Analytics only.
  }
  return true
}
