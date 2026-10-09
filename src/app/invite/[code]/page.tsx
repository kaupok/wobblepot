import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { findHouseholdInvite, getInviteValidity } from '@/lib/household-invite'
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

  // The membership check and the invite lookup are independent queries, so
  // start both together. The invite is only awaited on the path that reads it,
  // so an already-member visit keeps its previous failure isolation: a broken
  // `household_invite` query can't turn that card into an error page.
  const invitePromise = findHouseholdInvite(code)
  // The early return below never awaits it — swallow the rejection so it can't
  // surface as an unhandledRejection. `await invitePromise` still throws.
  invitePromise.catch(() => {})

  // A signed-out visitor is the invitee who has no account yet, so they get
  // the invite itself, with Create account first (HON-1131). `/invite` is a
  // public route in `src/proxy.ts` for this branch.
  const existingMembership = session ? await getHouseholdMembership(session.user.id) : null

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
