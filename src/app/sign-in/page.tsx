import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { isGoogleAuthConfigured } from '@/lib/env'
import { hasHouseholdMembership } from '@/lib/household'
import { isSignedOAuthRequest, toSearchParams } from '@/lib/mcp/consent-request'
import { SignInForm } from './SignInForm'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signIn')
  return { title: t('metaTitle') }
}

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  const isOAuthRequest = await isSignedOAuthRequest(toSearchParams(await searchParams))

  // Inside an MCP client's OAuth authorization the provider also sends a
  // signed-in user here, for `prompt=login` or an expired `max_age`. Show the
  // form so they can sign in again; the auth client forwards the signed query
  // and the authorization continues (HON-1150). Sending them home would drop
  // it, and the client would never get an answer.
  if (session && !isOAuthRequest) {
    const hasMembership = await hasHouseholdMembership(session.user.id)
    redirect(hasMembership ? '/' : '/onboarding')
  }

  const t = await getTranslations('common')

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <Suspense fallback={<LoadingFallback message={t('loading')} />}>
        <SignInForm isOAuthRequest={isOAuthRequest} googleEnabled={isGoogleAuthConfigured()} />
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
