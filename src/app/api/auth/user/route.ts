import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUserSoleOwnerWithOtherMembers } from '@/lib/household'

/**
 * DELETE /api/auth/user
 *
 * Deletes the authenticated user's account and all related data.
 * Returns 400 if user is sole owner of a household with other members.
 */
export async function DELETE() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // Check if user is sole owner with other members
  const ownershipCheck = await isUserSoleOwnerWithOtherMembers(userId)

  if (ownershipCheck.isSoleOwner) {
    return NextResponse.json(
      {
        error: 'Cannot delete account',
        message: `You are the sole owner of "${ownershipCheck.householdName}" which has ${ownershipCheck.memberCount! - 1} other member(s). Please transfer ownership or remove other members first.`,
        householdId: ownershipCheck.householdId,
        householdName: ownershipCheck.householdName,
      },
      { status: 400 },
    )
  }

  // Perform cascading deletion in a transaction
  await prisma.$transaction(async (tx) => {
    // Find all household memberships for this user
    const memberships = await tx.householdMember.findMany({
      where: { userId },
      select: { id: true, householdId: true, role: true },
    })

    for (const membership of memberships) {
      // Delete member preferences first (references memberId)
      await tx.memberPreferences.deleteMany({
        where: { memberId: membership.id },
      })

      // If user is owner and only member, delete the entire household
      // (cascade will handle household preferences, invites, pantry items, meal plans)
      if (membership.role === 'owner') {
        const memberCount = await tx.householdMember.count({
          where: { householdId: membership.householdId },
        })

        if (memberCount === 1) {
          // Delete household (cascade handles related records)
          await tx.household.delete({
            where: { id: membership.householdId },
          })
        } else {
          // This shouldn't happen due to the check above, but handle gracefully
          await tx.householdMember.delete({
            where: { id: membership.id },
          })
        }
      } else {
        // Just remove the membership
        await tx.householdMember.delete({
          where: { id: membership.id },
        })
      }
    }

    // Delete sessions (Better Auth)
    await tx.session.deleteMany({
      where: { userId },
    })

    // Delete accounts (Better Auth)
    await tx.account.deleteMany({
      where: { userId },
    })

    // Delete user (cascades handled by schema onDelete: Cascade where configured)
    await tx.user.delete({
      where: { id: userId },
    })
  })

  return NextResponse.json({ success: true })
}
