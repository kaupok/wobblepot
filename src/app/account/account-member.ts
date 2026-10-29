import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { type VerificationLanding, verificationLandingSearch } from '@/lib/email-verification'
import { getHouseholdMembership } from '@/lib/household'
import { getSession } from '@/lib/session'

import type { AccountTab } from './tabs'

/**
 * The session, membership and translations every `/account` tab needs, with
 * the redirects every tab owns. Each page calls it, not the layout: a layout
 * does not re-run when the user moves between tabs (HON-1229).
 *
 * `landing` is the verification link's result on the Profile tab, which the
 * onboarding redirect carries along (HON-1155).
 */
export async function requireAccountMember({
  landing = null,
}: { landing?: VerificationLanding | null } = {}) {
  // `getSession` is `cache()`-wrapped, so this reuses the lookup the root
  // layout already resolved for this request rather than re-reading `session`.
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // `getTranslations` is not DB-free: it resolves next-intl's request config,
  // whose `getLocale()` reads `getCachedMembership()`. The root layout warms
  // that `cache()` entry, but the page renders concurrently with the layout
  // rather than after it, so overlap it with the membership read instead of
  // assuming it is already resolved. Both are awaited before the redirect, so
  // the auth gate's ordering is unchanged.
  const [membership, t] = await Promise.all([
    getHouseholdMembership(session.user.id),
    getTranslations('account'),
  ])

  // Redirect users without a household to onboarding. A new user often opens
  // the verification mail before onboarding is done, so the link's result
  // goes along and onboarding shows it (HON-1155).
  if (!membership) {
    redirect(landing ? `/onboarding${verificationLandingSearch(landing)}` : '/onboarding')
  }

  return { session, membership, t }
}

/** A tab's document title, such as "Connections · My account". */
export async function accountTabMetadata(tab: AccountTab): Promise<Metadata> {
  const t = await getTranslations('account')
  return { title: t('pageTitle', { tab: t(`tabs.${tab}`) }) }
}
