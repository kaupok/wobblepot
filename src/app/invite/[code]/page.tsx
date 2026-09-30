import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getHouseholdMembership } from '@/lib/household'
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

  if (!session) {
    redirect(`/sign-in?returnUrl=/invite/${code}`)
  }

  // The membership check and the invite lookup are independent queries, so
  // start both together. The invite is only awaited on the path that reads it,
  // so an already-member visit keeps its previous failure isolation: a broken
  // `household_invite` query can't turn that card into an error page.
  const invitePromise = prisma.householdInvite.findUnique({
    where: { code },
    include: {
      household: {
        select: {
          name: true,
          // Non-empty while the owner's account is pending deletion; the join
          // route refuses such a claim, so the card shows it as invalid (HON-881).
          members: {
            where: { role: 'owner', user: { deletedAt: { not: null } } },
            select: { id: true },
            take: 1,
          },
        },
      },
      member: {
        select: { name: true },
      },
    },
  })
  // The early return below never awaits it — swallow the rejection so it can't
  // surface as an unhandledRejection. `await invitePromise` still throws.
  invitePromise.catch(() => {})

  const existingMembership = await getHouseholdMembership(session.user.id)

  if (existingMembership) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <JoinHouseholdCard
          status="already_member"
          householdName={existingMembership.household.name}
          memberName={null}
          code={code}
        />
      </div>
    )
  }

  const invite = await invitePromise

  if (!invite) {
    notFound()
  }

  // Check if invite is still valid. A claimed invite is deleted rather than
  // counted, so a used code resolves to no invite at all and `notFound()` above
  // has already handled it (HON-680). That leaves expiry, and an owner whose
  // account is pending deletion — rendered exactly like an expired invite, so
  // the invitee is not told why (HON-881).
  const now = new Date()
  const isExpired = invite.expiresAt < now
  const ownerPendingDeletion = invite.household.members.length > 0

  if (isExpired || ownerPendingDeletion) {
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

  // Member-specific invites require a member
  if (!invite.member) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <JoinHouseholdCard
          status="invalid"
          householdName={invite.household.name}
          memberName={null}
          code={code}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <JoinHouseholdCard
        status="valid"
        householdName={invite.household.name}
        memberName={invite.member.name}
        code={code}
      />
    </div>
  )
}
