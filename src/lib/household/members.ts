import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { MAX_HOUSEHOLD_MEMBERS } from '@/lib/household'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import {
  writeMemberPreferences,
  type MemberPreferencesPatch,
  type PreferencesMember,
} from '@/lib/household/preferences'

/**
 * Persistence and rules for household members, behind
 * `/api/households/me/members` and `/api/households/me/members/[id]`
 * (HON-1214). The routes own the session, the household, the owner checks
 * that read only the caller's membership, and body validation; these
 * functions own every query, and are tested against a database in
 * `members.db.test.ts`.
 */

/**
 * List a household's members. Exported from here so the members route
 * reaches every query through one module; the `/household` server prefetch
 * reads the same function (HON-780).
 */
export { listHouseholdMembers } from '@/lib/household'

/**
 * Why a member change was refused. The routes map each one to its status:
 *
 * - `notFound`: no such member in the caller's household (404).
 * - `notAllowed`: a member who is not the owner edits someone else (403).
 * - `linkedName`: a rename of a member with an account, whose name comes
 *   from the account (400).
 * - `self`: the owner removes themselves (400). Only the owner can remove a
 *   member, so this is also what keeps a household from losing its last one.
 * - `owner`: a removal of the household owner (400).
 * - `householdFull`: an add at {@link MAX_HOUSEHOLD_MEMBERS} (400, HON-720).
 */
export type MemberChangeRefusal =
  'notFound' | 'notAllowed' | 'linkedName' | 'self' | 'owner' | 'householdFull'

/**
 * A refusal from `addMember`, `updateMember` or `removeMember`. Thrown rather
 * than returned because `householdFull` is raised inside the add transaction,
 * where throwing is the only way to roll it back.
 */
export class MemberChangeError extends Error {
  constructor(readonly reason: MemberChangeRefusal) {
    super(`Member change refused: ${reason}`)
    this.name = 'MemberChangeError'
  }
}

/** The caller's membership row, as `getHouseholdMembership` returns it. */
export interface MemberCaller {
  id: string
  role: string
  householdId: string
  household: PreferencesMember['household']
}

const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
  preferences: true,
} satisfies Prisma.HouseholdMemberInclude

type MemberRow = Prisma.HouseholdMemberGetPayload<{ include: typeof MEMBER_INCLUDE }>

/** One member in the shape `GET` and `PATCH /api/households/me/members/[id]` return. */
function memberView(member: MemberRow) {
  return {
    id: member.id,
    userId: member.userId,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt,
    user: member.user,
    preferences: member.preferences
      ? {
          displayName: member.preferences.displayName,
          portionMultiplier: member.preferences.portionMultiplier,
        }
      : null,
  }
}

/** One member of `householdId`, or null when the id names none in it. */
export async function getHouseholdMember(householdId: string, memberId: string) {
  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
    include: MEMBER_INCLUDE,
  })
  if (!member || member.householdId !== householdId) return null
  return memberView(member)
}

/**
 * Add a manual member (no account, always `member`) to the caller's
 * household, with optional preferences, and return it in the shape the
 * members list uses.
 *
 * Throws `MemberChangeError('householdFull')` at {@link MAX_HOUSEHOLD_MEMBERS};
 * the throw rolls the transaction back, so nothing is written.
 */
export async function addMember(
  caller: Pick<MemberCaller, 'householdId' | 'household'>,
  input: { name: string; preferences?: MemberPreferencesPatch },
) {
  const { householdId } = caller
  const member = await prisma.$transaction(async (tx) => {
    // Lock the household row before counting (HON-720). At read committed a
    // plain count takes no lock, so two concurrent adds at 29 members would
    // both read 29 and both insert. The lock queues every add to this
    // household behind the last one, and because read committed takes a
    // fresh snapshot per statement, the second add's count then sees the
    // first add's committed row. `FOR NO KEY UPDATE`, not `FOR UPDATE`: it
    // does not conflict with the `FOR KEY SHARE` the member insert's foreign
    // key check takes on this row — the same choice as `lockUserForClaim`.
    await tx.$queryRaw`SELECT 1 FROM "household" WHERE "id" = ${householdId} FOR NO KEY UPDATE`

    const memberCount = await tx.householdMember.count({ where: { householdId } })
    if (memberCount >= MAX_HOUSEHOLD_MEMBERS) {
      throw new MemberChangeError('householdFull')
    }

    const created = await tx.householdMember.create({
      data: {
        householdId,
        name: input.name,
        role: 'member', // Manual members are always regular members
      },
    })

    if (input.preferences) {
      await tx.memberPreferences.create({
        data: { memberId: created.id, ...input.preferences },
      })
    }

    // The new member raises the household's size, which prices the cached
    // prep-tips prompt on every entry without a `servingOverride` — the
    // default state — so the household's whole remaining plan is now scaled
    // for a smaller household. Drop those tips in the same transaction as
    // the membership write and let the next open of the modal regenerate
    // through the existing rate-limited path. See
    // `docs/LOCALIZATION.md` → "AI surfaces (Tier 1)" (HON-684).
    await invalidateFutureEntrySteps(tx, householdId, caller.household.timezone)

    return tx.householdMember.findUniqueOrThrow({
      where: { id: created.id },
      include: { preferences: true },
    })
  })

  return {
    id: member.id,
    userId: member.userId,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt,
    user: null,
    preferences: member.preferences
      ? {
          displayName: member.preferences.displayName,
          portionMultiplier: member.preferences.portionMultiplier,
        }
      : null,
    invite: null,
  }
}

/**
 * Save a member's name and preferences, in one transaction, and return the
 * member. The owner may edit anyone in the household; any other member only
 * themselves. Only a manual member has a name to change: a linked member's
 * comes from the account.
 *
 * The preferences write is `writeMemberPreferences`, which clears the cached
 * prep tips when the household's servings move (HON-1040).
 *
 * Throws `MemberChangeError` with `notFound`, `notAllowed` or `linkedName`.
 */
export async function updateMember(
  caller: MemberCaller,
  memberId: string,
  patch: { name?: string; preferences?: MemberPreferencesPatch },
) {
  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
    select: { householdId: true, userId: true },
  })
  if (!member || member.householdId !== caller.householdId) {
    throw new MemberChangeError('notFound')
  }
  if (caller.role !== 'owner' && caller.id !== memberId) {
    throw new MemberChangeError('notAllowed')
  }

  const { name, preferences } = patch
  if (name !== undefined && member.userId !== null) {
    throw new MemberChangeError('linkedName')
  }

  return prisma.$transaction(async (tx) => {
    if (name !== undefined) {
      await tx.householdMember.update({ where: { id: memberId }, data: { name } })
    }

    if (preferences) {
      await writeMemberPreferences(
        tx,
        { id: memberId, householdId: caller.householdId, household: caller.household },
        preferences,
      )
    }

    return memberView(
      await tx.householdMember.findUniqueOrThrow({
        where: { id: memberId },
        include: MEMBER_INCLUDE,
      }),
    )
  })
}

/**
 * Remove a member from the caller's household. The route lets only the owner
 * call this.
 *
 * Throws `MemberChangeError` with `notFound`, `self` or `owner`.
 */
export async function removeMember(
  caller: Pick<MemberCaller, 'id' | 'householdId' | 'household'>,
  memberId: string,
) {
  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
    select: { householdId: true, role: true },
  })
  if (!member || member.householdId !== caller.householdId) {
    throw new MemberChangeError('notFound')
  }
  if (memberId === caller.id) throw new MemberChangeError('self')
  if (member.role === 'owner') throw new MemberChangeError('owner')

  await prisma.$transaction(async (tx) => {
    await tx.householdMember.delete({ where: { id: memberId } })

    // Losing the member lowers the household's size, which prices the cached
    // prep-tips prompt on every entry without a `servingOverride` — the
    // default state — so the household's whole remaining plan is now scaled
    // for a larger household. Drop those tips in the same transaction as the
    // membership write and let the next open of the modal regenerate through
    // the existing rate-limited path. See `docs/LOCALIZATION.md` → "AI
    // surfaces (Tier 1)" (HON-684).
    await invalidateFutureEntrySteps(tx, caller.householdId, caller.household.timezone)
  })
}

/**
 * The members `get_household` reports to an MCP assistant (HON-1323): the
 * name the household sees, whether the member has an account, and the
 * portion size. The select names each field, so no email, reminder or token
 * field can reach the assistant.
 */
export async function listMembersForAssistant(householdId: string) {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
    select: {
      name: true,
      userId: true,
      user: { select: { name: true } },
      preferences: { select: { displayName: true, portionMultiplier: true } },
    },
    // Members created together share a `joinedAt`; the id keeps the order stable.
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  })
  return members.map((member) => ({
    // `||`, as `EditMemberPreferencesDialog` reads it: an empty display name
    // falls through to the account name.
    name: member.preferences?.displayName || member.user?.name || member.name || null,
    linked: member.userId !== null,
    portionMultiplier: member.preferences?.portionMultiplier ?? 1,
  }))
}
