import { prisma } from '@/lib/prisma'
import { createHouseholdForUser } from '@/lib/auth'

/**
 * Get household membership for a user, with self-healing for legacy users.
 * If no membership exists, attempts to create a household for the user.
 */
export async function getHouseholdMembership(userId: string) {
  let membership = await prisma.householdMember.findFirst({
    where: { userId },
    include: {
      household: {
        include: { preferences: true },
      },
    },
  })

  // Self-healing: create household if none exists (handles legacy users)
  if (!membership) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })
    await createHouseholdForUser(userId, user?.name ?? 'User')
    membership = await prisma.householdMember.findFirst({
      where: { userId },
      include: {
        household: {
          include: { preferences: true },
        },
      },
    })
  }

  return membership
}
