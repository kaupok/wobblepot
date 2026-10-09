import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { hasHouseholdMembership } from '@/lib/household'
import { getServerFlag } from '@/lib/feature-flags'
import { findHouseholdInvite, getInviteValidity } from '@/lib/household-invite'
import { getHouseholdInviteCodeFromParams, householdInvitePath } from '@/lib/household-invite-link'
import { SignUpForm, type SignUpHouseholdInvite } from './SignUpForm'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signUp')
  return { title: t('metaTitle') }
}

interface SignUpPageProps {
  searchParams: Promise<{ invite?: string | string[]; returnUrl?: string | string[] }>
}

/** A repeated query param arrives as an array; only a single value is a code. */
function single(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The household invite this visit carries, checked the way the sign-up gate
 * checks it (HON-1131). An invite that is gone or no longer valid sends the
 * visitor to its invite page, which renders the not-found page or the invalid
 * card: the form cannot name a household it cannot admit them to.
 */
async function resolveHouseholdInvite(code: string | null): Promise<SignUpHouseholdInvite | null> {
  if (!code) return null
  const invite = await findHouseholdInvite(code)
  if (!invite || getInviteValidity(invite) !== 'valid') {
    redirect(householdInvitePath(code))
  }
  return { code, householdName: invite.household.name }
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (session) {
    const hasMembership = await hasHouseholdMembership(session.user.id)
    redirect(hasMembership ? '/' : '/onboarding')
  }

  const params = await searchParams
  const householdCode = getHouseholdInviteCodeFromParams({
    invite: single(params.invite),
    returnUrl: single(params.returnUrl),
  })

  const [householdInvite, inviteRequired, t, tCommon] = await Promise.all([
    resolveHouseholdInvite(householdCode),
    getServerFlag('invite_code_required', 'anonymous'),
    getTranslations('auth.signUp'),
    getTranslations('common'),
  ])

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <Suspense fallback={<LoadingFallback message={tCommon('loading')} />}>
        <SignUpForm
          inviteRequired={inviteRequired}
          inviteCodeLabel={t('inviteCodeLabel')}
          inviteCodeHint={t('inviteCodeHint')}
          householdInvite={householdInvite}
        />
      </Suspense>
    </div>
  )
}

function LoadingFallback({ message }: { message: string }) {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center p-8">
        <Body variant="muted">{message}</Body>
      </CardContent>
    </Card>
  )
}
