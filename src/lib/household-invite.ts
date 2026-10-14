import 'server-only'
import { nanoid } from 'nanoid'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import { inviteMembershipClaim, runHouseholdClaim } from '@/lib/household-claim'
import { householdInvitePath } from '@/lib/household-invite-link'

/**
 * An owner's household invites, behind `GET` and `POST
 * /api/households/me/invites` and `DELETE /api/households/me/invites/[id]`
 * (HON-1215). The routes own the session, the membership and the body; these
 * functions own the owner rule and every query, and are tested against a
 * database in `household-invite.db.test.ts`.
 */

/**
 * Why an invite change or read was refused. The routes map each one to its
 * status:
 *
 * - `notOwner`: only the household owner manages invites (403).
 * - `memberNotFound`: no such member in this household (404).
 * - `memberClaimed`: the member already has an account, so there is nothing
 *   to invite them to (400).
 * - `inviteNotFound`: no such invite in this household, including one that
 *   was used, because claiming deletes it (404).
 */
export type HouseholdInviteRefusal =
  'notOwner' | 'memberNotFound' | 'memberClaimed' | 'inviteNotFound'

export class HouseholdInviteError extends Error {
  constructor(readonly reason: HouseholdInviteRefusal) {
    super(`Household invite refused: ${reason}`)
    this.name = 'HouseholdInviteError'
  }
}

/** The caller's membership: which household, and whether they own it. */
export interface InviteManager {
  householdId: string
  role: string
}

function assertOwner(manager: InviteManager) {
  if (manager.role !== 'owner') throw new HouseholdInviteError('notOwner')
}

function householdInviteUrl(code: string): string {
  return `${getServerBaseURL()}${householdInvitePath(code)}`
}

/** One invite as the invites routes return it. */
export interface HouseholdInviteView {
  id: string
  code: string
  url: string
  memberId: string | null
  memberName: string | null
  expiresAt: string
  createdAt: string
}

/** The household's invites, newest first, each with whether it still works. */
export async function listHouseholdInvites(
  manager: InviteManager,
  now: Date = new Date(),
): Promise<(HouseholdInviteView & { isActive: boolean })[]> {
  assertOwner(manager)

  const invites = await prisma.householdInvite.findMany({
    where: { householdId: manager.householdId },
    include: { member: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return invites.map((invite) => ({
    id: invite.id,
    code: invite.code,
    url: householdInviteUrl(invite.code),
    memberId: invite.memberId,
    memberName: invite.member?.name ?? null,
    expiresAt: invite.expiresAt.toISOString(),
    // Expiry alone: an invite that still has a row has not been used,
    // because claiming one deletes it (HON-680).
    isActive: invite.expiresAt >= now,
    createdAt: invite.createdAt.toISOString(),
  }))
}

/**
 * Invite a member without an account to claim their member row. A member has
 * at most one invite, so this replaces the code and expiry of an earlier one.
 */
export async function createHouseholdInvite(
  manager: InviteManager,
  memberId: string,
  expiresInDays: number,
): Promise<HouseholdInviteView> {
  assertOwner(manager)

  const member = await prisma.householdMember.findFirst({
    where: { id: memberId, householdId: manager.householdId },
    select: { name: true, userId: true },
  })
  if (!member) throw new HouseholdInviteError('memberNotFound')
  if (member.userId !== null) throw new HouseholdInviteError('memberClaimed')

  const code = nanoid(12)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  const invite = await prisma.householdInvite.upsert({
    where: { memberId },
    create: { householdId: manager.householdId, memberId, code, expiresAt },
    update: { code, expiresAt },
  })

  return {
    id: invite.id,
    code: invite.code,
    url: householdInviteUrl(invite.code),
    memberId: invite.memberId,
    memberName: member.name,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }
}

/** Delete one of the household's invites, so its link stops working. */
export async function revokeHouseholdInvite(
  manager: InviteManager,
  inviteId: string,
): Promise<void> {
  assertOwner(manager)

  const { count } = await prisma.householdInvite.deleteMany({
    where: { id: inviteId, householdId: manager.householdId },
  })
  if (count === 0) throw new HouseholdInviteError('inviteNotFound')
}

/**
 * The one read of a household invite. The join route, the invite page, the
 * sign-up gate and the sign-up page all decide on this shape through
 * {@link getInviteValidity}, so the four cannot disagree on what a valid
 * invite is (HON-1131).
 */
const HOUSEHOLD_INVITE_INCLUDE = {
  household: {
    select: {
      id: true,
      name: true,
      // Non-empty while the owner's account is pending deletion — see
      // `getInviteValidity`. `take: 1`: only its presence matters.
      members: {
        where: { role: 'owner', user: { deletedAt: { not: null } } },
        select: { id: true },
        take: 1,
      },
    },
  },
  member: {
    select: { id: true, name: true, userId: true },
  },
} as const

export async function findHouseholdInvite(code: string, db: PrismaClientType = prisma) {
  return db.householdInvite.findUnique({
    where: { code },
    include: HOUSEHOLD_INVITE_INCLUDE,
  })
}

export type HouseholdInviteWithDetails = NonNullable<
  Awaited<ReturnType<typeof findHouseholdInvite>>
>

/**
 * Why an invite that resolved cannot be claimed, or `valid`.
 *
 * A used invite is not a case here: claiming it deletes the row (HON-680), so
 * a used code resolves to no invite at all, and each caller handles that as
 * "not found".
 *
 * - `expired`: past `expiresAt`.
 * - `no_member`: invites are per member; one without a member row is broken.
 * - `member_claimed`: the member row already has an account. The claim's
 *   `userId: null` predicate would refuse it anyway; checking here lets the
 *   sign-up gate refuse before it creates an account.
 * - `owner_pending_deletion`: the owner has asked to delete their account.
 *   Members without an account do not block that request, and the purge
 *   deletes them with the household (HON-881), so claiming one now would add
 *   an account holder the purge then leaves in a household with no owner.
 *   Callers render this exactly like `expired`, so the invitee is not told the
 *   owner is leaving. If the owner cancels, the link works again.
 */
export type InviteValidity =
  'valid' | 'expired' | 'no_member' | 'member_claimed' | 'owner_pending_deletion'

export function getInviteValidity(
  invite: HouseholdInviteWithDetails,
  now: Date = new Date(),
): InviteValidity {
  if (invite.expiresAt < now) return 'expired'
  if (!invite.memberId || !invite.member) return 'no_member'
  if (invite.member.userId !== null) return 'member_claimed'
  if (invite.household.members.length > 0) return 'owner_pending_deletion'
  return 'valid'
}

/**
 * Pull `householdInviteCode` off an unknown sign-up body: the
 * `HouseholdInvite.code` the sign-up form sends when the visitor came from a
 * household invite link (HON-1131). Trims, and turns a non-string into `''`,
 * like `getInviteCodeFromBody` in `src/lib/signup-codes.ts`.
 */
export function getHouseholdInviteCodeFromBody(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const raw = (body as { householdInviteCode?: unknown }).householdInviteCode
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * The sign-up after-hook's half of an invite-link sign-up (HON-1131): put the
 * new user into the invite's member row and delete the invite. The before-hook
 * already checked the invite (`validateAndClaimInviteCode`), but the account
 * is created between the two, so this re-reads it and claims with the same
 * conditional writes as the join route.
 *
 * Never throws, because the account already exists and a thrown error would
 * fail a sign-up that succeeded. The common failure is a race: another
 * sign-up on the same link claimed it first. The user then has an account and
 * no household; the sign-up form sends them to `/invite/<code>`, which shows
 * the invalid card. Returns whether the user joined.
 */
export async function joinHouseholdFromSignUp(body: unknown, userId: string): Promise<boolean> {
  const code = getHouseholdInviteCodeFromBody(body)
  if (!code) return false

  try {
    const invite = await findHouseholdInvite(code)
    const validity = invite ? getInviteValidity(invite) : 'not_found'
    if (!invite || validity !== 'valid' || !invite.memberId) {
      // eslint-disable-next-line no-console
      console.warn('[household-invite] sign-up could not join the household', {
        userId,
        validity,
      })
      return false
    }
    await runHouseholdClaim(userId, inviteMembershipClaim(userId, invite.memberId, invite.id))
    return true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[household-invite] sign-up could not claim the invite', { userId, err })
    return false
  }
}
