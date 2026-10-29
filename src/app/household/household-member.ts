import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getHouseholdMembership } from '@/lib/household'
import { getSession } from '@/lib/session'

import type { HouseholdTab } from './tabs'

/**
 * The session, membership and translations every `/household` tab needs, with
 * the redirects every tab owns. Each page calls it, not the layout: a layout
 * does not re-run when the user moves between tabs (HON-1257, as
 * `requireAccountMember` for `/account`).
 */
export async function requireHouseholdMember() {
  // `cache()`-wrapped, so this reuses the root layout's lookup.
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // Overlapped for the reason `requireAccountMember` gives: `getTranslations`
  // reads the membership through next-intl's request config.
  const [membership, t] = await Promise.all([
    getHouseholdMembership(session.user.id),
    getTranslations('household'),
  ])

  if (!membership) {
    redirect('/')
  }

  return { session, membership, t, isOwner: membership.role === 'owner' }
}

/** A tab's document title, such as "Meal preferences · Household". */
export async function householdTabMetadata(tab: HouseholdTab): Promise<Metadata> {
  const t = await getTranslations('household')
  return { title: t('tabTitle', { tab: t(`tabs.${tab}`) }) }
}
