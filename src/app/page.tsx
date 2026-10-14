import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership } from '@/lib/household'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import { getLocale } from '@/lib/i18n/get-locale'
import { DEMO_TIMEZONE, loadDemoDay } from '@/lib/landing/load-demo-day'
import { LandingPage } from './LandingPage'
import { TodayTimeline } from './TodayTimeline'
import { TodaySkeleton } from '@/components/timeline'

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Landing page for unauthenticated users. No Today skeleton on the way: a
  // visitor without an account must not see an app they cannot use (HON-1223).
  if (!session) {
    const [inviteRequired, locale] = await Promise.all([
      getServerFlag('invite_code_required', 'anonymous'),
      getLocale(),
    ])
    const demo = await loadDemoDay({ locale, date: getTodayInTimezone(DEMO_TIMEZONE) })
    // Awaited here rather than rendered as `<LandingPage />`: it is an async
    // Server Component, and `page.test.tsx` renders `await Home()` in a client
    // renderer, which cannot resolve a nested async component.
    return await LandingPage({ inviteRequired, locale, demo })
  }

  // Check household membership outside the Suspense boundary, so the
  // onboarding redirect is a server redirect, sent before anything streams.
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayTimeline household={membership.household} userName={session.user.name} />
    </Suspense>
  )
}
