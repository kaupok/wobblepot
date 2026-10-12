import { prisma } from '@/lib/prisma'

/**
 * Deletes OAuth access and refresh token rows whose `expiresAt` has passed
 * (HON-1165). Run daily by `/api/cron/purge-deleted-users`. An expired row
 * no longer works, so keeping it serves no purpose (GDPR Art. 5(1)(c), (e)).
 *
 * The predicate is `expiresAt` alone, not `revoked`. Better Auth rotates a
 * refresh token by setting `revoked` and `rotatedAt` on the old row and
 * keeping it: a replay of that row triggers `invalidateRefreshFamily`, which
 * revokes every token of the client for the user (theft detection). Deleting
 * a revoked row before it expires would turn that replay into "token not
 * found" and skip the family revocation. Past `expiresAt` the token is
 * rejected anyway, so deleting it then changes no behaviour.
 *
 * A row with no `expiresAt` is kept: Better Auth always sets it, and the
 * purge does not guess an end for one that lacks it.
 */
export async function purgeExpiredOauthTokens(
  now: Date = new Date(),
): Promise<{ accessTokens: number; refreshTokens: number }> {
  const accessTokens = await prisma.oauthAccessToken.deleteMany({
    where: { expiresAt: { lt: now } },
  })
  const refreshTokens = await prisma.oauthRefreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  })
  return { accessTokens: accessTokens.count, refreshTokens: refreshTokens.count }
}
