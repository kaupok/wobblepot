import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect(`/sign-in?returnUrl=/invite/${code}`)
  }

  // The membership check and the invite lookup are independent queries, so
  // start both together. The branch order below is unchanged: an existing
  // membership still short-circuits before the invite is inspected.
  const [existingMembership, invite] = await Promise.all([
    getHouseholdMembership(session.user.id),
    prisma.householdInvite.findUnique({
      where: { code },
      include: {
        household: {
          select: { name: true },
        },
        member: {
          select: { name: true },
        },
      },
    }),
  ])

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
