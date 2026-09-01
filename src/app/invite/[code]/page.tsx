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
        select: { name: true },
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
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
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

  // Check if invite is still valid
  const now = new Date()
  const isExpired = invite.expiresAt < now
  const isMaxedOut = invite.maxUses !== null && invite.usesCount >= invite.maxUses

  if (isExpired || isMaxedOut) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
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
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <JoinHouseholdCard
        status="valid"
        householdName={invite.household.name}
        memberName={invite.member.name}
        code={code}
      />
    </div>
  )
}
