import 'server-only'

import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

import type { McpCallerContext } from './context'

/**
 * Why a verified access token does not stand for a live grant. The route
 * answers both with 401 and an `invalid_token` challenge, so the client
 * re-authorizes:
 *
 * - `noAccount`: the token's user is gone or deleted.
 * - `noGrant`: the user disconnected the client (HON-1153), or reconnected it
 *   after the token was issued.
 */
export type McpGrantRefusal = 'noAccount' | 'noGrant'

export class McpGrantError extends Error {
  constructor(readonly reason: McpGrantRefusal) {
    super(`MCP grant refused: ${reason}`)
    this.name = 'McpGrantError'
  }
}

/**
 * True for a token minted under an earlier grant: the user disconnected the
 * client and then connected it again, which creates a new consent row. Without
 * this, the old token would work again until it expired. The plugin writes the
 * row's `createdAt` in whole seconds, the unit of `iat`, and a token is always
 * issued after the Allow that created its row, so a current token never fails
 * it. A token without `iat` is treated as issued at the epoch.
 */
function issuedBeforeGrant(iat: number | undefined, grantedAt: Date | null): boolean {
  if (!grantedAt) return false
  return (typeof iat === 'number' ? iat : 0) < Math.floor(grantedAt.getTime() / 1000)
}

/**
 * Resolves the caller of one `/api/mcp` request from its verified token
 * claims. Both Disconnect and account deletion delete the token rows, but an
 * access token is a JWT that is not stored and stays valid for up to an hour,
 * so every request checks the account and the grant here.
 *
 * The consent row is the grant: the plugin writes one on every Allow, and
 * Disconnect deletes it. No client here has `skipConsent`, so a live token
 * always has one.
 *
 * Throws {@link McpGrantError} when the token no longer stands for a grant.
 */
export async function loadMcpCaller({
  userId,
  clientId,
  issuedAt,
  scopes,
}: {
  userId: string
  clientId: string
  /** The token's `iat`, in seconds. */
  issuedAt: number | undefined
  scopes: readonly string[]
}): Promise<McpCallerContext> {
  const [user, consent, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } }),
    prisma.oauthConsent.findFirst({
      where: { userId, clientId },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    getHouseholdMembership(userId),
  ])
  if (!user || user.deletedAt) throw new McpGrantError('noAccount')
  if (!consent || issuedBeforeGrant(issuedAt, consent.createdAt)) {
    throw new McpGrantError('noGrant')
  }
  return { userId, household: membership?.household ?? null, scopes }
}
