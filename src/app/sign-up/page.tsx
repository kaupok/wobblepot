import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { hasHouseholdMembership } from '@/lib/household'
import { getServerFlag } from '@/lib/feature-flags'
import { SignUpForm } from './SignUpForm'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

export const metadata: Metadata = {
  title: 'Sign up',
}

export default async function SignUpPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (session) {
    const hasMembership = await hasHouseholdMembership(session.user.id)
    redirect(hasMembership ? '/' : '/onboarding')
  }

  const [inviteRequired, t] = await Promise.all([
    getServerFlag('invite_code_required', 'anonymous'),
    getTranslations('signup'),
  ])

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Suspense fallback={<LoadingFallback />}>
        <SignUpForm
          inviteRequired={inviteRequired}
          privateBetaBanner={t('privateBetaBanner')}
          inviteCodeLabel={t('inviteCodeLabel')}
          inviteCodeHint={t('inviteCodeHint')}
        />
      </Suspense>
    </div>
  )
}

function LoadingFallback() {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center p-8">
        <Body variant="muted">Loading...</Body>
      </CardContent>
    </Card>
  )
}
