import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

/**
 * GET /api/auth/user/export
 *
 * GDPR Art. 20 / UK-GDPR right-to-portability endpoint. Returns the
 * authenticated user's personal data as a JSON attachment.
 *
 * Scoping:
 *  - Always: user profile, own session metadata (without tokens), own
 *    HouseholdMember + MemberPreferences rows across every membership.
 *  - Per owner-household: full tree (members, prefs, meals, plans,
 *    pantry, favorites, custom shopping items, invites, AI usage).
 *  - Per non-owner-membership household: shared context only. Other
 *    members' names, preferences, and the user link are redacted;
 *    invites and AI usage are not exposed.
 *
 * Never exposed: password hashes, session tokens, Better Auth internals.
 */

const SCHEMA_VERSION = 1

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const rateLimitResult = await checkRateLimit(userId, 'data-export')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} data exports per day`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    const payload = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!user) {
        throw new Error('User not found')
      }

      // Session metadata only — never include token.
      const sessions = await tx.session.findMany({
        where: { userId },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { createdAt: 'asc' },
      })

      const memberships = await tx.householdMember.findMany({
        where: { userId },
        select: { householdId: true, role: true },
      })

      const households = await Promise.all(
        memberships.map(async ({ householdId, role }) => {
          const isOwner = role === 'owner'

          const household = await tx.household.findUnique({
            where: { id: householdId },
            include: { preferences: true },
          })

          // Unreachable in practice (FK guarantees the household exists), but
          // keeps the types honest if a household is deleted mid-export.
          if (!household) return null

          const allMembers = await tx.householdMember.findMany({
            where: { householdId },
            include: { preferences: true },
            orderBy: { joinedAt: 'asc' },
          })

          const members = allMembers.map((member) => {
            // Own row is always fully included. In an owner-household, all
            // rows are fully included.
            if (isOwner || member.userId === userId) {
              return {
                id: member.id,
                userId: member.userId,
                name: member.name,
                role: member.role,
                joinedAt: member.joinedAt,
                preferences: member.preferences,
              }
            }
            // Non-owner household, other member: redact name, preferences,
            // and the user link (which could re-identify the person). Keep
            // id/role/joinedAt for referential integrity.
            return {
              id: member.id,
              role: member.role,
              joinedAt: member.joinedAt,
            }
          })

          const [meals, mealPlans, pantryItems, favoriteMeals, customShoppingItems] =
            await Promise.all([
              tx.meal.findMany({
                where: { householdId },
                include: { components: true },
                orderBy: { createdAt: 'asc' },
              }),
              tx.mealPlan.findMany({
                where: { householdId },
                include: { entries: true },
                orderBy: { createdAt: 'asc' },
              }),
              tx.pantryItem.findMany({
                where: { householdId },
                orderBy: { updatedAt: 'asc' },
              }),
              tx.favoriteMeal.findMany({
                where: { householdId },
                orderBy: { createdAt: 'asc' },
              }),
              tx.customShoppingItem.findMany({
                where: { householdId },
                orderBy: { createdAt: 'asc' },
              }),
            ])

          const base = {
            role,
            household,
            members,
            meals,
            mealPlans,
            pantryItems,
            favoriteMeals,
            customShoppingItems,
          }

          if (!isOwner) {
            // Non-owner members cannot see invites or AI usage.
            return base
          }

          const [invites, aiUsage] = await Promise.all([
            tx.householdInvite.findMany({
              where: { householdId },
              orderBy: { createdAt: 'asc' },
            }),
            tx.aiUsage.findMany({
              where: { householdId },
              orderBy: { createdAt: 'asc' },
            }),
          ])

          return { ...base, invites, aiUsage }
        }),
      )

      return {
        user: {
          ...user,
          // HON-457 will add these fields to the User model; stub as null
          // until then so the envelope shape is stable for consumers.
          acceptedTermsAt: null as string | null,
          acceptedTermsVersion: null as string | null,
          sessions,
        },
        households: households.filter((h): h is NonNullable<typeof h> => h !== null),
      }
    })

    const now = new Date()
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      ...payload,
    }

    const dateStr = now.toISOString().slice(0, 10)
    const filename = `honkadori-export-${userId}-${dateStr}.json`

    return new NextResponse(JSON.stringify(envelope), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Failed to export user data:', error)
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 })
  }
}
