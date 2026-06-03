import { APIError } from 'better-auth/api'
import { prisma, type PrismaClientType } from '@/lib/prisma'

/**
 * Generic credential error reused for soft-deleted accounts. Matches the shape
 * of Better Auth's invalid-credentials response so a blocked sign-in is
 * indistinguishable from a wrong password — soft-deleted account state must not
 * leak to third parties (HON-481, GDPR Art. 17).
 */
export const SOFT_DELETED_SIGN_IN_MESSAGE = 'Invalid email or password'

/**
 * Throws if the user has requested deletion (`deletedAt` set), blocking session
 * creation. Wired into Better Auth's `databaseHooks.session.create.before`, so
 * it runs only after credentials are verified — no extra read on failed
 * sign-ins, and only the password-holder ever reaches it.
 *
 * Extracted from the auth config so the guard logic stays unit-testable in
 * isolation (same rationale as `signup-codes.ts`).
 */
export async function assertUserNotSoftDeleted(
  userId: string,
  db: PrismaClientType = prisma,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true },
  })

  if (user?.deletedAt) {
    throw new APIError('UNAUTHORIZED', {
      message: SOFT_DELETED_SIGN_IN_MESSAGE,
    })
  }
}
