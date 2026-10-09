import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { findHouseholdInvite, getInviteValidity } from '@/lib/household-invite'
import { getSession } from '@/lib/session'
import { countAccountHoldingMembers, getHouseholdMembership } from '@/lib/household'
import { JoinHouseholdCard } from './JoinHouseholdCard'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.invite')
  return { title: t('metaTitle') }
}

interface InvitePageProps {
  params: Promise<{ code: string }>
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { code } = await params

  // `getSession` is `cache()`-wrapped, so this reuses the lookup the root
  // layout already resolved for this request rather than re-reading `session`.
  const session = await getSession()

  // The membership check and the invite lookup are independent queries, so
  // start both together. An already-member visit reads the invite without
  // letting it throw, so a broken `household_invite` query can't turn that
  // card into an error page.
  const invitePromise = findHouseholdInvite(code)
  // Swallow the rejection here so it can't surface as an unhandledRejection
  // before a branch awaits it. `await invitePromise` still throws.
  invitePromise.catch(() => {})

  // A signed-out visitor is the invitee who has no account yet, so they get
  // the invite itself, with Create account first (HON-1131). `/invite` is a
  // public route in `src/proxy.ts` for this branch.
  const existingMembership = session ? await getHouseholdMembership(session.user.id) : null

  if (existingMembership) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <AlreadyMemberCard
          membership={existingMembership}
          invitePromise={invitePromise}
          code={code}
        />
      </div>
    )
  }

  const invite = await invitePromise

  // A claimed invite is deleted rather than counted, so a used code resolves
  // to no invite at all (HON-680).
  if (!invite) {
    notFound()
  }

  // Expired, broken, already claimed, or an owner whose account is pending
  // deletion — all rendered as the same invalid card, so the invitee is not
  // told why (HON-881).
  if (getInviteValidity(invite) !== 'valid' || !invite.member) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <JoinHouseholdCard
          status="invalid"
          householdName={invite.household.name}
          memberName={invite.member?.name ?? null}
          code={code}
        />
      </div>
    )
  }

  // The signed-out card shows the same two names the signed-in card shows,
  // and nothing more.
  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <JoinHouseholdCard
        status={session ? 'valid' : 'signed_out'}
        householdName={invite.household.name}
        memberName={invite.member.name}
        code={code}
      />
    </div>
  )
}

type Membership = NonNullable<Awaited<ReturnType<typeof getHouseholdMembership>>>

/**
 * A signed-in visitor who already has a household (HON-1133). Each user is in
 * one household, so a valid invite is offered as a move: leave the current
 * household and join this one. An owner with other account holders cannot
 * leave, and is pointed at `/household` to remove them first.
 */
async function AlreadyMemberCard({
  membership,
  invitePromise,
  code,
}: {
  membership: Membership
  invitePromise: ReturnType<typeof findHouseholdInvite>
  code: string
}) {
  const currentName = membership.household.name
  // `undefined`: the lookup failed. The plain card needs no invite, so it is
  // shown rather than an error page.
  const invite = await invitePromise.catch(() => undefined)

  // No move to offer: the invite could not be read, or it is into the
  // household the visitor is already in.
  if (invite === undefined || invite?.household.id === membership.householdId) {
    return (
      <JoinHouseholdCard
        status="already_member"
        householdName={currentName}
        memberName={null}
        code={code}
      />
    )
  }

  // Unknown, used, expired or otherwise invalid: the same card a visitor with
  // no household gets, with no reason given (HON-881).
  if (!invite || getInviteValidity(invite) !== 'valid' || !invite.member) {
    return (
      <JoinHouseholdCard
        status="invalid"
        householdName={invite?.household.name ?? currentName}
        memberName={invite?.member?.name ?? null}
        code={code}
      />
    )
  }

  // Only an owner's count matters: a member leaves freely. Same count as the
  // leave helper, so the card and the route agree on who can leave.
  const accountMemberCount =
    membership.role === 'owner' ? await countAccountHoldingMembers(membership.householdId) : 0
  const canLeave = membership.role !== 'owner' || accountMemberCount <= 1

  return (
    <JoinHouseholdCard
      status={canLeave ? 'leave_and_join' : 'cannot_leave'}
      householdName={invite.household.name}
      memberName={invite.member.name}
      code={code}
      currentHousehold={{
        name: currentName,
        deletesHousehold: membership.role === 'owner' && canLeave,
        otherAccountCount: Math.max(accountMemberCount - 1, 0),
      }}
    />
  )
}
